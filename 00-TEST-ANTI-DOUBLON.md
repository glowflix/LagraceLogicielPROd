# 🧪 TESTS - Anti-Doublon PRO

**Objectif**: Valider que les patches sont actifs et fonctionnels.

---

## ✅ Test 1: Vérifier que Code.gs compile

**Action**: Ouvrir Apps Script Editor et vérifier pas d'erreurs.

```
apps-script/Code.gs:
- Ctrl+S (Save)
- Vérifier pas de "Red error indicators"
- Console: Aucun error au save
```

**Résultat Attendu**:
```
✅ File saved (no errors)
```

---

## ✅ Test 2: Idempotency Cache

**Action**: Simuler 2 POST identiques, vérifier dedup

### Setup:
```javascript
// Dans Apps Script, ajouter une fonction de test:
function testIdempotency() {
  const data = {
    action: 'batchPush',
    request_id: 'TEST-12345',
    ops: []
  };
  
  const key = `POST:${data.action}:${data.request_id}`;
  console.log(`🧪 Test: ${key}`);
  
  // Tentative 1
  console.log(`  Call 1: isDuplicateRequest_('${key}') = ${isDuplicateRequest_(key)}`);
  // Tentative 2
  console.log(`  Call 2: isDuplicateRequest_('${key}') = ${isDuplicateRequest_(key)}`);
}
```

### Exécuter:
```
Apps Script Editor:
- Fonction: testIdempotency
- Clic "Run" (ou Ctrl+R)
- Vérifier logs
```

**Résultat Attendu**:
```
🧪 Test: POST:batchpush:TEST-12345
  Call 1: isDuplicateRequest_('POST:batchpush:TEST-12345') = false
  Call 2: isDuplicateRequest_('POST:batchpush:TEST-12345') = true
```

✅ **Cache fonctionne!** (1er = false, 2e = true)

---

## ✅ Test 3: UUID Déterministe Ventes

**Action**: Générer UUID 2x avec mêmes données, vérifier identique

### Setup:
```javascript
function testSaleDeterministicUuid() {
  const payload = {
    invoice_number: '20260107120000',
    product_code: '139',
    unit_level: 'MILLIER',
    unit_mark: 'DZ'
  };
  
  const uuid1 = saleDeterministicUuid_(payload);
  const uuid2 = saleDeterministicUuid_(payload);
  
  console.log(`🧪 Sale UUID Test:`);
  console.log(`  Payload: ${JSON.stringify(payload)}`);
  console.log(`  UUID 1: ${uuid1}`);
  console.log(`  UUID 2: ${uuid2}`);
  console.log(`  Match: ${uuid1 === uuid2 ? '✅ YES' : '❌ NO'}`);
}
```

### Exécuter:
```
Apps Script Editor:
- Fonction: testSaleDeterministicUuid
- Run
```

**Résultat Attendu**:
```
🧪 Sale UUID Test:
  Payload: {"invoice_number":"20260107120000","product_code":"139","unit_level":"MILLIER","unit_mark":"DZ"}
  UUID 1: SALE-abc123def456ghi789jk
  UUID 2: SALE-abc123def456ghi789jk
  Match: ✅ YES
```

✅ **UUID stable!** (même entrée = même sortie)

---

## ✅ Test 4: UUID Déterministe Dettes

**Action**: Générer UUID dettes 2x, vérifier identique

### Setup:
```javascript
function testDebtDeterministicUuid() {
  const payload = {
    invoice_number: '20260107120000',
    client_name: 'John Doe',
    product_description: 'Cartons de marchandise'
  };
  
  const uuid1 = debtDeterministicUuid_(payload);
  const uuid2 = debtDeterministicUuid_(payload);
  
  console.log(`🧪 Debt UUID Test:`);
  console.log(`  Payload invoice/client/product: ${payload.invoice_number} / ${payload.client_name} / ${payload.product_description}`);
  console.log(`  UUID 1: ${uuid1}`);
  console.log(`  UUID 2: ${uuid2}`);
  console.log(`  Match: ${uuid1 === uuid2 ? '✅ YES' : '❌ NO'}`);
}
```

**Résultat Attendu**:
```
UUID 1: DEBT-xyz789abc123def456ghi
UUID 2: DEBT-xyz789abc123def456ghi
Match: ✅ YES
```

✅ **UUID dettes stable!**

---

## ✅ Test 5: Normalisation Fonctions

**Action**: Vérifier que normalize* retournent bon format

### Setup:
```javascript
function testNormalization() {
  console.log(`🧪 Normalization Test:`);
  
  // Code normalization
  console.log(`  normalizeCode('  139  ') = '${normalizeCode('  139  ')}'`);
  console.log(`  normalizeCode(139) = '${normalizeCode(139)}'`);
  
  // Unit normalization
  console.log(`  normalizeUnitLevel('MILLIERS') = '${normalizeUnitLevel('MILLIERS')}'`);
  console.log(`  normalizeUnitLevel('millier') = '${normalizeUnitLevel('millier')}'`);
  console.log(`  normalizeUnitLevel('  carton  ') = '${normalizeUnitLevel('  carton  ')}'`);
  
  // Mark normalization
  console.log(`  normalizeMark('dz') = '${normalizeMark('dz')}'`);
  console.log(`  normalizeMark('DZ') = '${normalizeMark('DZ')}'`);
  console.log(`  normalizeMark('dozen') = '${normalizeMark('dozen')}'`);
}
```

**Résultat Attendu**:
```
normalizeCode('  139  ') = '139'
normalizeCode(139) = '139'
normalizeUnitLevel('MILLIERS') = 'MILLIER'
normalizeUnitLevel('millier') = 'MILLIER'
normalizeUnitLevel('  carton  ') = 'CARTON'
normalizeMark('dz') = 'DZ'
normalizeMark('DZ') = 'DZ'
normalizeMark('dozen') = 'DZ'
```

✅ **Normalisation OK!**

---

## ✅ Test 6: POST avec request_id (E2E)

**Action**: Envoyer vente 2x avec même request_id, vérifier dedup

### Setup (Node.js):
```bash
# Créer test script: test-idempotency.js
cat > test-idempotency.js << 'EOF'
const axios = require('axios');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/d/<DEPLOYMENT_ID>/usercall';

async function test() {
  const requestId = `TEST-${Date.now()}`;
  const payload = {
    action: 'batchPush',
    request_id: requestId,
    ops: [{
      op_id: 'OP-1',
      entity: 'sale_items',
      payload: {
        invoice_number: '20260107120000',
        product_code: '139',
        unit_level: 'MILLIER',
        unit_mark: 'DZ',
        qty: 100,
        unit_price_fc: 1500
      }
    }]
  };
  
  try {
    console.log(`📤 POST 1 (request_id: ${requestId})...`);
    const res1 = await axios.post(APPS_SCRIPT_URL, payload);
    console.log(`✅ Response 1:`, res1.data);
    
    console.log(`\n📤 POST 2 (RETRY - même request_id)...`);
    const res2 = await axios.post(APPS_SCRIPT_URL, payload);
    console.log(`✅ Response 2:`, res2.data);
    
    // Checker response 2
    if (res2.data.deduped) {
      console.log(`\n🎉 SUCCESS: Request 2 was DEDUPED!`);
    } else {
      console.log(`\n⚠️ WARNING: Request 2 was NOT deduped (cache miss)`);
    }
  } catch (e) {
    console.error(`❌ Error:`, e.message);
  }
}

test();
EOF

# Remplacer <DEPLOYMENT_ID> par l'ID réel
node test-idempotency.js
```

**Résultat Attendu**:
```
📤 POST 1 (request_id: TEST-1704702048123)...
✅ Response 1: {success: true, applied: [{...}], ...}

📤 POST 2 (RETRY - même request_id)...
✅ Response 2: {success: true, deduped: true, request_id: 'TEST-1704702048123', ...}

🎉 SUCCESS: Request 2 was DEDUPED!
```

✅ **E2E idempotency!** (2e requête dédupliquée par cache)

---

## ✅ Test 7: Vente sans UUID (Double insertion)

**Action**: Envoyer 2x même vente sans uuid, vérifier 1 ligne créée

### Prérequis:
- Sheets "Ventes" vide (ou nouvelle vente unique)

### Setup (Node.js):
```bash
cat > test-uuid-deterministic.js << 'EOF'
const axios = require('axios');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/d/<DEPLOYMENT_ID>/usercall';

async function test() {
  const saleItem = {
    invoice_number: '20260107120000',
    product_code: '139',
    unit_level: 'MILLIER',
    unit_mark: 'DZ',
    qty: 100,
    unit_price_fc: 1500,
    // ❌ uuid: absent (test deterministic generation)
  };
  
  try {
    console.log(`📤 POST 1 (vente sans uuid)...`);
    const res1 = await axios.post(APPS_SCRIPT_URL, {
      action: 'batchPush',
      ops: [{
        op_id: 'OP-1',
        entity: 'sale_items',
        payload: saleItem
      }]
    });
    console.log(`✅ Response 1: row ${res1.data.applied?.[0]?.row || '?'}`);
    
    console.log(`\n📤 POST 2 (MÊME vente, sans uuid)...`);
    const res2 = await axios.post(APPS_SCRIPT_URL, {
      action: 'batchPush',
      ops: [{
        op_id: 'OP-2',
        entity: 'sale_items',
        payload: saleItem
      }]
    });
    console.log(`✅ Response 2: row ${res2.data.applied?.[0]?.row || '?'}`);
    
    const row1 = res1.data.applied?.[0]?.row;
    const row2 = res2.data.applied?.[0]?.row;
    
    if (row1 && row2 && row1 === row2) {
      console.log(`\n🎉 SUCCESS: Both ops wrote to SAME ROW ${row1} (UPDATE, not INSERT)`);
    } else {
      console.log(`\n⚠️ WARNING: Different rows (${row1} vs ${row2}) - possible doublon`);
    }
  } catch (e) {
    console.error(`❌ Error:`, e.message);
  }
}

test();
EOF

node test-uuid-deterministic.js
```

**Résultat Attendu**:
```
📤 POST 1 (vente sans uuid)...
✅ Response 1: row 2

📤 POST 2 (MÊME vente, sans uuid)...
✅ Response 2: row 2

🎉 SUCCESS: Both ops wrote to SAME ROW 2 (UPDATE, not INSERT)
```

✅ **UUID Déterministe!** (2e insertion → même ligne, UPDATE)

---

## ✅ Test 8: Production Monitoring (24h)

**Action**: Monitorer doublons Sheets pour 24h

### Setup:
```sql
-- Script pour compter doublons (SQL / Apps Script)
-- Dans Sheets, créer colonne helper '_doublon' avec:
=COUNTIFS(
  'Ventes'!$B$2:$B,B2,          -- Facture
  'Ventes'!$C$2:$C,C2,          -- Code
  'Ventes'!$H$2:$H,H2,          -- Unite
  'Ventes'!$F$2:$F,F2           -- Mark
)

-- Puis compter combien de _doublon > 1:
=COUNTIF(ColonneHelper, ">1")
```

### Daily Monitoring:
```
Date      | Ventes Total | Doublons | %      | Status
----------|--------------|----------|--------|--------
7-Jan     | 250          | 0        | 0%     | ✅ GOOD
8-Jan     | 245          | 0        | 0%     | ✅ GOOD
9-Jan     | 260          | 0        | 0%     | ✅ GOOD
(vs avant: 3-5 doublons/jour)
```

✅ **Production: 0 doublon!**

---

## 📋 Checklist Complète Tests

- [ ] Test 1: Code.gs compile (no errors)
- [ ] Test 2: Idempotency cache works (false → true)
- [ ] Test 3: Sale UUID stable (uuid1 === uuid2)
- [ ] Test 4: Debt UUID stable (uuid1 === uuid2)
- [ ] Test 5: Normalizations OK (dz→DZ, MILLIERS→MILLIER)
- [ ] Test 6: E2E idempotency (POST 2x, 2nd = deduped)
- [ ] Test 7: UUID deterministic (2x vente → 1 row)
- [ ] Test 8: Production 24h (0 doublons)

---

## 🔍 Debugging

**Si tests échouent:**

### Test 1 Fail: Erreurs Apps Script
```
Action: Vérifier ligne 228-300 (helpers)
Check: Pas d'erreur syntaxe (missing }, etc.)
Fix: Copier/coller depuis 00-PATCH-ANTI-DOUBLON-PRO.md
```

### Test 2 Fail: Cache toujours false
```
Action: Vérifier CacheService.getScriptCache()
Check: isDuplicateRequest_ fonction correcte
Log: Ajouter console.log avant/après cache.put()
```

### Test 3/4 Fail: UUID différent
```
Action: Vérifier stableHash_ calcul
Check: SHA-1 digest correct
Log: Ajouter console.log(bytes) avant slice
```

### Test 5 Fail: Normalisation incorrect
```
Action: Vérifier fonctions normalize*
Check: toUpperCase(), trim() appliqué
Fix: Recopier depuis ligne 195-224
```

### Test 6 Fail: deduped false
```
Action: Checker request_id envoyé
Check: POST body inclut 'request_id'
Log: Ajouter console.log(data.request_id) en doPost
```

### Test 7 Fail: Rows différents
```
Action: Checker UUID déterministe généré
Log: Chercher "🆔 UUID déterministe généré" en logs
Check: Facture/code/unit/mark normalisés identique
```

---

## 📊 Test Results Template

```
TEST RESULTS - Anti-Doublon PRO
================================

Date: 7 Jan 2026
Tester: [Name]
Environment: [Dev/Staging/Prod]

Test 1 (Code.gs compile):       ✅ PASS
Test 2 (Cache idempotency):     ✅ PASS
Test 3 (Sale UUID stable):      ✅ PASS
Test 4 (Debt UUID stable):      ✅ PASS
Test 5 (Normalization):         ✅ PASS
Test 6 (E2E idempotency):       ✅ PASS
Test 7 (UUID deterministic):    ✅ PASS
Test 8 (Production 24h):        ✅ PASS (0 doublons)

OVERALL: ✅ ALL TESTS PASS

Doublons before: 3-5/day
Doublons after:  0/day
Improvement:     100% ✅

Notes:
- Apps Script cache working
- UUID generation deterministic
- Normalization robust
- E2E flow validated
- Production ready
```

---

**À exécuter avant deploy en production** ✅
