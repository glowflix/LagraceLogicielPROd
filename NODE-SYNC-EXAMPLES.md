# 📝 Exemples d'Implémentation - Sync Manager

**Langage:** Node.js / JavaScript  
**Framework:** Express (optionnel)  
**DB:** SQLite / PostgreSQL / MySQL

---

## 📦 Installation des dépendances

```bash
npm install axios dotenv sqlite3 better-sqlite3
```

---

## 1️⃣ Configuration (.env)

```env
# Apps Script
GRACE_BASE_URL=https://script.google.com/macros/d/YOUR_DEPLOYMENT_ID/usercontent
GRACE_API_KEY=your-secret-api-key-123

# Database
DB_TYPE=sqlite
DB_PATH=./data/grace.db

# Sync
SYNC_INTERVAL_MS=300000
SYNC_LOG_LEVEL=debug
```

---

## 2️⃣ Sync Manager (Main Class)

**File: `src/sync/SyncManager.js`**

```javascript
const axios = require('axios');
const { EventEmitter } = require('events');

class GraceSyncManager extends EventEmitter {
  constructor(config) {
    super();
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.db = config.db;
    this.syncInterval = config.syncInterval || 5 * 60 * 1000;
    this.isRunning = false;
    this.lastSyncTime = null;
    this.logger = config.logger || console;
  }

  /**
   * Démarrer la boucle de sync
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('[SyncManager] Already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('[SyncManager] ✅ Started');
    this.emit('started');

    // Première sync immédiate
    await this.syncCycle();

    // Puis répéter
    this.syncInterval = setInterval(async () => {
      await this.syncCycle();
    }, this.syncInterval);
  }

  /**
   * Arrêter la boucle
   */
  stop() {
    if (!this.isRunning) return;

    clearInterval(this.syncInterval);
    this.isRunning = false;
    this.logger.info('[SyncManager] ✅ Stopped');
    this.emit('stopped');
  }

  /**
   * Un cycle complet de sync
   */
  async syncCycle() {
    const startTime = Date.now();

    try {
      this.logger.info(`[SyncManager] 🔄 Sync cycle started (${new Date().toISOString()})`);

      // 1. Pull changes from Sheets
      const pullResult = await this.pull();
      this.emit('pull-complete', pullResult);

      // 2. Apply changes locally
      if (pullResult.products && pullResult.products.length > 0) {
        await this.applyChanges(pullResult.products);
      }

      // 3. Handle conflicts
      if (pullResult.conflicts && pullResult.conflicts.length > 0) {
        await this.handleConflicts(pullResult.conflicts);
      }

      // 4. Push pending changes to Sheets
      const pushResult = await this.push();
      this.emit('push-complete', pushResult);

      // 5. Update last sync time
      this.lastSyncTime = new Date();
      await this.db.updateSyncStatus({
        lastSyncTime: this.lastSyncTime,
        status: 'success'
      });

      const duration = Date.now() - startTime;
      this.logger.info(`[SyncManager] ✅ Sync cycle completed in ${duration}ms`);
      this.emit('cycle-complete', { duration, pullResult, pushResult });

    } catch (error) {
      this.logger.error(`[SyncManager] ❌ Sync cycle failed:`, error.message);
      await this.db.updateSyncStatus({
        lastError: error.message,
        status: 'error'
      });
      this.emit('cycle-error', error);
    }
  }

  /**
   * PULL: Récupérer changements depuis Sheets
   */
  async pull() {
    try {
      const since = this.lastSyncTime || new Date(1970, 0, 1);

      this.logger.debug(`[Pull] 📥 Fetching changes since ${since.toISOString()}`);

      const url = new URL(this.baseUrl);
      url.searchParams.set('action', 'proPull');
      url.searchParams.set('since', since.toISOString());
      if (this.apiKey) url.searchParams.set('key', this.apiKey);

      const response = await axios.get(url.toString(), {
        timeout: 30000,
        headers: {
          'User-Agent': 'GraceApp/1.0'
        }
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Pull failed');
      }

      const result = response.data.data;
      this.logger.info(`[Pull] ✅ Received ${result.products?.length || 0} product change(s)`);

      return {
        products: result.products || [],
        conflicts: result.conflicts || [],
        meta: result.meta
      };

    } catch (error) {
      this.logger.error(`[Pull] ❌ Error:`, error.message);
      throw error;
    }
  }

  /**
   * APPLY: Appliquer les changements en local
   */
  async applyChanges(products) {
    try {
      this.logger.info(`[Apply] 📝 Applying ${products.length} change(s)...`);

      for (const product of products) {
        // 1. Upsert product
        await this.db.products.upsert({
          uuid: product.uuid,
          code: product.code,
          name: product.name,
          mark: product.mark,
          version: product.version,
          updated_at: new Date(product.updated_at),
          synced_from: 'SHEETS',
          synced_at: new Date()
        });

        // 2. Propagate name/mark to all units
        if (product.name || product.mark) {
          await this.db.productUnits.updateByProductUuid(product.uuid, {
            name: product.name,
            mark: product.mark
          });
        }

        this.logger.debug(`[Apply] ✅ ${product.code} (${product.unit}) applied`);
      }

      this.logger.info(`[Apply] ✅ ${products.length} change(s) applied`);

    } catch (error) {
      this.logger.error(`[Apply] ❌ Error:`, error.message);
      throw error;
    }
  }

  /**
   * HANDLE CONFLICTS: Résoudre les conflits
   */
  async handleConflicts(conflicts) {
    try {
      this.logger.warn(`[Conflicts] ⚠️ ${conflicts.length} conflict(s) detected`);

      for (const conflict of conflicts) {
        // Log conflict
        await this.db.syncConflicts.insert({
          uuid: conflict.uuid,
          reason: conflict.reason,
          sheets_version: conflict.sheets_version,
          local_version: conflict.local_version,
          sheets_updated_at: new Date(conflict.sheets_updated_at),
          local_updated_at: new Date(conflict.local_updated_at),
          created_at: new Date()
        });

        this.logger.warn(`[Conflicts] Conflict for ${conflict.uuid}:`);
        this.logger.warn(`  - Sheets v${conflict.sheets_version} @ ${conflict.sheets_updated_at}`);
        this.logger.warn(`  - Local  v${conflict.local_version} @ ${conflict.local_updated_at}`);

        // Emit event for custom handling
        this.emit('conflict', conflict);
      }

    } catch (error) {
      this.logger.error(`[Conflicts] ❌ Error:`, error.message);
    }
  }

  /**
   * PUSH: Envoyer changements locaux vers Sheets
   */
  async push() {
    try {
      // 1. Get pending changes
      const pending = await this.db.products.getPending();

      if (pending.length === 0) {
        this.logger.debug(`[Push] ℹ️ No pending changes`);
        return { applied: 0, propagated: 0 };
      }

      this.logger.info(`[Push] 📤 Sending ${pending.length} pending change(s)...`);

      // 2. Format updates
      const updates = pending.map(p => ({
        uuid: p.uuid,
        name: p.name,
        mark: p.mark,
        version: p.version
      }));

      // 3. POST to Sheets
      const response = await axios.post(
        this.baseUrl,
        {
          action: 'proPush',
          key: this.apiKey,
          updates: updates
        },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'GraceApp/1.0'
          }
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || 'Push failed');
      }

      // 4. Mark as synced
      const appliedUuids = response.data.applied.map(a => a.uuid);
      for (const uuid of appliedUuids) {
        await this.db.products.markSynced(uuid);
      }

      const propagated = response.data.propagated?.length || 0;
      this.logger.info(`[Push] ✅ ${appliedUuids.length} applied, ${propagated} propagated`);

      return {
        applied: appliedUuids.length,
        propagated: propagated
      };

    } catch (error) {
      this.logger.error(`[Push] ❌ Error:`, error.message);
      throw error;
    }
  }

  /**
   * Health Check
   */
  async health() {
    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('action', 'test');

      const response = await axios.get(url.toString(), { timeout: 5000 });
      return {
        status: 'healthy',
        lastSync: this.lastSyncTime,
        running: this.isRunning,
        serverTime: response.data.server_time
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        lastSync: this.lastSyncTime,
        running: this.isRunning
      };
    }
  }
}

module.exports = GraceSyncManager;
```

---

## 3️⃣ Database Wrapper (SQLite)

**File: `src/db/Database.js`**

```javascript
const Database = require('better-sqlite3');
const path = require('path');

class GraceDatabase {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.products = new ProductRepository(this.db);
    this.productUnits = new ProductUnitRepository(this.db);
    this.syncConflicts = new SyncConflictRepository(this.db);
    this.syncStatus = new SyncStatusRepository(this.db);
    
    this.init();
  }

  init() {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        code TEXT,
        name TEXT NOT NULL,
        mark TEXT,
        version INTEGER DEFAULT 0,
        updated_at DATETIME,
        deleted BOOLEAN DEFAULT FALSE,
        synced_from TEXT DEFAULT 'LOCAL',
        synced_at DATETIME,
        synced BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS product_units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_uuid TEXT NOT NULL,
        unit TEXT NOT NULL,
        code TEXT,
        stock INTEGER,
        price_usd DECIMAL,
        price_fc DECIMAL,
        version INTEGER DEFAULT 0,
        updated_at DATETIME,
        deleted BOOLEAN DEFAULT FALSE,
        synced_from TEXT DEFAULT 'LOCAL',
        synced_at DATETIME,
        synced BOOLEAN DEFAULT FALSE,
        UNIQUE (product_uuid, unit),
        FOREIGN KEY (product_uuid) REFERENCES products(uuid),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT,
        reason TEXT,
        sheets_version INTEGER,
        local_version INTEGER,
        sheets_updated_at DATETIME,
        local_updated_at DATETIME,
        resolution TEXT,
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sync_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lastSyncTime DATETIME,
        lastError TEXT,
        status TEXT DEFAULT 'idle',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_products_uuid ON products(uuid);
      CREATE INDEX IF NOT EXISTS idx_products_synced ON products(synced);
      CREATE INDEX IF NOT EXISTS idx_product_units_uuid ON product_units(product_uuid);
    `);
  }

  close() {
    this.db.close();
  }

  async updateSyncStatus(data) {
    return this.syncStatus.update(data);
  }
}

class ProductRepository {
  constructor(db) {
    this.db = db;
  }

  upsert(data) {
    const stmt = this.db.prepare(`
      INSERT INTO products (uuid, code, name, mark, version, updated_at, synced_from, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uuid) DO UPDATE SET
        code = excluded.code,
        name = excluded.name,
        mark = excluded.mark,
        version = excluded.version,
        updated_at = excluded.updated_at,
        synced_from = excluded.synced_from,
        synced_at = excluded.synced_at
    `);

    return stmt.run(
      data.uuid,
      data.code,
      data.name,
      data.mark,
      data.version || 0,
      data.updated_at,
      data.synced_from || 'LOCAL',
      data.synced_at
    );
  }

  getPending() {
    const stmt = this.db.prepare(`
      SELECT uuid, code, name, mark, version FROM products WHERE synced = FALSE
    `);
    return stmt.all();
  }

  markSynced(uuid) {
    const stmt = this.db.prepare(`
      UPDATE products SET synced = TRUE WHERE uuid = ?
    `);
    return stmt.run(uuid);
  }

  getByUuid(uuid) {
    const stmt = this.db.prepare(`
      SELECT * FROM products WHERE uuid = ?
    `);
    return stmt.get(uuid);
  }
}

class ProductUnitRepository {
  constructor(db) {
    this.db = db;
  }

  updateByProductUuid(productUuid, data) {
    const stmt = this.db.prepare(`
      UPDATE product_units 
      SET name = ?, mark = ?, updated_at = ?
      WHERE product_uuid = ?
    `);

    return stmt.run(
      data.name,
      data.mark,
      new Date(),
      productUuid
    );
  }

  getByProductUuid(productUuid) {
    const stmt = this.db.prepare(`
      SELECT * FROM product_units WHERE product_uuid = ?
    `);
    return stmt.all(productUuid);
  }
}

class SyncConflictRepository {
  constructor(db) {
    this.db = db;
  }

  insert(data) {
    const stmt = this.db.prepare(`
      INSERT INTO sync_conflicts (
        uuid, reason, sheets_version, local_version,
        sheets_updated_at, local_updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      data.uuid,
      data.reason,
      data.sheets_version,
      data.local_version,
      data.sheets_updated_at,
      data.local_updated_at,
      data.created_at
    );
  }

  getUnresolved() {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_conflicts WHERE resolved_at IS NULL
    `);
    return stmt.all();
  }
}

class SyncStatusRepository {
  constructor(db) {
    this.db = db;
  }

  update(data) {
    const stmt = this.db.prepare(`
      INSERT INTO sync_status (lastSyncTime, lastError, status, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);

    return stmt.run(
      data.lastSyncTime,
      data.lastError || null,
      data.status
    );
  }

  getLatest() {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_status ORDER BY updated_at DESC LIMIT 1
    `);
    return stmt.get();
  }
}

module.exports = GraceDatabase;
```

---

## 4️⃣ Main Application

**File: `index.js`**

```javascript
const dotenv = require('dotenv');
const GraceSyncManager = require('./src/sync/SyncManager');
const GraceDatabase = require('./src/db/Database');

dotenv.config();

// Logger
const logger = {
  debug: (msg) => process.env.SYNC_LOG_LEVEL === 'debug' && console.log(`[DEBUG] ${msg}`),
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

// Initialize
const db = new GraceDatabase(process.env.DB_PATH);
const syncManager = new GraceSyncManager({
  baseUrl: process.env.GRACE_BASE_URL,
  apiKey: process.env.GRACE_API_KEY,
  db: db,
  syncInterval: parseInt(process.env.SYNC_INTERVAL_MS || '300000'),
  logger: logger
});

// Event listeners
syncManager.on('cycle-complete', (data) => {
  logger.info(`✅ Cycle: ${data.duration}ms | Pull: ${data.pullResult.products.length} | Push: ${data.pushResult.applied}`);
});

syncManager.on('cycle-error', (error) => {
  logger.error(`Cycle failed: ${error.message}`);
});

syncManager.on('conflict', (conflict) => {
  logger.warn(`Conflict detected for ${conflict.uuid}`);
  // Implémenter votre logique de résolution personnalisée
});

// HTTP Health endpoint (optionnel)
const express = require('express');
const app = express();

app.get('/health', async (req, res) => {
  const health = await syncManager.health();
  res.json(health);
});

app.get('/sync-status', (req, res) => {
  const status = db.syncStatus.getLatest();
  const conflicts = db.syncConflicts.getUnresolved();
  res.json({
    status,
    conflictCount: conflicts.length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`✅ HTTP server on port ${PORT}`);
});

// Start sync loop
syncManager.start();
logger.info(`✅ Grace Sync Manager started`);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  syncManager.stop();
  db.close();
  process.exit(0);
});
```

---

## 5️⃣ Package.json

**File: `package.json`**

```json
{
  "name": "grace-sync-manager",
  "version": "1.0.0",
  "description": "Offline-first sync manager for La Grace app",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "jest",
    "health": "curl http://localhost:3000/health"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "better-sqlite3": "^9.0.0",
    "dotenv": "^16.3.1",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "jest": "^29.7.0"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
```

---

## 🚀 Usage

```bash
# Install dependencies
npm install

# Create .env
cp .env.example .env
# Edit .env with your values

# Start
npm start

# Or dev mode with auto-reload
npm run dev

# Health check
npm run health
```

---

## 📊 Expected Output

```
[INFO] ✅ HTTP server on port 3000
[INFO] ✅ Grace Sync Manager started
[INFO] 🔄 Sync cycle started (2025-01-01T12:00:00.000Z)
[INFO] 📥 Received 3 product change(s)
[INFO] 📝 Applying 3 change(s)...
[INFO] ✅ 3 change(s) applied
[INFO] 📤 Sending 1 pending change(s)...
[INFO] ✅ 1 applied, 2 propagated
[INFO] ✅ Sync cycle completed in 1234ms
[INFO] ✅ Cycle: 1234ms | Pull: 3 | Push: 1
```

---

**Next:** Consulter PRO-SYNC-ARCHITECTURE.md pour la logique complète.

