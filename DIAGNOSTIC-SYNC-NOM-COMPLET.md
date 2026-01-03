# 🔍 DIAGNOSTIC COMPLET: Nom du Produit Sync Local → Sheets

## 📋 CHECKLIST DE VÉRIFICATION

### 1️⃣ BASE DE DONNÉES LOCALE (SQLite)

**Fichier:** `src/db/schema.sql`

#### Table: `products`
```sql
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,        -- ✅ Code présent
  name TEXT NOT NULL,               -- ✅ Nom TOUJOURS présent
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  synced_at TEXT                    -- NULL = jamais synced
);
```

**Vérification requise:**
```sql
-- Vérifier que TOUS les produits ont un nom
SELECT COUNT(*) as total_products FROM products;
SELECT COUNT(*) as products_with_name FROM products WHERE name IS NOT NULL AND name != '';
SELECT COUNT(*) as products_without_name FROM products WHERE name IS NULL OR name = '';

-- Lister les produits SANS nom (anomalies)
SELECT id, code, name FROM products WHERE name IS NULL OR name = '';

-- Vérifier les noms visibles
SELECT code, name, uuid, synced_at FROM products LIMIT 10;
```

---

### 2️⃣ TABLE: `product_units` (Unités associées)

```sql
CREATE TABLE product_units (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL,      -- FK vers products
  unit_level TEXT,                  -- CARTON|MILLIER|PIECE
  unit_mark TEXT,                   -- Mark de l'unité
  stock_current REAL,
  sale_price_usd REAL,
  purchase_price_usd REAL,
  synced_at TEXT
);
```

**Vérification requise:**
```sql
-- Vérifier que chaque unité a un product_id valide
SELECT COUNT(*) as total_units FROM product_units;
SELECT COUNT(*) as units_with_product FROM product_units WHERE product_id IS NOT NULL;

-- Charger les unités AVEC leurs noms (via JOIN)
SELECT 
  pu.uuid,
  pu.unit_level,
  pu.unit_mark,
  p.code,
  p.name,
  pu.synced_at
FROM product_units pu
LEFT JOIN products p ON pu.product_id = p.id
LIMIT 10;
```

---

### 3️⃣ TABLE: `sync_operations` (OUTBOX - Opérations pending)

```sql
CREATE TABLE sync_operations (
  id INTEGER PRIMARY KEY,
  op_id TEXT UNIQUE,                -- ID pour idempotence
  op_type TEXT,                     -- PRODUCT_PATCH|UNIT_PATCH
  entity_uuid TEXT,                 -- UUID du produit
  entity_code TEXT,                 -- Code du produit
  payload_json TEXT,                -- ✅ CONTIENT LE NOM
  status TEXT,                       -- pending|sent|acked
  created_at TEXT,
  acked_at TEXT
);
```

**Vérification requise:**
```sql
-- Vérifier les opérations pending
SELECT op_id, op_type, entity_code, status, payload_json FROM sync_operations WHERE status='pending' LIMIT 5;

-- Vérifier que payload_json CONTIENT le nom
SELECT 
  op_id,
  entity_code,
  json_extract(payload_json, '$.name') as payload_name,
  status
FROM sync_operations 
WHERE status='pending' 
LIMIT 5;
```

---

### 4️⃣ FLUX: Node.js → Sheets (sync.worker.js)

**Fichier:** `src/services/sync/sync.worker.js` (ligne 307-370)

#### Étape 1: Charge le produit complet
```javascript
const fullProduct = productsRepo.findByCode(op.entity_code);
// {
//   uuid: '96a8387d...',
//   code: 'lolo',
//   name: 'lolo',    ✅ NOM CHARGÉ
//   units: [...]
// }
```

**Vérification requise:**
```javascript
// Dans logs, chercher:
// "✅ Loaded X unit(s) from DB: CARTON"
// "Name value: finalName='lolo' (source: defined)"
```

#### Étape 2: FAN-OUT par unité
```javascript
const perUnitOps = units.map(unit => ({
  op_id: op.op_id,
  payload: {
    code: 'lolo',         ✅ CODE
    name: 'lolo',         ✅ NOM INCLUS
    unit_level: 'CARTON', ✅ UNITÉ
    unit_mark: '',        ✅ MARK
    uuid: '96a8...'       ✅ UUID
  }
}));
```

**Vérification requise:**
```
Logs à chercher:
"[UNIT 0] CARTON/: name='lolo'"
"Pushing batch: ops 0-1 of 1"
```

---

### 5️⃣ GOOGLE SHEETS: Code.gs (handleProductUpsert)

**Fichier:** `tools/apps-script/Code.gs` (ligne 1056-1220)

#### Extraction du nom
```javascript
const name = pickFirst(payload, [
  'name', 
  'product_name', 
  'nom', 
  'productName', 
  'Nom du produit'
]);
// ✅ Accepte PLUSIEURS noms de champs
```

#### Vérification de non-écrasement
```javascript
// ✅ TOUJOURS écrire le nom quand fourni ET non-vide
if (colNom > 0 && name !== undefined && name !== null && String(name).trim() !== '') {
  rowData[colNom - 1] = String(name).trim();
} else if (rowIndex <= 0) {
  // CREATE mode: Si pas de nom, laisser vide
  if (colNom > 0) rowData[colNom - 1] = '';
}
// UPDATE mode: Si nom vide → ne pas toucher (préserve existant) ✅
```

**Vérification requise:**
```
Logs à chercher dans Apps Script:
"✏️ Produit trouvé par Code à la ligne 5"
"Colonne de Nom: 2 (Nom du produit)"
"Valeur écrite: 'lolo'"
```

---

## 🚨 POINTS DE BLOCAGE POSSIBLES

### A) BD Locale: Nom absent ou NULL
```sql
SELECT * FROM products WHERE code='lolo' AND (name IS NULL OR name='');
```
**Symptôme:** Produit créé sans nom
**Solution:** `UPDATE products SET name='lolo' WHERE code='lolo';`

---

### B) OUTBOX: Opération NOT created
```sql
SELECT * FROM sync_operations WHERE entity_code='lolo' AND status='pending';
```
**Symptôme:** Aucune opération pending
**Raison:** Produit jamais modifié → pas d'opération créée
**Solution:** Faire une modification pour déclencher une opération

---

### C) OUTBOX: payload_json ne contient pas le nom
```javascript
// sync.worker.js doit inclure le nom dans payload
const operationPayload = {
  ...payloadData,
  code: op.entity_code,   // ✅
  name: finalName,        // ✅ NOM INCLUS
  uuid: uuid              // ✅
};
```

**Symptôme:** Payload: `{"code":"lolo"}` (sans "name")
**Solution:** Vérifier que `payloadData.name` est extrait correctement

---

### D) Code.gs: Colonne Nom non trouvée
```javascript
const colNom = firstCol(sheet, ['Nom du produit', 'Nom']);
if (colNom <= 0) {
  console.error('❌ Colonne Nom introuvable!');
}
```

**Symptôme:** Logs: "Colonne de Nom: -1"
**Solution:** Vérifier que Sheets a une colonne "Nom du produit" ou "Nom"

---

### E) Code.gs: Écriture échouée (nom vide)
```javascript
// ANCIEN CODE (BUG):
if (colNom > 0 && name !== undefined) {
  rowData[colNom - 1] = (name === null ? '' : String(name));
}
// ❌ Écrit MÊME si name='', ce qui écrase le nom existant

// NOUVEAU CODE (CORRIGÉ):
if (colNom > 0 && name !== undefined && name !== null && String(name).trim() !== '') {
  rowData[colNom - 1] = String(name).trim();
}
// ✅ N'écrit que si nom non-vide
```

---

## ✅ VÉRIFICATION COMPLÈTE (Checklist)

### Étape 1: BD Locale
- [ ] Tous les produits ont un `name` non-vide
- [ ] `product_units` pointent vers les bons `product_id`
- [ ] `synced_at` est NULL avant le premier sync

**Commande:**
```sql
SELECT 'PRODUCTS' as check_name, COUNT(*) as total FROM products
UNION ALL
SELECT 'PRODUCTS WITH NAME', COUNT(*) FROM products WHERE name IS NOT NULL AND name != ''
UNION ALL
SELECT 'PRODUCT_UNITS', COUNT(*) FROM product_units
UNION ALL
SELECT 'SYNC_OPS PENDING', COUNT(*) FROM sync_operations WHERE status='pending';
```

### Étape 2: OUTBOX
- [ ] Opération créée avec status='pending'
- [ ] payload_json contient le nom: `json_extract(payload_json, '$.name')`
- [ ] op_id unique pour idempotence

**Commande:**
```sql
SELECT 
  op_id,
  entity_code,
  status,
  json_extract(payload_json, '$.name') as name_in_payload,
  json_extract(payload_json, '$.code') as code_in_payload
FROM sync_operations 
WHERE entity_code='lolo' 
ORDER BY created_at DESC 
LIMIT 1;
```

### Étape 3: sync.worker.js
- [ ] Logs contiennent "Loaded X unit(s) from DB"
- [ ] Logs contiennent "Name value: finalName='lolo'"
- [ ] Logs contiennent "[UNIT 0] CARTON/: name='lolo'"
- [ ] Logs contiennent "Pushing batch: ops 0-1 of 1"

### Étape 4: Code.gs
- [ ] Logs contiennent "Colonne de Nom: 2"
- [ ] Logs contiennent "✏️  Carton ligne 5: Nom → \"lolo\""
- [ ] Sheets affiche le nom dans colonne B

### Étape 5: Sheets
- [ ] Colonne B "Nom du produit" existe
- [ ] Ligne contient: `Code='lolo'` | `Nom='lolo'`
- [ ] `_uuid` écrit en colonne _uuid
- [ ] `_updated_at` écrit avec timestamp actuel

---

## 🔗 FLUX COMPLET (Résumé)

```
1. BD Locale: products.name = 'lolo'
   ↓
2. MODIFICATION du produit (ou création)
   ↓
3. OUTBOX: sync_operations créée
   ├─ op_type: 'PRODUCT_PATCH'
   ├─ status: 'pending'
   └─ payload_json: {"code":"lolo", "name":"lolo", "unit_level":"CARTON", ...}
   ↓
4. Worker (toutes les 15s):
   ├─ Récupère produit complet: {name: 'lolo', units: [...]}
   ├─ FAN-OUT par unité
   └─ POST vers Sheets: {payload: {code:'lolo', name:'lolo', ...}}
   ↓
5. Code.gs handleProductUpsert:
   ├─ Extrait name: 'lolo'
   ├─ Cherche ligne par UUID ou Code
   ├─ Écrit: rowData[colNom-1] = 'lolo'
   └─ sheet.setValues([rowData])
   ↓
6. Sheets Carton:
   ├─ Ligne trouvée ou créée
   ├─ Colonne B: 'lolo'
   ├─ Colonne _uuid: UUID
   └─ Colonne _updated_at: timestamp
   ↓
7. Worker reçoit succès:
   └─ OUTBOX: status='acked', synced_at=NOW()
   ↓
8. ✅ synced_at n'est plus NULL
```

---

## 🎯 ACTIONS À PRENDRE

### Si Nom vide en Sheets:
1. Vérifier BD: `SELECT name FROM products WHERE code='lolo';`
2. Vérifier OUTBOX: `SELECT json_extract(payload_json, '$.name') FROM sync_operations WHERE entity_code='lolo' LIMIT 1;`
3. Vérifier Code.gs logs: Chercher "Colonne de Nom" et "Nom →"
4. Vérifier Sheets: Colonne B existe et en bonne position

### Si Opération jamais créée:
1. Faire une modification du produit (change stock, prix, etc.)
2. Vérifier que sync_operations est créée
3. Attendre 15-20 secondes pour le push automatique

### Si sync_at reste NULL:
1. Vérifier Code.gs logs: L'upsert s'exécute-t-il?
2. Vérifier retour Sheets: `{success: true, acked_count: ...}`
3. Vérifier que worker marque comme acked: `UPDATE sync_operations SET status='acked'`
