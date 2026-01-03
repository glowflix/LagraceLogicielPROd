# 🔍 DIAGNOSTIC: Nom/Mark ne se synchronisent pas

## 📋 PROBLÈME SIGNALÉ

- ❌ Quand je modifie le **Nom** du produit en local → pas de sync vers Sheets
- ❌ Quand je modifie le **Mark** du produit en local → pas de sync vers Sheets
- ❌ Les modifications ne créent **PAS d'opérations pending** (ou elles ne sont pas synchronisées)

---

## 🔗 FLUX COMPLET À VÉRIFIER

### Étape 1: UI (ProductsPage.jsx)
**Fichier:** `src/ui/pages/ProductsPage.jsx` (ligne 862-878)

```javascript
if (edits.unit_mark !== undefined) unitUpdates.unit_mark = edits.unit_mark;
if (edits.product_name !== undefined) productNameUpdate = edits.product_name;

// Puis envoie:
const updatePayload = {
  name: productNameUpdate ?? currentProduct.name,
  units: updatedUnits  // ← Contient le mark modifié
};

await axios.put(`/api/products/${row.product_code}`, updatePayload, auth);
```

✅ **Verdict:** ProductsPage envoie bien le Nom et Mark au backend

**À vérifier:**
```javascript
// Dans browser console:
// Chercher log: "📤 [ProductsPage] PUT /api/products/..."
// Vérifier que le payload contient:
// - name: (nouveau nom)
// - units[0].unit_mark: (nouveau mark)
```

---

### Étape 2: Backend (products.routes.js)
**Fichier:** `src/api/routes/products.routes.js` (ligne 140-180, route PUT)

```javascript
router.put('/:code', authenticate, (req, res) => {
  const product = productsRepo.upsert({ ...req.body, code: req.params.code });
  const fullProduct = productsRepo.findByCode(req.params.code);
  
  // 1. Créer PRODUCT_PATCH pour le nom
  outboxRepo.enqueueProductPatch(
    fullProduct.uuid,
    fullProduct.code,
    {
      name: fullProduct.name,  // ✅ Nom
      is_active: fullProduct.is_active
    }
  );
  
  // 2. Créer UNIT_PATCH pour chaque unité (avec mark)
  if (fullProduct.units && Array.isArray(fullProduct.units)) {
    for (const unit of fullProduct.units) {
      outboxRepo.enqueueUnitPatch(
        fullProduct.uuid,
        fullProduct.code,
        unit.unit_level,
        unit.unit_mark,  // ✅ Mark en argument
        {
          purchase_price_usd: unit.purchase_price_usd,
          sale_price_usd: unit.sale_price_usd,
          sale_price_fc: unit.sale_price_fc,
          stock_current: unit.stock_current,
          // ⚠️ PROBLÈME: unit_mark N'EST PAS dans le payload!
          // Il doit être inclus dans le payload JSON aussi
        }
      );
    }
  }
});
```

🚨 **PROBLÈME TROUVÉ:**
- `unit_mark` est passé en argument mais **N'EST PAS dans le payload JSON**
- Quand sync.worker envoie vers Sheets, le `unit_mark` est absent du payload!

---

### Étape 3: OUTBOX (outbox.repo.js)
**Fichier:** `src/db/repositories/outbox.repo.js` (ligne 112-165)

```javascript
enqueueUnitPatch(productUuid, productCode, unitLevel, unitMark, patch) {
  // ...
  const fullPayload = {
    product_uuid: productUuid,
    product_code: productCode,
    unit_level: unitLevel,
    unit_mark: unitMark || '',  // ✅ INCLUS dans payload
    ...patch
  };
  
  // INSERT dans sync_operations avec fullPayload
}
```

✅ **Verdict:** OUTBOX INCLUT bien le mark dans le payload!

**À vérifier SQL:**
```sql
SELECT 
  op_id,
  entity_code,
  json_extract(payload_json, '$.unit_mark') as mark_in_payload,
  json_extract(payload_json, '$.name') as name_in_payload,
  status
FROM sync_operations 
WHERE status='pending'
LIMIT 5;
```

---

### Étape 4: sync.worker.js (push)
**Fichier:** `src/services/sync/sync.worker.js` (ligne 336-390)

```javascript
async pushProductPatches(patches) {
  for (const op of patches) {
    const finalName = payloadData.name !== undefined ? String(payloadData.name).trim() : '';
    
    // FAN-OUT par unité
    const perUnitOps = units.map(unit => ({
      op_id: op.op_id,
      payload: {
        code: op.entity_code,
        name: finalName,           // ✅ Nom inclus
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark, // ✅ Mark de l'unité
        uuid: uuid
      }
    }));
    
    // Push vers Sheets
    const response = await httpClient.post(sheetsUrl, { action: 'batchPush', ops: batch });
  }
}
```

✅ **Verdict:** sync.worker inclut bien mark et name dans le payload avant envoyer vers Sheets

**À vérifier logs:**
```
Logs à chercher dans Node:
"[PRODUCT-PATCH 0] entity_code='lolo'"
"✅ Parsed JSON: name='lolo'"
"📦 Loaded 1 unit(s) from DB: CARTON"
"[UNIT 0] CARTON/NEW_MARK: name='lolo'"
"Pushing batch: ops 0-1 of 1"
```

---

### Étape 5: Code.gs (handleProductUpsert)
**Fichier:** `tools/apps-script/Code.gs` (ligne 1068-1220)

```javascript
function handleProductUpsert(payload, entityType) {
  const name = pickFirst(payload, ['name', 'product_name', 'nom']);
  const unit_mark_raw = pickFirst(payload, ['unit_mark', 'mark', 'MARK']);
  
  // ...
  
  // Extraction du nom
  if (colNom > 0 && name !== undefined && name !== null && String(name).trim() !== '') {
    rowData[colNom - 1] = String(name).trim();  // ✅ Écrit le nom
  }
  
  // Écriture du mark
  if (colMark > 0 && unit_mark_raw !== undefined) {
    rowData[colMark - 1] = markNormalized;  // ✅ Écrit le mark
  }
  
  // Écriture en Sheets
  sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
}
```

✅ **Verdict:** Code.gs écrit bien le nom et mark si fournis

**À vérifier logs Code.gs:**
```
"✏️ Carton ligne 5: Nom → 'nouveau_nom'"
"🏷️ Carton ligne 5: Mark → 'NEW_MARK'"
```

---

## 🚨 POINTS DE BLOCAGE

### Blocage A: Les opérations ne sont PAS créées
**Symptôme:** Aucune ligne dans `sync_operations` avec status='pending'

**Diagnostic:**
```sql
SELECT COUNT(*) as pending_ops FROM sync_operations WHERE status='pending';
SELECT * FROM sync_operations WHERE status='pending' ORDER BY created_at DESC LIMIT 3;
```

**Cause possible:**
1. Modification n'arrive pas au backend
2. Backend ne crée pas l'opération
3. Opération est créée mais immédiatement marquée comme 'acked'

**Solution:** Vérifier logs backend:
```bash
# Dans terminal Node
npm run dev 2>&1 | grep -i "outbox\|enqueue\|patch"
```

---

### Blocage B: Les opérations sont créées mais ne sont PAS synchronisées
**Symptôme:** `sync_operations` a status='pending' mais ne change jamais à 'acked'

**Diagnostic:**
```sql
SELECT op_id, status, created_at FROM sync_operations 
WHERE status='pending' 
ORDER BY created_at DESC 
LIMIT 5;
```

**Cause possible:**
1. Worker ne voit pas les opérations pending
2. Worker ne push pas vers Sheets
3. Push échoue silencieusement

**Solution:** Vérifier logs worker:
```bash
# Dans terminal Node
npm run dev 2>&1 | grep -i "PUSH-SYNC\|PRODUCT-PATCH\|Batch"
```

---

### Blocage C: Opérations synchronisées mais Sheets ne reçoit pas les données
**Symptôme:** status='acked' mais Sheets vide

**Cause possible:**
1. GOOGLE_SHEETS_WEBAPP_URL invalide ou non configurée
2. Code.gs handleProductUpsert échoue
3. handleProductUpsert ne trouve pas les colonnes Nom/Mark

**Solution:** Vérifier Code.gs logs:
```javascript
// Dans Google Apps Script
function testLogs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  Logger.log(`Total sheets: ${sheets.length}`);
  for (const sheet of sheets) {
    Logger.log(`Sheet: ${sheet.getName()}, Columns: ${sheet.getLastColumn()}`);
  }
}
```

---

## ✅ CHECKLIST DE VÉRIFICATION

### 1. Frontend (ProductsPage)
- [ ] Quand je modifie Mark, ProductsPage envoie le nouveau Mark au backend
- [ ] Logs console affichent: "📤 [ProductsPage] PUT /api/products/..."
- [ ] Le payload contient `units[0].unit_mark: "NEW_MARK"`

### 2. Backend (products.routes.js)
- [ ] Modification arrive correctement au backend
- [ ] `productsRepo.upsert()` met à jour la BD avec le nouveau mark
- [ ] SQL SELECT confirme: `SELECT unit_mark FROM product_units WHERE ...` = "NEW_MARK"
- [ ] `outboxRepo.enqueueProductPatch()` et `enqueueUnitPatch()` sont appelés
- [ ] SQL SELECT confirme: `SELECT COUNT(*) FROM sync_operations WHERE status='pending'` > 0

### 3. OUTBOX (BD)
- [ ] PRODUCT_PATCH créée avec payload contenant `"name": "..."`
- [ ] UNIT_PATCH créée avec payload contenant `"unit_mark": "NEW_MARK"`
- [ ] Commande: `SELECT json_extract(payload_json, '$.unit_mark') FROM sync_operations WHERE status='pending' LIMIT 1`

### 4. Worker (sync.worker.js)
- [ ] Logs affichent: "[PRODUCT-PATCH 0] entity_code='...'"
- [ ] Logs affichent: "📦 Loaded X unit(s) from DB: CARTON"
- [ ] Logs affichent: "[UNIT 0] CARTON/NEW_MARK: name='...'"
- [ ] Logs affichent: "Pushing batch: ops 0-1 of 1"
- [ ] GOOGLE_SHEETS_WEBAPP_URL est configurée en .env

### 5. Sheets (Code.gs)
- [ ] handleProductUpsert reçoit le payload avec mark
- [ ] Logs affichent: "Colonne de Mark: X"
- [ ] Logs affichent: "🏷️ Carton ligne Y: Mark → 'NEW_MARK'"
- [ ] Colonne B "Mark" existe en Sheets
- [ ] La ligne affiche le mark mis à jour

### 6. Final Check
- [ ] `synced_at` passe de NULL à une date en BD
- [ ] `sync_operations.status` passe de 'pending' à 'acked'
- [ ] Sheets affiche le Nom et Mark mis à jour

---

## 🎯 ACTIONS À PRENDRE (Priorité)

### Priorité 1: Vérifier les opérations pending
```sql
SELECT COUNT(*) as pending FROM sync_operations WHERE status='pending';
```
Si 0: Les modifications ne créent pas d'opérations
Si > 0: Aller à Priorité 2

### Priorité 2: Vérifier le payload
```sql
SELECT json_extract(payload_json, '$.unit_mark') as mark FROM sync_operations WHERE status='pending' LIMIT 1;
```
Si NULL: Le mark n'est pas inclus dans le payload
Si valeur: Aller à Priorité 3

### Priorité 3: Vérifier le push
```
Chercher logs: "Pushing batch: ops X-Y of Z"
Si absent: Worker ne pousse pas
Si présent: Aller à Priorité 4
```

### Priorité 4: Vérifier Sheets
```
Chercher logs Code.gs: "🏷️ ... Mark → "
Si absent: handleProductUpsert ne voit pas le mark
Si présent: Bug en Sheets (rare)
```

---

## 📊 RÉSUMÉ

```
ProductsPage.jsx
  ↓ Envoie PUT /api/products/code avec { name, units[].unit_mark }
Backend (products.routes.js)
  ↓ Crée PRODUCT_PATCH + UNIT_PATCH avec mark
OUTBOX (sync_operations)
  ↓ Stocke payload_json avec "unit_mark" et "name"
Worker (sync.worker.js)
  ↓ Récupère opérations pending et envoie vers Sheets
Sheets (Code.gs handleProductUpsert)
  ↓ Reçoit payload avec mark et name
  ↓ Écrit dans colonnes Mark et Nom
✅ Sheets affiche le nom et mark à jour
```

Si une étape échoue → la sync s'arrête à ce point.
