# 📦 Stock Update Integration - Node.js Copy-Paste Fixes

**Date**: 7 January 2026  
**Target Files**:
- `src/services/sync/sync.worker.js` (in `pushSales()` method)
- `src/services/sync/debts-sync-manager.js` (in `pushDebts()` method)

---

## 🎯 Option A: Add stock_change After Sales (RECOMMENDED)

### Where to Add

In **sync.worker.js**, in the `pushSales()` method, after marking operations as acked:

**Location**: Around line 900-930 (after `outboxRepo.markAsAcked()`)

### Copy-Paste Code

```javascript
// ✅ OPTION A: Generate stock_change operations for each sale item
// Add this AFTER pushSales completes successfully
async function pushSalesWithStockUpdate(saleOps) {
  // ... existing pushSales code ...
  
  // ✅ After successful push, generate stock updates
  if (ackedOpIds.length > 0) {
    outboxRepo.markAsAcked(ackedOpIds);
    
    // ✅ NEW: Generate stock_change operations for inventory reduction
    const stockOpsToAdd = [];
    for (const op of saleOps) {
      const payload = this.parseOpPayload(op);
      const sale = payload.sale || payload;
      const items = payload.items || [];
      
      for (const item of items) {
        // Only if qty > 0 (it's a sale, not a return)
        const qty = item.qty ? parseFloat(String(item.qty).replace(',', '.')) : 0;
        if (qty > 0) {
          stockOpsToAdd.push({
            entity: 'stock_change',
            op: 'update',
            op_id: `stock-${op.op_id}-${item.product_code}`,
            device_id: op.device_id || '',
            payload: {
              operation: 'update_stock',
              product_code: String(item.product_code || '').trim(),
              unit_level: String(item.unit_level || 'CARTON').trim(),
              unit_mark: String(item.unit_mark || '').trim(),
              stock_change: -qty,  // ✅ NEGATIVE for sales
              invoice_number: String(sale.invoice_number || op.entity_code || '').trim(),
              uuid: item.uuid || undefined,
              device_id: op.device_id || ''
            }
          });
        }
      }
    }
    
    // Add to outbox for next sync cycle
    if (stockOpsToAdd.length > 0) {
      for (const stockOp of stockOpsToAdd) {
        try {
          outboxRepo.addOperation(stockOp);
        } catch (e) {
          syncLogger.warn(`[SALE] Could not queue stock update: ${e.message}`);
        }
      }
      syncLogger.info(`📦 [SALE] Queued ${stockOpsToAdd.length} stock_change operations for inventory reduction`);
    }
  }
}
```

### Integration Steps

1. **Find `pushSales()` method** (around line 817)
2. **Locate the `markAsAcked()` call** (around line 900+)
3. **After that line, add the stock ops generation code above**

---

## 🎯 Option B: Direct Integration into pushSales

### Simpler Alternative

If you want to keep it in one place, replace the `markAsAcked()` section:

**BEFORE**:
```javascript
if (result.success && result.applied && result.applied.length > 0) {
  const uniqueOpIds = [...new Set(ops.map(o => o.op_id))];
  ackedOpIds.push(...uniqueOpIds);
  syncLogger.info(`📤 [SALE] ↑${ops.length} ligne(s) de vente`);
  syncLogger.incrementPushed('sales', ops.length);
}
```

**AFTER**:
```javascript
if (result.success && result.applied && result.applied.length > 0) {
  const uniqueOpIds = [...new Set(ops.map(o => o.op_id))];
  ackedOpIds.push(...uniqueOpIds);
  syncLogger.info(`📤 [SALE] ↑${ops.length} ligne(s) de vente`);
  syncLogger.incrementPushed('sales', ops.length);
  
  // ✅ OPTION B: Auto-generate stock updates for each item
  const stockOpsToAdd = [];
  for (const op of saleOps) {
    const payload = this.parseOpPayload(op);
    const sale = payload.sale || payload;
    const items = payload.items || [];
    
    for (const item of items) {
      const qty = item.qty ? parseFloat(String(item.qty).replace(',', '.')) : 0;
      if (qty > 0) {
        stockOpsToAdd.push({
          entity: 'stock_change',
          op: 'update',
          op_id: `stock-${op.op_id}-${item.product_code}`,
          device_id: op.device_id || '',
          payload: {
            operation: 'update_stock',
            product_code: String(item.product_code || '').trim(),
            unit_level: String(item.unit_level || 'CARTON').trim(),
            unit_mark: String(item.unit_mark || '').trim(),
            stock_change: -qty,  // ✅ NEGATIVE
            invoice_number: String(sale.invoice_number || op.entity_code || '').trim(),
            uuid: item.uuid || undefined,
            device_id: op.device_id || ''
          }
        });
      }
    }
  }
  
  if (stockOpsToAdd.length > 0) {
    for (const stockOp of stockOpsToAdd) {
      try {
        outboxRepo.addOperation(stockOp);
      } catch (e) {
        syncLogger.warn(`[SALE] Could not queue stock update: ${e.message}`);
      }
    }
    syncLogger.info(`📦 [SALE] Auto-generated ${stockOpsToAdd.length} stock_change ops for sync`);
  }
}
```

---

## 💾 Also Apply to Debts (debts-sync-manager.js)

### For Debt Repayment Stock Updates

In **debts-sync-manager.js**, in the section where debts are pushed, add similar logic:

**Find**: The section that handles `handleDebtRepayment()` or debt payment processing

**Add** (same pattern as above):
```javascript
// ✅ After debt payment syncs successfully
// If the payment involved stock change (e.g., product return), add stock update
if (debt.return_items && Array.isArray(debt.return_items)) {
  const returnStockOps = [];
  
  for (const item of debt.return_items) {
    const returnQty = item.return_qty ? parseFloat(item.return_qty) : 0;
    if (returnQty > 0) {
      returnStockOps.push({
        entity: 'stock_change',
        op: 'update',
        op_id: `stock-return-${debt.invoice_number}-${item.product_code}`,
        device_id: debt.device_id || '',
        payload: {
          operation: 'update_stock',
          product_code: String(item.product_code || '').trim(),
          unit_level: String(item.unit_level || 'CARTON').trim(),
          unit_mark: String(item.unit_mark || '').trim(),
          stock_change: returnQty,  // ✅ POSITIVE for returns
          invoice_number: String(debt.invoice_number || '').trim(),
          uuid: item.uuid || undefined,
          device_id: debt.device_id || ''
        }
      });
    }
  }
  
  if (returnStockOps.length > 0) {
    for (const op of returnStockOps) {
      outboxRepo.addOperation(op);
    }
    syncLogger.info(`📦 [DEBT] Queued ${returnStockOps.length} return stock updates`);
  }
}
```

---

## 🧪 Testing the Integration

### Test Case 1: Simple Sale with Stock Reduction

1. **Create a sale**:
   ```
   Product: 139
   Unit: CARTON
   Mark: DZ
   Qty: 1
   ```

2. **Check logs for**:
   ```
   [SALE] ↑1 ligne(s) de vente
   [SALE] Auto-generated 1 stock_change ops for sync  ✅
   ```

3. **Wait for next sync cycle** (10s)

4. **Check Code.gs logs for**:
   ```
   📦 [handleStockUpdate] DÉBUT MISE À JOUR DU STOCK
   🔍 [handleStockUpdate] Recherche du produit:
      Code produit recherché: '139'
      UUID recherché: '...'
   ✅ [handleStockUpdate] Produit trouvé par UUID à la ligne 5
   📊 [handleStockUpdate] Mode RELATIF: 4793 + (-1) = 4792
   ✅ Stock écrit avec succès
   ```

5. **Check Sheets**: CARTON sheet, product 139 → Stock should be 4792 ✅

### Test Case 2: Retry Scenario (Idempotency)

1. **Send same sale twice** (simulating timeout retry)

2. **First time**:
   - Ventes row created
   - stock_change queued and applied
   - Stock: 4793 → 4792

3. **Second time** (same sale retried):
   - Idempotency cache catches duplicate
   - No duplicate Ventes row
   - **stock_change will run again** (could reduce to 4791)

4. **Expected with proper idempotency**:
   - Ventes: 1 row (deduplicated)
   - Stock: 4792 (not 4791) ✅

**Note**: If seeing stock reduced twice, request_id idempotency is needed (see 00-NODEJS-REQUEST-ID-IMPLEMENTATION.md)

---

## 🔍 Validation Checklist

After applying patches:

- [ ] Code compiles without errors
- [ ] `pushSales()` calls modified successfully
- [ ] `stockOpsToAdd` array created and populated
- [ ] `outboxRepo.addOperation()` queues stock updates
- [ ] Test case 1 passes (stock reduced by qty)
- [ ] Test case 2 passes (no double reduction on retry)
- [ ] Code.gs logs show UUID matching
- [ ] Code.gs logs show Mode RELATIF calculation

---

## 📊 Expected Behavior

### Before Patch
```
Sale created: product 139, qty 1
Sheets Ventes: ✅ row added
Sheets CARTON stock: ❌ unchanged (4793)
```

### After Patch
```
Sale created: product 139, qty 1
Sheets Ventes: ✅ row added
stock_change queued: ✅ -1 operation
Sheets CARTON stock: ✅ reduced to 4792
```

---

## ⚠️ Common Issues

### Issue: Stock updated but CARTON stock didn't change

**Check**:
1. Is stock change operation being queued? → Check logs for `Auto-generated 1 stock_change ops`
2. Is `update_stock` being called? → Check Code.gs logs
3. Is unit_level normalized correctly? → Should be 'CARTON'
4. Is mark handling working? → CARTON should ignore mark

### Issue: Stock reduced twice on retry

**Cause**: Without request_id, same operation sent twice = stock reduced twice
**Solution**: Implement request_id idempotency (see 00-NODEJS-REQUEST-ID-IMPLEMENTATION.md)

### Issue: "stock_change operation not recognized"

**Check**:
1. Is entity='stock_change' correct? → Check payload structure
2. Is operation='update_stock' in payload? → Code.gs needs this field
3. Are all required fields present? → product_code, unit_level, stock_change, invoice_number

---

## 📝 Summary

**What was changed**: Added auto-generation of stock_change operations after sales sync

**Why**: Without explicit update_stock calls, inventory levels never change in Sheets

**Impact**: 
- ✅ Sales now automatically reduce stock
- ✅ No manual update_stock calls needed
- ✅ Works with existing Code.gs logic

**Files Modified**:
- `src/services/sync/sync.worker.js` (pushSales method, ~900-930)
- `src/services/sync/debts-sync-manager.js` (optional, for returns)

---

**Last Updated**: 7 January 2026  
**Status**: Ready to Apply
