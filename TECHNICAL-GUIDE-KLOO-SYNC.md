# 🔬 GUIDE TECHNIQUE: Comprendre le code de synchronisation "kloo"

## 🎯 Objectif

Expliquer le code de synchronisation afin que vous compreniez:
1. Comment "kloo" est créé
2. Comment l'UUID est généré/trouvé
3. Comment le produit est synchronisé vers Sheets
4. Où chercher les problèmes

---

## 📦 Flux de données (Vue d'ensemble)

```
┌─────────────────────────────────────────────────────────────┐
│ API CREATE/UPDATE Product "kloo"                            │
│ POST /api/products { name: "kloo", units: [...] }          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ ProductsRepo.create() ou .update()                          │
│ - Crée le produit en DB                                     │
│ - Crée/met à jour les unités                                │
│ - Génère UUID si absent                                     │
│ - Crée opérations OUTBOX                                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ OutboxRepo.createOperation()                                │
│ CREATE outbox entry:                                        │
│ - entity_code: 'kloo'                                       │
│ - entity_uuid: '96a8387d-b9ff-...'                          │
│ - op_type: 'PRODUCT_PATCH' / 'UNIT_PATCH'                  │
│ - payload_json: { name, is_active, ... }                   │
│ - status: 'pending'                                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ SyncWorker.pushPendingOperations() (toutes les 10s)         │
│ 1. Récupère opérations 'pending'                            │
│ 2. Construit batchPush request                              │
│ 3. POST vers GOOGLE_SHEETS_WEBAPP_URL                       │
│ 4. Marque comme 'acked' si succès                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Google Apps Script (Code.gs)                                │
│ handleProductUpsert() ou handleBatchPush()                  │
│ 1. Cherche produit par UUID                                 │
│ 2. Sinon: cherche par code + mark                           │
│ 3. Auto-génère UUID si absent                               │
│ 4. Met à jour ligne Sheets                                  │
│ 5. Retourne { success: true, applied: [...] }              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ ProductsRepo.markSynced()                                   │
│ UPDATE product_units SET synced_at = NOW()                  │
│ UPDATE outbox SET status = 'acked' WHERE op_id = ...        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 Points clés du code

### 1. Génération UUID automatique

**Fichier:** `src/db/repositories/products.repo.js` (ou similaire)

```javascript
// Lors de la création d'un produit
const finalUUID = product.uuid || existingUUID || generateUUID();
```

**Important:**
- ✅ Si UUID fourni → l'utiliser
- ✅ Si UUID absent → générer automatiquement
- ✅ L'UUID persiste dans product_units.uuid

### 2. Création d'opération OUTBOX

**Fichier:** `src/db/repositories/outbox.repo.js`

Lors de chaque modification de produit/unité:

```javascript
// Créer une opération PRODUCT_PATCH
outboxRepo.createOperation({
  entity_code: 'kloo',
  entity_uuid: product.uuid,
  entity_type: 'product',
  op_type: 'PRODUCT_PATCH',
  payload_json: {
    name: 'kloo',
    is_active: 1,
    ...
  },
  status: 'pending'
});
```

**Statuses:**
- `pending` → en attente d'envoi
- `acked` → envoyé et confirmé par Sheets
- `error` → envoi échoué
- `deleted` → supprimé

### 3. Push vers Sheets (SyncWorker)

**Fichier:** `src/services/sync/sync.worker.js` (lignes ~307-450)

```javascript
async pushProductPatches(patches) {
  // 1. Récupérer le produit complet
  const fullProduct = productsRepo.findByCode(op.entity_code);
  
  // 2. Charger TOUTES les unités (CARTON, MILLIER, PIECE)
  const units = fullProduct.units.map(u => ({
    unit_level: u.unit_level,
    unit_mark: u.unit_mark
  }));
  
  // 3. FAN-OUT: Créer une opération par unité
  const perUnitOps = units.map(unit => ({
    op_id: op.op_id,
    entity: 'products',
    op: 'upsert',
    payload: {
      code: op.entity_code,
      name: finalName,
      unit_level: unit.unit_level,
      unit_mark: unit.unit_mark,
      uuid: uuid  // ← CRUCIAL: UUID inclus
    }
  }));
  
  // 4. POST batch vers Sheets
  await sheetsClient.pushBatch(ops);
}
```

**Important - FAN-OUT:**
```
1 produit + 3 unités (CARTON, MILLIER, PIECE)
       ↓
3 opérations separées envoyées à Sheets
(une par unit_level)
```

### 4. Recherche et création en Sheets (Code.gs)

**Fichier:** `tools/apps-script/Code.gs` (lignes ~972-1150)

```javascript
function handleProductUpsert(payload, entityType) {
  const { code, uuid, unit_level, unit_mark, ... } = payload;
  
  // PRIORITÉ 1: Chercher par UUID
  let rowIndex = -1;
  for (let i = 0; i < values.length; i++) {
    const rowUuid = values[i][colUuid - 1];
    
    if (uuid && rowUuid && rowUuid === uuid) {
      rowIndex = i + 2; // Trouvé!
      break;
    }
    
    // PRIORITÉ 2: Chercher par code + mark
    if (normalizeCode(values[i][colCode - 1]) === normalizeCode(code) &&
        normalizeMark(values[i][colMark - 1]) === normalizeMark(unit_mark)) {
      rowIndex = i + 2; // Trouvé!
      break;
    }
  }
  
  // UUID AUTO-GÉNÉRÉ si absent
  let finalUuid = uuid || existingUuid || generateFullUUID();
  
  // UPDATE ou CREATE la ligne
  if (rowIndex > 0) {
    // UPDATE: modifier la ligne existante
    sheet.getRange(rowIndex, colCode).setValue(code);
    // ... mettre à jour autres colonnes ...
    sheet.getRange(rowIndex, colUuid).setValue(finalUuid);
    sheet.getRange(rowIndex, colUpdatedAt).setValue(nowIso());
  } else {
    // CREATE: nouvelle ligne
    sheet.appendRow([code, name, ..., finalUuid, nowIso(), ...]);
  }
}
```

---

## 🔍 Problèmes courants et où chercher

### Problème 1: "kloo" ne s'apparaît pas en Sheets

**Cause possible #1: Pas de synchronisation du tout**
- Vérifier: `synced_at IS NULL` en BD
- Chercher: "PRODUCT_PATCH" dans `logs/sync.log`
- Solution: Vérifier GOOGLE_SHEETS_WEBAPP_URL

**Cause possible #2: Produit créé mais pas d'unités**
- Vérifier: `product_units` table est vide pour kloo
- Chercher: "units count: 0" dans VERIFY-KLOO-SYNC.js
- Solution: Créer l'unité CARTON manuellement

**Cause possible #3: Code normalisé différent**
- Vérifier: `normalizeCode('kloo')` vs valeur en Sheets
- Chercher: Espaces, accents, majuscules/minuscules
- Solution: Utiliser `testCodeNormalization()` dans Apps Script

### Problème 2: UUID ne correspond pas

**Symptôme:** UUID en DB ≠ UUID en Sheets

**Où chercher:**
1. `product_units.uuid` en BD
2. Colonne `_uuid` en Sheets
3. Logs VERIFY-KLOO-SYNC.js

**Solution:** Mettre à jour UUID en Sheets:
```javascript
// Dans Sheets, mettre à jour manuellement:
sheet.getRange(rowNumber, colUuid).setValue(uuid);
```

### Problème 3: OUTBOX n'a pas d'opérations

**Symptôme:** OUTBOX vide pour "kloo"

**Où chercher:**
```bash
sqlite3 database.db "SELECT * FROM outbox WHERE entity_code='kloo';"
```

**Cause:** Produit jamais modifié
**Solution:** Modifier le produit (changez le prix ou le nom)

### Problème 4: synced_at reste NULL après push

**Symptôme:** 
```bash
sqlite3 database.db "SELECT synced_at FROM product_units WHERE product_id=1;"
# Retourne: NULL
```

**Où chercher:**
1. `logs/sync.log` → [PUSH-SYNC] ou [PRODUCT-PATCH]
2. `logs/error.log` → erreurs de push
3. Google Sheets → Tools → Logs → Apps Script errors

**Cause probable:** Push vers Sheets échoué
**Solutions:**
1. Vérifier GOOGLE_SHEETS_WEBAPP_URL (valide + accessible)
2. Vérifier que doProPush() existe en Code.gs
3. Vérifier la connexion Internet

---

## 📊 Schéma des tables critiques

### Table: `products`
```sql
id INTEGER PRIMARY KEY,
code TEXT UNIQUE,
name TEXT,
uuid TEXT,
is_active BOOLEAN,
created_at TIMESTAMP,
updated_at TIMESTAMP
```

### Table: `product_units`
```sql
id INTEGER PRIMARY KEY,
product_id INTEGER,
unit_level TEXT (CARTON|MILLIER|PIECE),
unit_mark TEXT,
stock_initial INTEGER,
stock_current INTEGER,
sale_price_usd DECIMAL,
sale_price_fc DECIMAL,
purchase_price_usd DECIMAL,
uuid TEXT,
synced_at TIMESTAMP,  ← NULL = pas synchronisé
last_update TIMESTAMP
```

### Table: `outbox`
```sql
op_id INTEGER PRIMARY KEY,
entity_code TEXT (ex: 'kloo'),
entity_uuid TEXT,
entity_type TEXT (product, unit, sale, etc),
op_type TEXT (PRODUCT_PATCH, UNIT_PATCH, STOCK_MOVE),
payload_json TEXT (JSON serialisé),
status TEXT (pending, acked, error),
error_message TEXT,
attempts INTEGER,
created_at TIMESTAMP
```

---

## 🔧 Debug - Commandes utiles

### Vérifier le produit complet
```bash
sqlite3 database.db << EOF
.mode line
SELECT * FROM products WHERE name='kloo';
SELECT * FROM product_units WHERE product_id=(SELECT id FROM products WHERE name='kloo');
SELECT * FROM outbox WHERE entity_code='kloo' ORDER BY created_at DESC;
EOF
```

### Vérifier la séquence de synchronisation
```bash
# Chercher toutes les opérations kloo
sqlite3 database.db "SELECT op_id, op_type, status, created_at FROM outbox WHERE entity_code='kloo' ORDER BY created_at;"

# Affichage expected:
# 1 | PRODUCT_PATCH | acked | 2026-01-01 12:00:00
# 2 | UNIT_PATCH    | acked | 2026-01-01 12:00:05
```

### Tester la recherche Sheets manuellement
```javascript
// Dans Google Sheets → Tools → Apps Script, exécutez:
testProductSearchLogic();

// Cela simulera exactement ce que handleProductUpsert fait
```

### Forcer une resynchronisation
```bash
# Marquer synced_at comme NULL pour forcer un resync
sqlite3 database.db "UPDATE product_units SET synced_at = NULL WHERE product_id=1;"

# Créer une nouvelle opération OUTBOX
sqlite3 database.db "INSERT INTO outbox (...) VALUES (...);"
```

---

## 🚀 Résumé: Points critiques à vérifier

| Point | Où vérifier | Commande | Expected |
|-------|---|---|---|
| Produit existe | BD | `sqlite3 database.db "SELECT * FROM products WHERE name='kloo';"` | 1 ligne |
| UUID généré | BD | `sqlite3 database.db "SELECT uuid FROM products WHERE name='kloo';"` | UUID non-vide |
| Unité créée | BD | `sqlite3 database.db "SELECT COUNT(*) FROM product_units WHERE product_id=1;"` | 1 (min) |
| Opération OUTBOX | BD | `sqlite3 database.db "SELECT COUNT(*) FROM outbox WHERE entity_code='kloo' AND status='pending';"` | 1+ après modification |
| Push effectué | Logs | `grep PRODUCT_PATCH logs/sync.log` | [PRODUCT-PATCH] messages |
| Réponse Sheets | Logs | `grep "✅ Batch acked" logs/sync.log` | ✅ messages |
| synced_at mis à jour | BD | `sqlite3 database.db "SELECT synced_at FROM product_units WHERE product_id=1;"` | Date/heure non-NULL |
| Produit en Sheets | Google Sheets | Chercher "kloo" manuellement | 1 ligne trouvée |
| UUID en Sheets | Google Sheets | Colonne "_uuid" pour kloo | 96a8387d-b9ff-... |

---

## 📚 Fichiers à consulter

| Problème | Fichier | Ligne |
|----------|---|---|
| Création produit | src/db/repositories/products.repo.js | ~50-150 |
| Création OUTBOX | src/db/repositories/outbox.repo.js | ~30-80 |
| Push en lots | src/services/sync/sync.worker.js | ~307-450 |
| Recherche Sheets | tools/apps-script/Code.gs | ~972-1100 |
| Propagation UUID | tools/apps-script/Code.gs | ~508-570 |

---

## ✅ Checklist technique

Avant de déclarer "synchronisé":

- [ ] `products.uuid` = `96a8387d-b9ff-...`
- [ ] `product_units.uuid` = `96a8387d-b9ff-...`
- [ ] `product_units.synced_at` = NOT NULL
- [ ] OUTBOX contient au moins 1 PRODUCT_PATCH avec status 'acked'
- [ ] Google Sheets contient "kloo" avec UUID matching
- [ ] Colonne `_uuid` en Sheets = `96a8387d-b9ff-...`
- [ ] `doProPush()` existe et fonctionne en Code.gs
- [ ] Logs affichent `✅ Batch acked` pour le produit

---

**🎉 Félicitations! Vous comprenez maintenant le flux technique complet.**
