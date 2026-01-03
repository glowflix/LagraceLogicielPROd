# 🔄 Flux de Synchronisation & Checklist Implémentation

**Date:** 2025-01-01  
**Statut:** ✅ Prêt à déployer

---

## 📊 Diagramme Flux Global

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARCHITECTURE OFFLINE-FIRST PRO                │
└─────────────────────────────────────────────────────────────────┘

                     ┌──────────────────────┐
                     │  Google Sheets       │
                     │  (Maître des noms)   │
                     │  - Carton            │
                     │  - Milliers          │
                     │  - Pièce             │
                     └──────────────────────┘
                              △
                              │ onEdit() auto-trigger
                              │ - Remplit _uuid
                              │ - _updated_at = NOW
                              │ - _version++
                              │
                   ┌──────────┴──────────┐
                   │                     │
              ┌────▼────┐          ┌────▼────┐
              │ proPull │          │ proPush │
              │  (GET)  │          │ (POST)  │
              └────┬────┘          └────┬────┘
                   │                    │
                   │                    │
         ┌─────────▼──────────┐ ┌──────▼──────────┐
         │  Local Database    │ │  Local Database │
         │  (SQL)             │ │  (SQL)          │
         │  - products        │ │  - products     │
         │  - product_units   │ │  - product_units
         │                    │ │  - pending_sync │
         └────────────────────┘ └─────────────────┘
                   △                    │
                   │                    │
                   │ Sync Loop         │ Sync Loop
                   │ (5 min polling)   │ (5 min polling)
                   │                    │
         ┌─────────┴──────────┐ ┌──────▼──────────┐
         │  Node.js Backend   │ │  POS / App      │
         │  (API Server)      │ │  (Mobile App)   │
         │  - Receive Pull    │ │  - Queue pending
         │  - Apply changes   │ │  - Send via Push
         │  - Conflict detect │ │                 │
         └────────────────────┘ └─────────────────┘
```

---

## 🔁 Cycle de Sync (Détaillé)

### Phase 1: onEdit (Sheets)

```
User modifie colonne B (Nom) ou F (Mark)
│
├─ onEdit déclenché automatiquement
│  │
│  ├─ SI _uuid vide
│  │  └─ Générer: _uuid = Utilities.getUuid()
│  │
│  ├─ SI col = 2 (Nom) ou col = 6 (Mark)
│  │  ├─ _updated_at = NOW()
│  │  └─ _version = _version + 1
│  │
│  └─ Log: "[onEdit] Ligne {row} - Version: {newVersion} (Nom/Mark modifié)"
│
└─ Attendu pour Pull suivant ✅
```

### Phase 2: Pull (Local ← Sheets)

```
Local déclenche Pull:  GET ?action=proPull&since=LAST_SYNC
│
├─ Apps Script parcourt Carton, Milliers, Pièce
│  │
│  ├─ Filtre par date: updated_at > since
│  │
│  ├─ Pour chaque ligne modifiée:
│  │  ├─ Récupère: uuid, code, name, mark, version, updated_at
│  │  └─ Ajoute: unit (CARTON/MILLIER/PIECE), row, sheet
│  │
│  └─ Retour: { products: [...], meta: {...} }
│
└─ Local reçoit changements ✅
```

### Phase 3: Apply (Local)

```
Local pour chaque produit changé:
│
├─ UPSERT products:
│  │
│  ├─ SI produit existe:
│  │  ├─ UPDATE name = ..., mark = ..., version = ...
│  │  └─ Où uuid = ...
│  │
│  └─ SI produit n'existe pas:
│     └─ INSERT uuid, name, mark, version, ...
│
├─ PROPAGATE name/mark à product_units:
│  │
│  ├─ UPDATE product_units
│  │  ├─ SET name = ..., mark = ...
│  │  └─ WHERE product_uuid = ...
│  │
│  └─ Affect all units (CARTON, MILLIER, PIECE)
│
├─ Record sync:
│  │
│  ├─ UPDATE products
│  │  ├─ SET synced_at = NOW(), synced_from = 'SHEETS'
│  │  └─ Où uuid = ...
│  │
│  └─ lastSyncTime = NOW()
│
└─ ✅ Local est à jour
```

### Phase 4: Push (Local → Sheets)

```
Local déclenche Push: POST { action: 'proPush', updates: [...] }
│
├─ SI pending changes dans local:
│  │
│  ├─ Pour chaque changement:
│  │  ├─ uuid (obligatoire)
│  │  ├─ name (si changé)
│  │  ├─ mark (si changé)
│  │  └─ Autres champs (stock, prix, etc.)
│  │
│  └─ Envoyer à Apps Script
│
└─ Apps Script (proPush):
   │
   ├─ SI name ou mark changé:
   │  │
   │  ├─ Chercher uuid dans Carton
   │  │  └─ SI trouvé: UPDATE Nom/Mark, _updated_at, _version
   │  │
   │  ├─ Chercher uuid dans Milliers
   │  │  └─ SI trouvé: UPDATE Nom/Mark, _updated_at, _version
   │  │
   │  ├─ Chercher uuid dans Pièce
   │  │  └─ SI trouvé: UPDATE Nom/Mark, _updated_at, _version
   │  │
   │  └─ onEdit se redéclenche (auto _updated_at)
   │
   └─ ✅ Sheets à jour, propagé partout
```

### Phase 5: Conflict Detection

```
SI local_version > sheets_version:
│
├─ Conflit détecté (local plus récent)
│
├─ Options:
│  │
│  ├─ Option 1 (LWW): Garder local
│  │  └─ Enregistrer dans sync_conflicts table (audit)
│  │
│  ├─ Option 2: Garder Sheets
│  │  └─ Overwrite local
│  │
│  └─ Option 3 (manuel): Notifier admin
│     └─ Mettre en queue, attendre résolution
│
└─ Résolu ✅
```

---

## ✅ Checklist Implémentation

### Phase 1: Setup Sheets (Avant Deploy)

- [ ] **Ajouter colonnes tech à droite:**
  - [ ] `_uuid` (Text)
  - [ ] `_updated_at` (Text/Timestamp)
  - [ ] `_version` (Number)
  - [ ] `_deleted` (Checkbox) - optionnel

- [ ] **Vérifier colonnes métier:**
  - [ ] Colonne B = Nom du produit
  - [ ] Colonne F = Mark (ou autre, ajuster dans onEdit)
  - [ ] Code produit, Stock, Prix, etc.

- [ ] **Feuilles à mettre à jour:**
  - [ ] Carton
  - [ ] Milliers
  - [ ] Pièce

### Phase 2: Deploy Code.gs

- [ ] **Copier le nouveau Code.gs** dans Apps Script Editor
- [ ] **Tester onEdit:**
  - [ ] Modifier une cellule B (nom) → vérifier _uuid/version/updated_at
  - [ ] Modifier une cellule F (mark) → vérifier _uuid/version/updated_at
- [ ] **Vérifier les logs:**
  - [ ] Ctrl+Enter → logs montrent "[onEdit] Ligne X - Version: Y"

### Phase 3: Backfill Initial

- [ ] **Ouvrir Sheets**
- [ ] **Menu → "LaGrace Admin" → "🆔 Backfill All UUIDs"**
  - [ ] Attendre le message "✅ Succès! X UUID(s) généré(s)"
- [ ] **Vérifier résultat:**
  - [ ] Menu → "🔄 Sync Status"
  - [ ] Chaque feuille: "Avec _uuid: Y/Y ✅"

### Phase 4: Setup Local Database (SQL)

- [ ] **Créer table `products`:**
  ```sql
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    uuid TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    mark TEXT,
    version INTEGER DEFAULT 0,
    updated_at DATETIME,
    deleted BOOLEAN DEFAULT FALSE,
    synced_from TEXT,
    synced_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```

- [ ] **Créer table `product_units`:**
  ```sql
  CREATE TABLE product_units (
    id INTEGER PRIMARY KEY,
    product_uuid TEXT NOT NULL,
    unit TEXT NOT NULL,
    stock INTEGER,
    price_usd DECIMAL,
    price_fc DECIMAL,
    version INTEGER DEFAULT 0,
    updated_at DATETIME,
    deleted BOOLEAN DEFAULT FALSE,
    synced_from TEXT,
    synced_at DATETIME,
    UNIQUE (product_uuid, unit),
    FOREIGN KEY (product_uuid) REFERENCES products(uuid)
  );
  ```

- [ ] **Créer table `sync_conflicts` (optionnel, audit):**
  ```sql
  CREATE TABLE sync_conflicts (
    id INTEGER PRIMARY KEY,
    uuid TEXT,
    reason TEXT,
    sheets_version INTEGER,
    local_version INTEGER,
    sheets_updated_at DATETIME,
    local_updated_at DATETIME,
    resolved_at DATETIME,
    resolution TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```

### Phase 5: Implement Sync Loop (Node.js)

- [ ] **Créer module `sync.js`:**
  ```javascript
  // sync.js
  class GraceSyncManager {
    constructor(config) {
      this.baseUrl = config.baseUrl;
      this.apiKey = config.apiKey;
      this.db = config.db;
      this.syncInterval = config.syncInterval || 5 * 60 * 1000;
      this.lastSyncTime = null;
    }

    async start() {
      while (true) {
        await this.syncCycle();
        await this.sleep(this.syncInterval);
      }
    }

    async syncCycle() {
      try {
        // 1. Pull
        await this.pull();
        // 2. Push
        await this.push();
        // 3. Update lastSyncTime
        this.lastSyncTime = new Date();
      } catch (error) {
        console.error('Sync error:', error);
      }
    }

    async pull() {
      const since = this.lastSyncTime || new Date(1970, 0, 1);
      const url = new URL(this.baseUrl);
      url.searchParams.set('action', 'proPull');
      url.searchParams.set('since', since.toISOString());

      const response = await fetch(url.toString());
      const data = await response.json();

      if (!data.success) throw new Error(data.error);

      // Apply changes
      for (const product of data.data.products) {
        await this.applyProductChange(product);
      }

      // Handle conflicts
      for (const conflict of data.data.conflicts) {
        await this.logConflict(conflict);
      }
    }

    async push() {
      const pending = await this.db.getPendingChanges();
      if (pending.length === 0) return;

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'proPush',
          key: this.apiKey,
          updates: pending
        })
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      // Mark as synced
      for (const update of pending) {
        await this.db.markSynced(update.uuid);
      }
    }

    async applyProductChange(product) {
      // Upsert product
      await this.db.products.upsert({
        uuid: product.uuid,
        name: product.name,
        mark: product.mark,
        version: product.version,
        updated_at: product.updated_at,
        synced_from: 'SHEETS',
        synced_at: new Date()
      });

      // Propagate to product_units
      await this.db.productUnits.updateByUuid(product.uuid, {
        name: product.name,
        mark: product.mark
      });
    }

    async logConflict(conflict) {
      await this.db.syncConflicts.insert({
        ...conflict,
        created_at: new Date()
      });
    }

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  module.exports = GraceSyncManager;
  ```

- [ ] **Initialiser dans votre app:**
  ```javascript
  const GraceSyncManager = require('./sync.js');

  const syncManager = new GraceSyncManager({
    baseUrl: 'https://script.google.com/macros/d/YOUR_ID/usercontent',
    apiKey: process.env.GRACE_API_KEY,
    db: database,  // Votre instance DB
    syncInterval: 5 * 60 * 1000  // 5 minutes
  });

  syncManager.start();
  ```

### Phase 6: Test End-to-End

- [ ] **Test 1: Modify Name on Sheets**
  - [ ] Ouvrir Carton, modifier cellule B (nom)
  - [ ] Attendre 1 sec
  - [ ] Vérifier _updated_at et _version changent
  - [ ] Déclencher Pull local
  - [ ] Vérifier DB produits mise à jour
  - [ ] Vérifier product_units mis à jour (toutes unités)

- [ ] **Test 2: Modify Stock Local**
  - [ ] Mettre à jour stock en local: `UPDATE product_units SET stock = 100`
  - [ ] Déclencher Push
  - [ ] Vérifier Sheets mise à jour
  - [ ] Vérifier _updated_at changé sur Sheets

- [ ] **Test 3: Conflict (Sheets + Local)**
  - [ ] Modifier nom sur Sheets (10:00, v2)
  - [ ] Modifier nom en local (10:05, v3)
  - [ ] Pull à 10:10
  - [ ] Vérifier: conflit détecté, local gardé (LWW)
  - [ ] Vérifier: enregistré dans sync_conflicts

- [ ] **Test 4: Multi-Unit Propagation**
  - [ ] Insérer produit dans Carton (uuid="test-123")
  - [ ] Insérer MÊME uuid dans Milliers et Pièce
  - [ ] Modifier nom via Push: proPush({uuid:"test-123", name:"New Name"})
  - [ ] Vérifier: Carton, Milliers, Pièce TOUS mis à jour

### Phase 7: Monitoring & Maintenance

- [ ] **Setup Logs Monitoring:**
  - [ ] Apps Script logs → CloudWatch ou similar
  - [ ] Alert on errors

- [ ] **Setup Health Checks:**
  - [ ] Daily: GET ?action=test
  - [ ] Daily: Menu "🔄 Sync Status" → take screenshot
  - [ ] Weekly: Vérifier sync_conflicts table

- [ ] **Backup Procedure:**
  - [ ] Sheets → Download as CSV (weekly)
  - [ ] DB → Dump SQL (daily)

---

## 🚀 Deployment Checklist

### Pre-Deployment

- [ ] Tous les tests Phase 6 passent ✅
- [ ] Backup de Sheets + DB existant
- [ ] API key configurée en Apps Script Properties
- [ ] Node.js sync loop prête à démarrer
- [ ] Documentation mise à jour

### Deployment Steps

1. [ ] Deploy Code.gs (ou copier le code)
2. [ ] Attendre 5-10 sec (Apps Script sync)
3. [ ] Ouvrir Sheets
4. [ ] Cliquer menu "LaGrace Admin" (pour load onOpen)
5. [ ] Exécuter "🆔 Backfill All UUIDs"
6. [ ] Vérifier "🔄 Sync Status" (toutes les lignes avec _uuid)
7. [ ] Démarrer sync loop Node.js: `node sync.js`
8. [ ] Vérifier logs: "✅ Sync cycle X completed"
9. [ ] Tester avec une petite modif (Sheets → Local → Sheets)

### Post-Deployment

- [ ] Monitor logs pendant 1h
- [ ] Vérifier que pulls/pushes fonctionnent
- [ ] Vérifier pas de doublons créés
- [ ] Test avec vraies données (sample)
- [ ] Documenter les issues trouvées
- [ ] Ajuster config/timing si nécessaire

---

## 🛠️ Maintenance Périodique

### Quotidien
- [ ] Vérifier logs (aucune erreur)
- [ ] Vérifier sync_conflicts (aucun non-résolu)

### Hebdomadaire
- [ ] Backup Sheets + DB
- [ ] Vérifier "🔄 Sync Status" → Screenshot
- [ ] Vérifier doublons potentiels (recherche)

### Mensuel
- [ ] Audit UUID duplicates
- [ ] Vérifier cohérence name/mark inter-unités
- [ ] Nettoyer old sync_conflicts

---

**Next Steps:**
1. Valider checklist Phase 1-2
2. Contacter tech support si issues
3. Lancer Test Phase 6 sur données test
4. Si OK → Deployment Phase 7

