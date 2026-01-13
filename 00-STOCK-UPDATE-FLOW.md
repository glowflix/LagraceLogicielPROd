# 🔄 Stock Update Flow - Complete Architecture

**Date**: 7 January 2026  
**Version**: 1.0

---

## 📊 Current Flow (BEFORE FIXES)

```
┌─────────────────────────────────────────────────────────────────┐
│ USER CREATES SALE IN APP                                        │
├─────────────────────────────────────────────────────────────────┤
│ Product: 139 | Unit: CARTON | Mark: DZ | Qty: 1               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │  App calls: sale_item_upsert()    │
        │  ├─ invoice_number: 20251206...  │
        │  ├─ product_code: 139            │
        │  ├─ unit_level: CARTON           │
        │  ├─ unit_mark: DZ                │
        │  ├─ qty: 1                       │
        │  └─ uuid: ...                    │
        └────────┬───────────────────────────┘
                 │
                 ▼
        ┌────────────────────────────────────┐
        │  Sync Worker pushSales()           │
        │  ├─ Creates ops[] array           │
        │  ├─ Calls sheetsClient.pushBatch()│
        │  └─ Marks as acked ✅             │
        └────────┬───────────────────────────┘
                 │
                 ▼
        ┌────────────────────────────────────┐
        │  Apps Script handleSaleItemUpsert()│
        │  ├─ Adds row to Ventes sheet  ✅  │
        │  ├─ Assigns UUID              ✅  │
        │  ├─ Normalizes fields         ✅  │
        │  └─ Returns success           ✅  │
        └────────┬───────────────────────────┘
                 │
                 ▼
        ┌────────────────────────────────────┐
        │  STOCK NOT UPDATED              ❌ │
        │  ├─ handleStockUpdate() never    │
        │  │  called                      │
        │  └─ Stock remains 4793          │
        └────────────────────────────────────┘

RESULT: ❌ Stock unchanged despite sale recorded
```

---

## ✅ Planned Flow (AFTER FIXES)

```
┌─────────────────────────────────────────────────────────────────┐
│ USER CREATES SALE IN APP                                        │
├─────────────────────────────────────────────────────────────────┤
│ Product: 139 | Unit: CARTON | Mark: DZ | Qty: 1               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │  App calls: sale_item_upsert()    │
        │  ├─ invoice_number: 20251206...  │
        │  ├─ product_code: 139            │
        │  ├─ unit_level: CARTON           │
        │  ├─ unit_mark: DZ                │
        │  ├─ qty: 1                       │
        │  └─ uuid: ...                    │
        └────────┬───────────────────────────┘
                 │
                 ▼
        ┌────────────────────────────────────┐
        │  Sync Worker pushSales()           │
        │  ├─ Creates ops[] array           │
        │  ├─ Calls sheetsClient.pushBatch()│
        │  ├─ Marks as acked ✅             │
        │  └─ ✅ NEW: Generates            │
        │     stock_change ops             │
        │     {                            │
        │       product_code: 139,         │
        │       unit_level: CARTON,        │
        │       stock_change: -1,   ← NEG  │
        │       invoice_number: ...,       │
        │       uuid: ...                  │
        │     }                            │
        └────────┬───────────────────────────┘
                 │
       ┌─────────┴──────────────────┐
       │                            │
       ▼                            ▼
┌──────────────────────┐    ┌──────────────────────┐
│ Apps Script handles: │    │ Sync Worker queues: │
│ handleSaleItemUpsert│    │ stock_change op     │
│ ├─ Adds row    ✅   │    │ to outbox           │
│ └─ Returns data ✅  │    │                     │
└──────────────────────┘    └────────┬────────────┘
                                     │
                                     ▼ (next sync cycle)
                            ┌──────────────────────────┐
                            │ Sync Worker pushStockOps │
                            │ ├─ Calls sheetsClient   │
                            │ │  .pushBatch()         │
                            │ └─ Marks as acked  ✅   │
                            └────────┬─────────────────┘
                                     │
                                     ▼
                            ┌──────────────────────────┐
                            │ Apps Script handles:     │
                            │ handleStockUpdate()      │
                            │ ├─ ✅ FIX A: UUID norm  │
                            │ │  normalized UUID      │
                            │ ├─ ✅ FIX B: CARTON    │
                            │ │  ignores mark        │
                            │ ├─ Finds row by UUID ✅ │
                            │ ├─ Reads current stock  │
                            │ │  = 4793               │
                            │ ├─ Applies change:      │
                            │ │  4793 + (-1) = 4792   │
                            │ ├─ Writes to Sheets  ✅ │
                            │ └─ Verifies write    ✅ │
                            └────────┬─────────────────┘
                                     │
                                     ▼
                            ┌──────────────────────────┐
                            │ ✅ STOCK UPDATED        │
                            │ ├─ Ventes sheet: 1 row  │
                            │ │  (product 139)        │
                            │ └─ CARTON stock: 4792   │
                            │   (reduced from 4793)   │
                            └──────────────────────────┘

RESULT: ✅ Complete sale-to-stock pipeline working
```

---

## 🔄 Detailed Step-by-Step with Logs

### Step 1: Sale Created & Sent

```javascript
// Node.js (src/services/sync/sync.worker.js)
console.log(`📤 [SALE] Sending item: 139/CARTON/DZ qty=1`);
outboxRepo.addOperation({
  entity: 'sale_items',
  op: 'upsert',
  payload: {
    invoice_number: '20251206143627',
    product_code: '139',
    unit_level: 'CARTON',
    unit_mark: 'DZ',
    qty: 1,
    uuid: '96a8387d-b9ff-4bf0-bd9a-e5568e81e190',
    // ...
  }
});
```

**Expected log**:
```
[SALE] Sending item: 139/CARTON/DZ qty=1
[SYNC] Queuing to outbox: entity=sale_items
```

---

### Step 2: Sync to Sheets

```javascript
// Next sync cycle
const ops = [
  {
    entity: 'sale_items',
    op: 'upsert',
    payload: { /* ... */ }
  }
];

const result = await sheetsClient.pushBatch(ops);
// Apps Script processes...
```

**Expected log (Apps Script)**:
```
📋 [handleBatchPush] Traitement de 1 opération(s)
   🔄 [handleBatchPush] Action: sale_items/upsert
   📝 [handleSaleItemUpsert] Vente reçue avec 1 item(s)
   ✅ [handleSaleItemUpsert] Vente insérée: ligne 150 (uuid=96a8387d...)
```

---

### Step 3: Stock Change Operation Generated (NEW)

```javascript
// In pushSales(), after markAsAcked
const stockOpsToAdd = [];
stockOpsToAdd.push({
  entity: 'stock_change',
  op: 'update',
  op_id: 'stock-op123-139',
  payload: {
    operation: 'update_stock',
    product_code: '139',
    unit_level: 'CARTON',
    unit_mark: 'DZ',
    stock_change: -1,  // ✅ NEGATIVE
    invoice_number: '20251206143627',
    uuid: '96a8387d-b9ff-4bf0-bd9a-e5568e81e190'
  }
});

outboxRepo.addOperation(stockOpsToAdd[0]);
console.log(`📦 [SALE] Auto-generated 1 stock_change ops`);
```

**Expected log**:
```
📤 [SALE] ↑1 ligne(s) de vente
📦 [SALE] Auto-generated 1 stock_change ops for sync
```

---

### Step 4: Stock Update Synced (Next Cycle)

```javascript
// Next pushPendingOperations cycle
const stockOps = [
  {
    entity: 'stock_change',
    op: 'update',
    payload: {
      operation: 'update_stock',
      product_code: '139',
      unit_level: 'CARTON',
      stock_change: -1,
      // ...
    }
  }
];

const result = await sheetsClient.pushBatch(stockOps);
```

**Expected log (Apps Script)**:
```
📋 [handleBatchPush] Traitement de 1 opération(s)
   🔄 [handleBatchPush] Action: stock_change/update
   📦 [handleStockUpdate] DÉBUT MISE À JOUR DU STOCK
   📋 [handleStockUpdate] Détails extraits:
      Product code: 139
      Unit level (brut): CARTON
      Unit mark: 'DZ'
      UUID: '96a8387d-b9ff-4bf0-bd9a-e5568e81e190'
      Stock change: -1
   🔍 [handleStockUpdate] Recherche du produit:
      Code produit recherché: '139' (normalisé: '139')
      Mark recherché: 'dz' (fourni: true)
      UUID recherché: '96a8387d...' (normalisé: '96a8387d...')
      ✅ Produit trouvé par UUID à la ligne 5
   ✅ [handleStockUpdate] Produit trouvé dans CARTON à la ligne 5
      Stock actuel dans Sheets: 4793
   📊 [handleStockUpdate] Mode RELATIF: 4793 + (-1) = 4792
   💾 [handleStockUpdate] Mise à jour de la cellule: ligne 5, colonne 3
      Valeur AVANT: 4793
      Valeur APRÈS: 4792
      ✅ Stock écrit avec succès
      🔍 Vérification: valeur lue après écriture: 4792
      ✅ Confirmation: La valeur a été correctement écrite
   ✅ [handleStockUpdate] Stock mis à jour avec succès: 139 (CARTON, mark=dz) dans CARTON
      4793 → 4792
```

---

## 🎯 Timeline

### T=0 sec: User Creates Sale
```
App: Sale created locally
DB: {invoice: 20251206, product: 139, qty: 1}
Outbox: [sale_item_upsert operation]
Stock (local): Reduced to 4792 (or not yet)
```

### T=3-13 sec: First Sync Cycle
```
[SYNC] startPushSyncLoop triggered
[PUSH] pushPendingOperations() called
[BATCH] 1 sale_item_upsert sent to Sheets
[APPS SCRIPT] handleSaleItemUpsert() adds Ventes row ✅
[OUTBOX] stock_change operation generated ✅
Stock (Sheets): Still 4793 (update not yet sent)
```

### T=13-23 sec: Second Sync Cycle
```
[SYNC] startPushSyncLoop triggered again
[PUSH] pushPendingOperations() called
[BATCH] 1 stock_change operation sent to Sheets
[APPS SCRIPT] handleStockUpdate() finds product by UUID ✅
[APPS SCRIPT] Calculates: 4793 + (-1) = 4792 ✅
[APPS SCRIPT] Updates CARTON stock to 4792 ✅
Stock (Sheets): 4792 ✅
```

### Result
```
Ventes sheet: 1 row (invoice 20251206, product 139, qty=1) ✅
CARTON sheet: Stock reduced from 4793 to 4792 ✅
```

---

## 🔀 Alternative: Direct Stock Absolute (Option B)

### Timeline with stock_absolute

```
T=0:   User creates sale
DB:    Stock reduced to 4792 locally
Outbox: sale_item_upsert + stock_absolute=4792

T=3:   First sync: sale_item_upsert sent
       Stock_absolute=4792 queued

T=13:  Second sync: stock_absolute=4792 sent
       Apps Script: Replace Sheets stock with 4792
       Result: Sheets stock = 4792 ✅
```

**Difference**: 
- Option A (stock_change): Relative, cumulative (4793 + (-1))
- Option B (stock_absolute): Absolute, overwrites (4792)

**Best choice**: Option A (stock_change) for robustness

---

## ⚠️ What Could Go Wrong

### Problem 1: UUID Not Normalizing

```
Expected: '96a8387d-b9ff-...' → '96a8387db9ff'
Actual: '96a8387d-b9ff-...' (not normalized)
Result: UUID doesn't match → product not found ❌

Fix: Ensure normalizeCode() is called on BOTH sides
```

### Problem 2: CARTON Mark Forcing Match Failure

```
Payload: unit_mark='DZ'
Sheets:  CARTON row has mark='' (empty)
Logic:   markProvided=true, so requires mark match
Result: 'DZ' !== '' → no match → not found ❌

Fix: Check isCarton first, skip mark logic for CARTON
     ✅ APPLIED in FIX B
```

### Problem 3: stock_change Not Sent

```
[SALE] ↑1 ligne(s) de vente ✅
[SALE] Auto-generated 0 stock_change ops ❌  ← Problem

Causes:
- items array empty
- qty = 0 or negative
- stockOpsToAdd not added to outbox
```

### Problem 4: Stock Reduced Twice (No Idempotency)

```
Time 1: Send sale → Auto-generate stock_change → Stock 4793→4792
Time 2: Retry sale (timeout) → Another stock_change → Stock 4792→4791 ❌

Solution: Add request_id idempotency (see separate doc)
```

---

## 📈 Success Metrics

### After Implementation

✅ **Metric 1: Stock Update Success Rate**
- Before: 0% (no update_stock called)
- After: 100% (auto-generated per sale item)

✅ **Metric 2: UUID Matching**
- Before: 0% (not normalized)
- After: 100% (normalized both sides)

✅ **Metric 3: CARTON Product Finding**
- Before: ~50% (mark logic blocking)
- After: 100% (code-only match)

✅ **Metric 4: Sync Cycles to Completion**
- Before: 1 cycle (sale only)
- After: 2 cycles (sale + stock)

---

## 🧪 Validation Checklist

After implementation:

- [ ] Code.gs FIX A: UUID normalization applied
- [ ] Code.gs FIX B: CARTON mark logic fixed
- [ ] sync.worker.js: stock_change generation added
- [ ] Stock ops queued after each sale
- [ ] Sheets stock reduced after each sale
- [ ] No double reduction on retries (needs idempotency)
- [ ] Logs show complete pipeline
- [ ] Test scenario passes

---

## 🚀 Deployment Steps

1. **Deploy Code.gs fixes**
   - Upload Code.gs to Apps Script
   - Verify FIX A and FIX B applied
   - Test handleStockUpdate logs

2. **Deploy Node.js integration**
   - Add stock_change generation to pushSales()
   - Run npm run build (if applicable)
   - Deploy to production

3. **Monitor**
   - Track logs for auto-generated stock ops
   - Verify stock reduction in Sheets
   - Check for errors in handleStockUpdate

4. **Validate**
   - Run test case from 00-STOCK-UPDATE-INTEGRATION.md
   - Confirm stock reduced correctly
   - Check no double-reduction

---

**Last Updated**: 7 January 2026  
**Status**: Design Complete, Ready for Implementation
