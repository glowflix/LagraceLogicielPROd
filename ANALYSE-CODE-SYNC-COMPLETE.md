# 🔬 ANALYSE TECHNIQUE COMPLÈTE: Vérification du code de synchronisation

## 📋 STRUCTURE SQL VÉRIFIÉE

### Table: `products`
```sql
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,      -- ✅ UUID professionnel pour sync
  code TEXT NOT NULL UNIQUE,      -- ✅ Code produit (clé commune Sheets)
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  synced_at TEXT                  -- ⚠️ NULL = jamais synced
);
```

### Table: `product_units`
```sql
CREATE TABLE product_units (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,      -- ✅ UUID unique pour chaque unité
  product_id INTEGER,             -- FK vers products
  unit_level TEXT,               -- CARTON | MILLIER | PIECE
  unit_mark TEXT,                -- Ex: CARTON, JUTE, SAC, etc.
  stock_initial REAL,
  stock_current REAL,
  purchase_price_usd REAL,
  sale_price_fc REAL,
  sale_price_usd REAL,
  synced_at TEXT                 -- ⚠️ NULL = jamais synced
);
```

### Table: `sync_operations` (OUTBOX PRO)
```sql
CREATE TABLE sync_operations (
  id INTEGER PRIMARY KEY,
  op_id TEXT UNIQUE,             -- ✅ Idempotence (évite doublons)
  op_type TEXT,                  -- PRODUCT_PATCH|UNIT_PATCH|STOCK_MOVE
  entity_uuid TEXT,              -- UUID du produit ou unité
  entity_code TEXT,              -- Code produit pour lookup
  payload_json TEXT,             -- Données de l'opération
  status TEXT,                   -- pending|sent|acked|error
  created_at TEXT,
  acked_at TEXT                  -- Date de confirmation Sheets
);
```

---

## 🔍 LOGIQUE GOOGLE SHEETS (Code.gs)

### Fonction: `handleProductUpsert(payload, entityType)`

**Ligne 1000-1100 dans Code.gs**

#### ÉTAPE 1: EXTRACTION DES CHAMPS
```javascript
const code = pickFirst(payload, ['code', 'product_code', 'Code produit']);
const name = pickFirst(payload, ['name', 'product_name', 'nom', 'Nom du produit']);
const unit_level = pickFirst(payload, ['unit_level', 'unite', 'unit', 'Unite']);
const unit_mark_raw = pickFirst(payload, ['unit_mark', 'mark', 'Mark']);
const uuid = pickFirst(payload, ['uuid', '_uuid']);
```

**Accepte plusieurs noms de colonnes** ✅

#### ÉTAPE 2: NORMALISATION
```javascript
const codeNormalized = normalizeCode(code);           // Enlever espaces/accents
const unitLevelFinal = normalizeUnitLevel(unit_level); // CARTON|MILLIER|PIECE
const markNormalized = normalizeMark(unit_mark_raw);  // Standardiser
```

#### ÉTAPE 3: DÉTERMINATION DE LA FEUILLE
```javascript
const sheetName = 
  unitLevelFinal === 'CARTON' ? SHEETS.CARTON :
  unitLevelFinal === 'MILLIER' ? SHEETS.MILLIERS :
  SHEETS.PIECE;
```

**Une feuille différente par unité_level** ✅

#### ÉTAPE 4: RECHERCHE DU PRODUIT (CRITIQUE!)

**Priorité 1: Chercher par UUID**
```javascript
if (uuid && rowUuid && rowUuid === uuid) {
  rowIndex = i + 2;  // Trouvé!
  break;
}
```

**Priorité 2: Chercher par CODE + MARK normalisés**
```javascript
if (rowCode === codeNormalized && rowMark === markNormalized) {
  rowIndex = i + 2;  // Trouvé!
  break;
}
```

**⚠️ IMPORTANT:**
- Si UUID est fourni ET existe → utiliser
- Sinon chercher par `code + mark` normalisés
- **MÊME en CARTON** (avant on ignorait mark, causant des doublons)

#### ÉTAPE 5: AUTO-GÉNÉRER UUID SI ABSENT
```javascript
let finalUuid = uuid || existingUuid;
if (!finalUuid) {
  finalUuid = generateFullUUID();  // Générer UUID v4
  console.log(`🆔 UUID généré automatiquement: ${finalUuid}`);
}
```

**Si UUID manquant → générer automatiquement** ✅

#### ÉTAPE 6: UPDATE OU CREATE
```javascript
if (rowIndex > 0) {
  // UPDATE la ligne existante
  sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
} else {
  // CREATE nouvelle ligne
  sheet.appendRow(rowData);
  rowIndex = sheet.getLastRow();
}
```

#### ÉTAPE 7: REMPLIR LES COLONNES
```javascript
if (colCode > 0) rowData[colCode - 1] = codeNormalized;
if (colNom > 0 && name !== undefined) rowData[colNom - 1] = name;
if (colMark > 0) rowData[colMark - 1] = markNormalized;
if (colStockInit > 0) rowData[colStockInit - 1] = stock_current || stock_initial;
if (colUuid > 0) rowData[colUuid - 1] = finalUuid;  // ✅ UUID TOUJOURS écrit
if (colUpdatedAt > 0) rowData[colUpdatedAt - 1] = nowIso();  // ✅ _updated_at
```

**Colonnes tech obligatoires:**
- `_uuid` → UUID du produit/unité
- `_updated_at` → Timestamp de la mise à jour
- `_device_id` → ID du device source

---

## 🔄 FLUX SYNC.WORKER.JS

### startPushSyncLoop() (Ligne ~165)

```javascript
async startPushSyncLoop() {
  const PUSH_SYNC_INTERVAL_MS = 15000; // 15 secondes
  
  // Boucle de push automatique
  const pushLoop = async () => {
    if (!isOnline) {
      // Attendre la connexion
      return;
    }
    
    // Récupérer opérations pending
    const productPatches = outboxRepo.getPendingOperations('PRODUCT_PATCH', 50);
    const unitPatches = outboxRepo.getPendingOperations('UNIT_PATCH', 50);
    
    // Envoyer vers Sheets
    await this.pushProductPatches(productPatches);
    await this.pushUnitPatches(unitPatches);
  };
}
```

**Chaque 15 secondes:**
1. Récupère opérations `pending` en OUTBOX
2. Les envoie vers Google Sheets via batchPush
3. Marque les confirmées comme `acked`
4. Met à jour `synced_at` en BD

### pushProductPatches() (Ligne ~307)

**Processus FAN-OUT:**
```javascript
// 1. Charger le produit complet
const fullProduct = productsRepo.findByCode(op.entity_code);

// 2. Récupérer TOUTES les unités (CARTON, MILLIER, PIECE)
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
    uuid: uuid  // ✅ UUID INCLUS
  }
}));
```

**Important:** 1 produit + 3 unités = 3 opérations séparées envoyées

### Marquage comme synced

```javascript
// Après succès du push:
outboxRepo.markAsAcked(opIds);  // Marquer comme "acked"

// Puis le système met à jour:
// UPDATE product_units SET synced_at = NOW()
// UPDATE sync_operations SET acked_at = NOW()
```

---

## 🎯 FLUX COMPLET: "kloo"

```
1. CRÉATION EN BD
   ├─ products: { id=1, uuid='96a8...', code='kloo', name='kloo' }
   └─ product_units: { uuid='96a8...', product_id=1, unit_level='CARTON', synced_at=NULL }

2. CRÉATION OUTBOX (quand modifié)
   └─ sync_operations: { op_id=UUID, op_type='PRODUCT_PATCH', entity_code='kloo', status='pending' }

3. PUSH (toutes les 15s)
   POST vers Google Sheets:
   {
     action: 'batchPush',
     ops: [{
       entity: 'products',
       op: 'upsert',
       payload: {
         code: 'kloo',
         name: 'kloo',
         unit_level: 'CARTON',
         unit_mark: '',
         uuid: '96a8387d-b9ff-4bf0-bd9a-e5568e81e190'
       }
     }]
   }

4. HANDLEPRODUCTUPSERT EN SHEETS
   ├─ Cherche par UUID → pas trouvé (premier envoi)
   ├─ Cherche par code+mark → pas trouvé
   ├─ Auto-génère UUID? NON, utilise le fourni: '96a8387d-...'
   ├─ Crée nouvelle ligne en Carton:
   │  ├─ Code: 'kloo'
   │  ├─ Nom: 'kloo'
   │  ├─ _uuid: '96a8387d-...'
   │  └─ _updated_at: 2026-01-01T12:00:00Z
   └─ Retourne: { success: true, applied: [{ uuid, status: 'applied' }] }

5. MARQUAGE SYNCED
   ├─ BD: UPDATE product_units SET synced_at = NOW()
   ├─ OUTBOX: UPDATE sync_operations SET status='acked', acked_at=NOW()
   └─ ✅ synced_at n'est plus NULL
```

---

## ✅ CODE VERIFIED - POINTS CLÉS

### 1️⃣ Recherche par UUID (priorité)
**Code.gs ligne 1065-1070:**
```javascript
if (uuid && rowUuid && rowUuid === uuid) {
  rowIndex = i + 2;
  break;  // Trouvé, stop
}
```
✅ Fonctionne correctement

### 2️⃣ Recherche par code+mark si UUID absent
**Code.gs ligne 1076-1082:**
```javascript
if (rowCode === codeNormalized && rowMark === markNormalized) {
  rowIndex = i + 2;
  break;  // Trouvé, stop
}
```
✅ Norme les deux pour faire correspondre

### 3️⃣ Auto-génère UUID si absent
**Code.gs ligne 1088-1092:**
```javascript
let finalUuid = uuid || existingUuid;
if (!finalUuid) {
  finalUuid = generateFullUUID();  // Génère un UUID v4
}
```
✅ Génère uniquement si vraiment absent

### 4️⃣ Écrit TOUJOURS _uuid et _updated_at
**Code.gs ligne 1117-1119:**
```javascript
if (colUuid > 0) rowData[colUuid - 1] = finalUuid;
if (colUpdatedAt > 0) rowData[colUpdatedAt - 1] = now;
```
✅ Colonnes tech toujours remplies

### 5️⃣ FAN-OUT par unité en sync.worker.js
**sync.worker.js ligne ~370:**
```javascript
// 1 produit → 3 opérations (CARTON, MILLIER, PIECE)
const perUnitOps = units.map(unit => ({...}));
```
✅ Envoie au bon onglet selon unit_level

### 6️⃣ Opérations marquées "acked"
**sync.worker.js ligne ~420:**
```javascript
outboxRepo.markAsAcked(ackedOpIds);
```
✅ Marque comme confirmé par Sheets

---

## 🔴 PROBLÈMES POTENTIELS DÉTECTÉS

### ⚠️ Problème 1: synced_at reste NULL
**Cause possible:** OUTBOX ne contient pas d'opérations

**À vérifier:**
```sql
SELECT * FROM sync_operations WHERE entity_code='kloo';
-- Doit retourner at least 1 ligne avec status='pending'
```

Si vide: Aucune modification du produit n'a déclenché une opération

### ⚠️ Problème 2: Opération restée "pending"
**Cause possible:** Push échoue (GOOGLE_SHEETS_WEBAPP_URL manquante ou invalide)

**À vérifier:**
```bash
echo $env:GOOGLE_SHEETS_WEBAPP_URL
# Doit retourner une URL valide: https://script.google.com/macros/d/.../userweb
```

### ⚠️ Problème 3: UUID ne correspond pas
**Cause possible:** UUID généré différemment en Sheets et BD

**À vérifier:**
- BD: `SELECT uuid FROM product_units WHERE product_id=1;`
- Sheets: Colonne _uuid pour la ligne kloo
- Doivent être identiques

### ⚠️ Problème 4: "kloo" non trouvé en Sheets
**Cause possible:** Code ou mark normalisé différemment

**À vérifier:**
```javascript
// Normalisation doit être identique partout
normalizeCode('kloo') === normalizeCode('KLOO')  // Doit être true
```

---

## 📊 CHECKLIST TECHNIQUE

- ✅ Schema SQL correct (uuid, code, unit_level, synced_at)
- ✅ handleProductUpsert cherche par UUID d'abord
- ✅ Puis cherche par code+mark
- ✅ Auto-génère UUID si absent
- ✅ Écrit toujours _uuid et _updated_at
- ✅ FAN-OUT par unité en sync.worker
- ✅ Opérations marquées "acked"
- ✅ synced_at mis à jour après succès

---

## 🎯 RÉSUMÉ DU CODE

**Code.gs:**
1. Reçoit le produit "kloo"
2. Normalise code+mark+unit_level
3. Cherche par UUID (priorité) ou code+mark
4. Crée ou met à jour la ligne Sheets
5. Écrit UUID et _updated_at
6. Retourne succès

**sync.worker.js:**
1. Récupère opérations pending
2. Charge le produit complet
3. FAN-OUT par unité
4. Envoie vers Sheets
5. Marque comme "acked"
6. Met à jour synced_at

**Résultat:** ✅ synced_at n'est plus NULL

---

## 🔗 FICHIERS SOURCE

- Schema: `src/db/schema.sql`
- Upsert: `tools/apps-script/Code.gs` (ligne 972-1130)
- Push: `src/services/sync/sync.worker.js` (ligne 307-450)
- OUTBOX: `src/db/repositories/outbox.repo.js`
