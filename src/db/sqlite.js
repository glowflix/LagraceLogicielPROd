import Database from 'better-sqlite3';
import { getDbPath, ensureDirs } from '../core/paths.js';
import { logger } from '../core/logger.js';
import { generateUUID } from '../core/crypto.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ✅ ESM: Créer __dirname et __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

/**
 * Initialise et retourne la connexion SQLite
 */
export function getDb() {
  if (db) {
    return db;
  }

  try {
    // S'assurer que les dossiers existent
    ensureDirs();
    
    const dbPath = getDbPath();
    const dbDir = path.dirname(dbPath);
    
    // Créer le dossier si nécessaire
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Ouvrir la base de données
    db = new Database(dbPath);
    
    // PRAGMA critiques pour comportement PRO (cohérence + performance)
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    
    logger.info(`Base de données SQLite connectée: ${dbPath}`);
    
    return db;
  } catch (error) {
    logger.error('Erreur connexion SQLite:', error);
    throw error;
  }
}

/**
 * Wrapper Promise pour exécuter du SQL
 */
export async function runAsync(sql, params = []) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

/**
 * Wrapper Promise pour obtenir une ligne
 */
export async function getAsync(sql, params = []) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Wrapper Promise pour obtenir toutes les lignes
 */
export async function allAsync(sql, params = []) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Ferme la connexion SQLite
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
    logger.info('Base de données SQLite fermée');
  }
}

/**
 * Exécute une migration SQL
 */
export function runMigration(sql) {
  const database = getDb();
  try {
    database.exec(sql);
    logger.info('Migration exécutée avec succès');
    return true;
  } catch (error) {
    logger.error('Erreur migration:', error);
    throw error;
  }
}

/**
 * Vérifie si une table existe
 */
export function tableExists(tableName) {
  const database = getDb();
  try {
    const result = database.prepare(`
      SELECT COUNT(*) as count 
      FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    return result.count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Vérifie si une colonne existe dans une table
 */
export function columnExists(tableName, columnName) {
  const database = getDb();
  try {
    const result = database.prepare(`
      SELECT COUNT(*) as count 
      FROM pragma_table_info(?) 
      WHERE name = ?
    `).get(tableName, columnName);
    return result.count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Assure qu'une colonne existe dans une table (ajoute si manquante)
 * @param {string} tableName - Nom de la table
 * @param {string} columnName - Nom de la colonne
 * @param {string} columnType - Type SQL (TEXT, REAL, INTEGER, etc.)
 * @returns {boolean} true si la colonne a été ajoutée, false si elle existait déjà
 */
export function ensureColumn(tableName, columnName, columnType = 'TEXT') {
  const database = getDb();
  try {
    // ✅ CORRECTION: Vérifier d'abord que la table existe
    if (!tableExists(tableName)) {
      logger.debug(`[MIGRATION] ⚠️  Table ${tableName} n'existe pas encore, skip colonne ${columnName}`);
      return false; // Table sera créée lors d'une future migration
    }
    
    if (columnExists(tableName, columnName)) {
      logger.debug(`[MIGRATION] Colonne ${tableName}.${columnName} existe déjà`);
      return false;
    }
    
    logger.info(`[MIGRATION] Ajout de la colonne ${columnName} (${columnType}) à la table ${tableName}...`);
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
    logger.info(`✅ [MIGRATION] Colonne ${tableName}.${columnName} ajoutée avec succès`);
    return true;
  } catch (error) {
    // Ignorer l'erreur si la colonne existe déjà (race condition)
    if (error.message.includes('duplicate column') || error.message.includes('already exists')) {
      logger.debug(`[MIGRATION] Colonne ${tableName}.${columnName} existe déjà (ignoré)`);
      return false;
    }
    // Ignorer aussi si la table n'existe pas (sera créée après)
    if (error.message.includes('no such table')) {
      logger.debug(`[MIGRATION] Table ${tableName} n'existe pas encore (sera créée après)`);
      return false;
    }
    logger.error(`[MIGRATION] Erreur ajout colonne ${tableName}.${columnName}:`, error);
    throw error;
  }
}

/**
 * Applique les migrations nécessaires (ajout de colonnes manquantes)
 */
function applyMigrations() {
  const database = getDb();
  try {
    logger.info('[MIGRATION] Vérification des migrations nécessaires...');
    
    // ✅ IMPORTANT: Vérifier que les tables existent avant de migrer
    // Si une table n'existe pas, les migrations vont échouer
    const requiredTables = ['products', 'product_units', 'users', 'debts', 'sales', 'sale_items'];
    const missingTables = requiredTables.filter(t => !tableExists(t));
    
    if (missingTables.length > 0) {
      logger.info(`[MIGRATION] ⚠️  Tables manquantes: ${missingTables.join(', ')}`);
      logger.info('[MIGRATION] Création des tables de base...');
      
      // ✅ FALLBACK: Créer les tables essentielles si schema.sql n'a pas pu être trouvé
      try {
        // Table products
        if (!tableExists('products')) {
          database.exec(`
            CREATE TABLE IF NOT EXISTS products (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              description TEXT,
              uuid TEXT UNIQUE
            )
          `);
          logger.info('[MIGRATION] ✅ Table products créée');
        }
        
        // Table product_units
        if (!tableExists('product_units')) {
          database.exec(`
            CREATE TABLE IF NOT EXISTS product_units (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              product_id INTEGER,
              unit_level INTEGER DEFAULT 1,
              unit_name TEXT,
              quantity_per_unit REAL,
              uuid TEXT UNIQUE,
              FOREIGN KEY(product_id) REFERENCES products(id)
            )
          `);
          logger.info('[MIGRATION] ✅ Table product_units créée');
        }
        
        // Table users
        if (!tableExists('users')) {
          database.exec(`
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT UNIQUE NOT NULL,
              password TEXT,
              is_admin INTEGER DEFAULT 0,
              uuid TEXT UNIQUE,
              is_vendeur INTEGER DEFAULT 1,
              is_gerant_stock INTEGER DEFAULT 0,
              can_manage_products INTEGER DEFAULT 0
            )
          `);
          logger.info('[MIGRATION] ✅ Table users créée');
        }
        
        // Table sales
        if (!tableExists('sales')) {
          database.exec(`
            CREATE TABLE IF NOT EXISTS sales (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER,
              total REAL,
              sale_date TEXT,
              uuid TEXT UNIQUE,
              client_phone TEXT,
              origin TEXT DEFAULT 'LOCAL',
              FOREIGN KEY(user_id) REFERENCES users(id)
            )
          `);
          logger.info('[MIGRATION] ✅ Table sales créée');
        }
        
        // Table sale_items
        if (!tableExists('sale_items')) {
          database.exec(`
            CREATE TABLE IF NOT EXISTS sale_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              sale_id INTEGER,
              product_id INTEGER,
              unit_level INTEGER,
              quantity REAL,
              price REAL,
              uuid TEXT UNIQUE,
              product_unit_uuid TEXT,
              FOREIGN KEY(sale_id) REFERENCES sales(id),
              FOREIGN KEY(product_id) REFERENCES products(id)
            )
          `);
          logger.info('[MIGRATION] ✅ Table sale_items créée');
        }
        
        // Table debts
        if (!tableExists('debts')) {
          database.exec(`
            CREATE TABLE IF NOT EXISTS debts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              client_name TEXT,
              amount REAL,
              debt_date TEXT,
              uuid TEXT UNIQUE,
              client_phone TEXT,
              product_description TEXT,
              total_usd REAL,
              debt_fc_in_usd REAL,
              note TEXT,
              synced_at TEXT
            )
          `);
          logger.info('[MIGRATION] ✅ Table debts créée');
        }
        
        logger.info('[MIGRATION] ✅ Tables de base créées avec succès');
      } catch (tableError) {
        logger.error('[MIGRATION] ❌ Erreur création tables de base:', tableError.message);
        throw tableError;
      }
      
      // Maintenant continuer avec les migrations
    }
    
    // Migrations pour la table products
    const productsUuidAdded = ensureColumn('products', 'uuid', 'TEXT');
    
    // Migrations pour la table product_units
    const unitsUuidAdded = ensureColumn('product_units', 'uuid', 'TEXT');
    
    // Migrations pour la table users
    const usersUuidAdded = ensureColumn('users', 'uuid', 'TEXT');
    ensureColumn('users', 'is_vendeur', 'INTEGER DEFAULT 1');
    ensureColumn('users', 'is_gerant_stock', 'INTEGER DEFAULT 0');
    ensureColumn('users', 'can_manage_products', 'INTEGER DEFAULT 0');
    
    // Migrations pour la table debts
    ensureColumn('debts', 'uuid', 'TEXT');
    ensureColumn('debts', 'client_phone', 'TEXT');
    ensureColumn('debts', 'product_description', 'TEXT'); // CRITIQUE: manquante dans les anciennes bases
    ensureColumn('debts', 'total_usd', 'REAL');
    ensureColumn('debts', 'debt_fc_in_usd', 'REAL');
    ensureColumn('debts', 'note', 'TEXT');
    ensureColumn('debts', 'synced_at', 'TEXT');
    
    // Migrations pour la table sales (CRITIQUE pour synchronisation Sheets)
    const salesUuidAdded = ensureColumn('sales', 'uuid', 'TEXT');
    ensureColumn('sales', 'client_phone', 'TEXT');
    // Note: origin peut déjà exister, on vérifie avant d'ajouter
    if (!columnExists('sales', 'origin')) {
      ensureColumn('sales', 'origin', 'TEXT');
      // Mettre à jour les valeurs existantes
      try {
        database.exec(`UPDATE sales SET origin = 'LOCAL' WHERE origin IS NULL`);
      } catch (e) {
        logger.warn('[MIGRATION] Erreur mise à jour origin:', e.message);
      }
    }
    
    // Migrations pour la table sale_items (CRITIQUE pour synchronisation Sheets)
    const saleItemsUuidAdded = ensureColumn('sale_items', 'uuid', 'TEXT');
    
    // ✅ MIGRATION: Ajouter product_unit_uuid (RÉFÉRENCE STABLE à l'unité)
    const saleItemsUnitUuidAdded = ensureColumn('sale_items', 'product_unit_uuid', 'TEXT');
    
    // Backfill product_unit_uuid pour les items existants
    if (saleItemsUnitUuidAdded || columnExists('sale_items', 'product_unit_uuid')) {
      try {
        const itemsWithoutUnitUuid = database.prepare(`
          SELECT si.id 
          FROM sale_items si
          WHERE si.product_unit_uuid IS NULL OR TRIM(si.product_unit_uuid) = ''
        `).all();
        
        if (itemsWithoutUnitUuid.length > 0) {
          logger.info(`[MIGRATION] Backfill de ${itemsWithoutUnitUuid.length} product_unit_uuid(s) pour les items existants...`);
          
          const updateStmt = database.prepare(`
            UPDATE sale_items
            SET product_unit_uuid = (
              SELECT pu.uuid
              FROM product_units pu
              WHERE pu.product_id = sale_items.product_id
                AND pu.unit_level = sale_items.unit_level
              LIMIT 1
            )
            WHERE id = ?
          `);
          
          for (const item of itemsWithoutUnitUuid) {
            updateStmt.run(item.id);
          }
          
          logger.info(`[MIGRATION] ✅ ${itemsWithoutUnitUuid.length} product_unit_uuid(s) rempli(s) pour les items existants`);
        }
      } catch (error) {
        logger.warn('[MIGRATION] Erreur backfill product_unit_uuid:', error.message);
      }
    }
    
    // Générer des UUIDs pour les produits existants qui n'en ont pas
    if (productsUuidAdded || columnExists('products', 'uuid')) {
      try {
        const productsWithoutUuid = database.prepare("SELECT id FROM products WHERE uuid IS NULL OR uuid = '' OR LENGTH(TRIM(uuid)) = 0").all();
        
        if (productsWithoutUuid.length > 0) {
          logger.info(`[MIGRATION] Génération de ${productsWithoutUuid.length} UUID(s) pour les produits existants...`);
          const updateStmt = database.prepare('UPDATE products SET uuid = ? WHERE id = ?');
          
          for (const product of productsWithoutUuid) {
            const uuid = generateUUID();
            updateStmt.run(uuid, product.id);
          }
          
          logger.info(`[MIGRATION] ✅ ${productsWithoutUuid.length} UUID(s) généré(s) pour les produits`);
        }
      } catch (error) {
        logger.warn('[MIGRATION] Erreur génération UUIDs produits:', error.message);
      }
    }
    
    // Générer des UUIDs pour les unités existantes qui n'en ont pas
    if (unitsUuidAdded || columnExists('product_units', 'uuid')) {
      try {
        const unitsWithoutUuid = database.prepare("SELECT id FROM product_units WHERE uuid IS NULL OR uuid = '' OR LENGTH(TRIM(uuid)) = 0").all();
        
        if (unitsWithoutUuid.length > 0) {
          logger.info(`[MIGRATION] Génération de ${unitsWithoutUuid.length} UUID(s) pour les unités existantes...`);
          const updateStmt = database.prepare('UPDATE product_units SET uuid = ? WHERE id = ?');
          
          for (const unit of unitsWithoutUuid) {
            const uuid = generateUUID();
            updateStmt.run(uuid, unit.id);
          }
          
          logger.info(`[MIGRATION] ✅ ${unitsWithoutUuid.length} UUID(s) généré(s) pour les unités`);
        }
      } catch (error) {
        logger.warn('[MIGRATION] Erreur génération UUIDs unités:', error.message);
      }
    }
    
    // Générer des UUIDs pour les utilisateurs existants qui n'en ont pas
    if (usersUuidAdded || columnExists('users', 'uuid')) {
      try {
        const usersWithoutUuid = database.prepare("SELECT id FROM users WHERE uuid IS NULL OR uuid = '' OR LENGTH(TRIM(uuid)) = 0").all();
        
        if (usersWithoutUuid.length > 0) {
          logger.info(`[MIGRATION] Génération de ${usersWithoutUuid.length} UUID(s) pour les utilisateurs existants...`);
          const updateStmt = database.prepare('UPDATE users SET uuid = ? WHERE id = ?');
          
          for (const user of usersWithoutUuid) {
            const uuid = generateUUID();
            updateStmt.run(uuid, user.id);
          }
          
          logger.info(`[MIGRATION] ✅ ${usersWithoutUuid.length} UUID(s) généré(s) pour les utilisateurs`);
        }
      } catch (error) {
        logger.warn('[MIGRATION] Erreur génération UUIDs utilisateurs:', error.message);
      }
    }
    
    // Générer des UUIDs pour les ventes existantes qui n'en ont pas
    if (salesUuidAdded || columnExists('sales', 'uuid')) {
      try {
        const salesWithoutUuid = database.prepare("SELECT id FROM sales WHERE uuid IS NULL OR uuid = '' OR LENGTH(TRIM(uuid)) = 0").all();
        
        if (salesWithoutUuid.length > 0) {
          logger.info(`[MIGRATION] Génération de ${salesWithoutUuid.length} UUID(s) pour les ventes existantes...`);
          const updateStmt = database.prepare('UPDATE sales SET uuid = ? WHERE id = ?');
          
          for (const sale of salesWithoutUuid) {
            const uuid = generateUUID();
            updateStmt.run(uuid, sale.id);
          }
          
          logger.info(`[MIGRATION] ✅ ${salesWithoutUuid.length} UUID(s) généré(s) pour les ventes`);
        }
      } catch (error) {
        logger.warn('[MIGRATION] Erreur génération UUIDs ventes:', error.message);
      }
    }
    
    // Générer des UUIDs pour les items de vente existants qui n'en ont pas
    if (saleItemsUuidAdded || columnExists('sale_items', 'uuid')) {
      try {
        const itemsWithoutUuid = database.prepare("SELECT id FROM sale_items WHERE uuid IS NULL OR uuid = '' OR LENGTH(TRIM(uuid)) = 0").all();
        
        if (itemsWithoutUuid.length > 0) {
          logger.info(`[MIGRATION] Génération de ${itemsWithoutUuid.length} UUID(s) pour les items de vente existants...`);
          const updateStmt = database.prepare('UPDATE sale_items SET uuid = ? WHERE id = ?');
          
          for (const item of itemsWithoutUuid) {
            const uuid = generateUUID();
            updateStmt.run(uuid, item.id);
          }
          
          logger.info(`[MIGRATION] ✅ ${itemsWithoutUuid.length} UUID(s) généré(s) pour les items de vente`);
        }
      } catch (error) {
        logger.warn('[MIGRATION] Erreur génération UUIDs items de vente:', error.message);
      }
    }
    
    // Créer les index uniques sur uuid si les colonnes existent
    try {
      if (columnExists('products', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_uuid ON products(uuid) WHERE uuid IS NOT NULL');
      }
      if (columnExists('product_units', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_uuid ON product_units(uuid) WHERE uuid IS NOT NULL');
      }
      if (columnExists('debts', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_uuid ON debts(uuid) WHERE uuid IS NOT NULL');
      }
      if (columnExists('users', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid) WHERE uuid IS NOT NULL');
      }
      if (columnExists('sales', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_uuid ON sales(uuid) WHERE uuid IS NOT NULL');
      }
      if (columnExists('sale_items', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_items_uuid ON sale_items(uuid) WHERE uuid IS NOT NULL');
      }
      // ✅ Index sur product_unit_uuid pour les triggers et requêtes
      if (columnExists('sale_items', 'product_unit_uuid')) {
        database.exec('CREATE INDEX IF NOT EXISTS idx_sale_items_unit_uuid ON sale_items(product_unit_uuid)');
      }
    } catch (error) {
      // Ignorer si l'index existe déjà
      if (!error.message.includes('already exists')) {
        logger.warn('[MIGRATION] Erreur création index uuid:', error.message);
      }
    }
    
    logger.info('[MIGRATION] ✅ Toutes les migrations appliquées avec succès');
  } catch (error) {
    logger.error('[MIGRATION] ❌ Erreur lors des migrations:', error);
    // Ne pas bloquer l'application si migration échoue (colonne peut exister)
    if (!error.message.includes('duplicate column') && !error.message.includes('already exists')) {
      logger.warn('[MIGRATION] ⚠️  Migration partielle, certaines colonnes peuvent être manquantes');
    }
  }
}

/**
 * Initialise le schéma de la base de données
 */
export function initSchema() {
  const database = getDb();
  
  // ✅ CORRECTION: Chercher schema.sql à plusieurs emplacements possibles en production
  // 1. RESOURCES_ROOT (défini par Electron pour les extraResources)
  // 2. APP_ROOT (application root)
  // 3. process.resourcesPath (path Electron standard)
  // 4. __dirname (fallback DEV)
  
  const possiblePaths = [
    process.env.RESOURCES_ROOT && path.join(process.env.RESOURCES_ROOT, 'src/db/schema.sql'),
    process.env.APP_ROOT && path.join(process.env.APP_ROOT, 'src/db/schema.sql'),
    process.resourcesPath && path.join(process.resourcesPath, 'src/db/schema.sql'),
    path.join(__dirname, 'schema.sql'), // DEV: chemin direct
    path.join(process.cwd(), 'src/db/schema.sql'), // Fallback
  ].filter(Boolean);
  
  let schemaPath = null;
  
  // Chercher le premier chemin qui existe
  for (const checkPath of possiblePaths) {
    logger.info(`[SCHEMA] Vérification: ${checkPath}`);
    if (fs.existsSync(checkPath)) {
      schemaPath = checkPath;
      logger.info(`[SCHEMA] ✅ Trouvé: ${schemaPath}`);
      break;
    }
  }
  
  try {
    if (!schemaPath) {
      logger.warn('[SCHEMA] ❌ schema.sql introuvable à aucun emplacement');
      logger.warn('[SCHEMA] Chemins vérifiés:');
      possiblePaths.forEach((p, i) => {
        logger.warn(`  ${i + 1}. ${p}`);
      });
      logger.warn(`[SCHEMA] RESOURCES_ROOT=${process.env.RESOURCES_ROOT}`);
      logger.warn(`[SCHEMA] APP_ROOT=${process.env.APP_ROOT}`);
      logger.warn(`[SCHEMA] process.resourcesPath=${process.resourcesPath}`);
      logger.warn(`[SCHEMA] __dirname=${__dirname}`);
      logger.warn(`[SCHEMA] cwd=${process.cwd()}`);
      logger.warn('[SCHEMA] ⚠️  Création des tables de base via fallback SQL...');
      
      // ✅ FALLBACK: Créer les tables de base directement en SQL
      // Ceci garantit qu'au moins les tables existent avant les migrations
      const fallbackSQL = `
        -- Tables de base avec CREATE TABLE IF NOT EXISTS
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          uuid TEXT UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS product_units (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          unit_name TEXT NOT NULL,
          unit_level INTEGER NOT NULL,
          quantity_per_unit REAL NOT NULL,
          price_in_fc REAL NOT NULL,
          price_in_usd REAL,
          uuid TEXT UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          uuid TEXT UNIQUE,
          is_vendeur INTEGER DEFAULT 1,
          is_gerant_stock INTEGER DEFAULT 0,
          can_manage_products INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS sales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          total_amount_fc REAL NOT NULL DEFAULT 0,
          total_amount_usd REAL,
          uuid TEXT UNIQUE,
          client_phone TEXT,
          origin TEXT DEFAULT 'LOCAL',
          synced_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        
        CREATE TABLE IF NOT EXISTS sale_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          unit_level INTEGER,
          quantity REAL NOT NULL,
          price_in_fc REAL NOT NULL,
          price_in_usd REAL,
          uuid TEXT UNIQUE,
          product_unit_uuid TEXT,
          FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products(id)
        );
        
        CREATE TABLE IF NOT EXISTS debts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_name TEXT NOT NULL,
          product_description TEXT,
          debt_amount_fc REAL NOT NULL,
          debt_amount_usd REAL,
          debt_fc_in_usd REAL,
          total_usd REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          uuid TEXT UNIQUE,
          client_phone TEXT,
          note TEXT,
          synced_at DATETIME
        );
      `;
      
      try {
        database.exec(fallbackSQL);
        logger.info('[SCHEMA] ✅ Tables de base créées via fallback SQL');
      } catch (fallbackError) {
        logger.warn('[SCHEMA] Certaines tables existent déjà (acceptable):', fallbackError.message);
      }
      
      // Ensuite appliquer les migrations pour ajouter les colonnes manquantes
      applyMigrations();
      return;
    }
    
    logger.info('[SCHEMA] ✅ Chargement de schema.sql...');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    try {
      database.exec(schema);
      logger.info('[SCHEMA] ✅ Schéma de base de données initialisé avec succès');
    } catch (schemaError) {
      // Les erreurs de contraintes UNIQUE ou KEY peuvent être normales si la table existe déjà
      if (schemaError.message.includes('UNIQUE') || 
          schemaError.message.includes('already exists') ||
          schemaError.message.includes('duplicate') ||
          schemaError.message.includes('product_unit_uuid')) {
        logger.info('[SCHEMA] ℹ️  Certain schéma éléments existent déjà, utilisation des migrations pour l\'update');
      } else {
        throw schemaError;
      }
    }
    
    // Appliquer les migrations après l'initialisation du schéma
    applyMigrations();
  } catch (error) {
    logger.error('[SCHEMA] ❌ Erreur initialisation schéma:', error);
    throw error;
  }
}

// Fermer proprement à la fin du processus
process.on('exit', () => {
  closeDb();
});

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});

