# 📦 Stock Update Fixes - Critical Issues & Solutions

**Date**: 7 January 2026  
**Version**: 1.0  
**Status**: ✅ Applied to Code.gs

---

## 🔴 Critical Issues Found & Fixed

### Issue #1: UUID Matching Bug (FIXED ✅)

**Problem**: UUID comparison was broken due to normalization mismatch
```javascript
// BEFORE (BROKEN)
if (uuid && rowUuid === uuid) {  // uuid NOT normalized, rowUuid IS normalized
```

**Impact**: 
- Same UUID wouldn't match → product not found → stock never updated
- Silent failure in logs

**Fix Applied**:
```javascript
// AFTER (FIXED)
const uuidRaw = pickFirst(payload, ['uuid', '_uuid']);
const uuidNorm = normalizeCode(uuidRaw);  // ✅ Normalize BOTH

// Compare normalized vs normalized
if (uuidNorm && rowUuid === uuidNorm) {  // ✅ Both normalized
  rowIndex = i + 1;
  console.log(`   ✅ Produit trouvé par UUID à la ligne ${rowIndex}`);
  break;
}
```

**Files Modified**: `tools/apps-script/Code.gs` (lines ~1480-1490)

---

### Issue #2: CARTON Mark Enforcement Bug (FIXED ✅)

**Problem**: If CARTON received a mark from Ventes, matching would fail
```javascript
// BEFORE (BROKEN)
if (markProvided) {
  // CARTON was FORCED to match by code+mark, even though CARTON never uses mark
  if (rowMarkNorm === markNorm) { ... }  // rowMarkNorm is empty for CARTON
  // -> NO MATCH
}
```

**Impact**:
- Stock update fails for CARTON items with marks
- Falls back to wrong row or throws error

**Fix Applied**:
```javascript
// AFTER (FIXED)
if (isCarton) {
  // CARTON: ALWAYS match by code ONLY, ignore mark
  rowIndex = i + 1;
  console.log(`   ✅ CARTON: Produit trouvé par Code à la ligne ${rowIndex} (ignoring mark)`);
  break;
}

// For MILLIER/PIECE: Apply mark logic only if not CARTON
if (markProvided) {
  if (rowMarkNorm === markNorm) {
    rowIndex = i + 1;
    console.log(`   ✅ Produit trouvé par Code+Mark à la ligne ${rowIndex}`);
    break;
  }
} else {
  // ... mark-not-provided logic
}
```

**Files Modified**: `tools/apps-script/Code.gs` (lines ~1495-1520)

---

## ⚠️ Architectural Issue: Missing update_stock Calls

### The Real Problem

Your app sends `sale_item_upsert` (adds to Ventes sheet) but **never calls update_stock**.

```
[SALES] Item added to Ventes ✅
[STOCK] update_stock NOT called ❌
[RESULT] Stock unchanged ❌
```

### Root Cause Analysis

The flow is currently:
1. User creates sale locally
2. App calls `sale_item_upsert` → Ventes row added ✅
3. **No call to update_stock** → Stock never reduced ❌

```javascript
// EXAMPLE: Current incomplete flow
await sheetsClient.pushBatch([
  {
    entity: 'sale_items',
    op: 'upsert',
    payload: {
      invoice_number: '20251206143627',
      product_code: '139',
      unit_level: 'CARTON',
      unit_mark: 'DZ',
      qty: -1,  // Negative qty on Ventes sheet
      // ... other fields
    }
  }
  // ❌ NO update_stock operation here
]);
```

---

## ✅ Solution: Add Stock Updates After Sale Creation

### Option A: RECOMMENDED - Send stock_change (Relative Mode)

**Best for**: Fast sync, supports partial stock changes, compatible with retries

After recording sale, send:
```javascript
{
  operation: 'update_stock',
  product_code: '139',
  unit_level: 'CARTON',      // ✅ Must match unit level from Ventes
  unit_mark: 'DZ',            // ✅ Can be empty for CARTON
  stock_change: -1,           // ✅ NEGATIVE for sales
  invoice_number: '20251206143627',
  uuid: 'sale-item-uuid',     // ✅ Optional but recommended
  device_id: 'PC-01'
}
```

**Code.gs will**:
1. Find product by UUID/code/unit/mark
2. Calculate: `new_stock = current_stock + (-1) = current_stock - 1`
3. Update Stock initial cell
4. Log verification

**Pseudo-code for Node.js**:
```javascript
// After sale saved
const saleItem = {
  product_code: '139',
  unit_level: 'CARTON',
  unit_mark: 'DZ',
  qty: 1  // Positive qty
};

// Create stock_change operation (NEGATIVE of qty)
outboxRepo.addOperation({
  entity: 'stock_change',
  op: 'update',
  payload: {
    operation: 'update_stock',
    product_code: saleItem.product_code,
    unit_level: saleItem.unit_level,
    unit_mark: saleItem.unit_mark,
    stock_change: -saleItem.qty,  // ✅ NEGATIVE
    invoice_number: sale.invoice_number,
    uuid: saleItem.uuid,
    device_id: sale.device_id
  }
});
```

**Advantages**:
- ✅ Simple, straightforward
- ✅ Retries automatically handled
- ✅ Works for partial stock changes
- ✅ Already implemented in Code.gs

---

### Option B: Direct Stock Replacement (Absolute Mode)

**Best for**: Known stock level, bulk corrections

After retrieving stock level from local DB:
```javascript
{
  operation: 'update_stock',
  product_code: '139',
  unit_level: 'CARTON',
  unit_mark: 'DZ',
  stock_absolute: 4792,  // ✅ Already decreased by 1 locally
  invoice_number: '20251206143627',
  uuid: 'sale-item-uuid',
  device_id: 'PC-01'
}
```

**Code.gs will**:
1. Replace Sheets stock with `4792` (overwrites current value)
2. Works if local DB accurately reflects stock

**Pseudo-code**:
```javascript
// After sale saved and local stock updated
const localStock = stockRepo.getLevel('139', 'CARTON', 'DZ');  // e.g., 4792
outboxRepo.addOperation({
  entity: 'stock_absolute',
  op: 'update',
  payload: {
    operation: 'update_stock',
    product_code: '139',
    unit_level: 'CARTON',
    unit_mark: 'DZ',
    stock_absolute: localStock,  // ✅ Already decreased
    invoice_number: sale.invoice_number,
    uuid: saleItem.uuid,
    device_id: sale.device_id
  }
});
```

**Advantages**:
- ✅ Single source of truth (local DB)
- ✅ Works if local stock is always correct

**Disadvantages**:
- ❌ Doesn't work if local DB and Sheets drift
- ❌ No partial corrections possible

---

### Option C: Auto-Apply from Ventes (OPTIONAL Future)

**Concept**: After Ventes upsert succeeds, automatically call update_stock

Currently this is NOT implemented. Would require:
1. Modifying `handleSaleItemUpsert()` to return qty/unit/mark
2. Creating auto-generated update_stock operation
3. Adding it to batch

```javascript
// PSEUDO: Not yet implemented
async handleSaleItemUpsert(payload) {
  // ... create sale_item row ...
  
  // ✅ Auto-call stock update
  if (payload.items && payload.items.length > 0) {
    const stockOps = payload.items.map(item => ({
      operation: 'update_stock',
      product_code: item.product_code,
      unit_level: item.unit_level,
      unit_mark: item.unit_mark,
      stock_change: -item.qty,
      invoice_number: payload.invoice_number,
      uuid: item.uuid,
      device_id: payload.device_id
    }));
    // Add to batch automatically
  }
}
```

---

## 🎯 Implementation Checklist

### Step 1: Deploy Code.gs Fixes
- [x] Fix #1: UUID normalization (APPLIED)
- [x] Fix #2: CARTON mark handling (APPLIED)
- [ ] Upload to Apps Script
- [ ] Test UUID matching in logs

### Step 2: Implement Stock Update Calls

Choose **ONE** option (A recommended):

#### Option A: stock_change (Relative) - RECOMMENDED
- [ ] After `sale_item_upsert`, create `update_stock` operation
- [ ] Set `stock_change = -qty`
- [ ] Include all fields: product_code, unit_level, unit_mark, invoice_number, uuid
- [ ] Test with negative qty in logs

#### Option B: stock_absolute (Absolute)
- [ ] Query local stock level
- [ ] Create `update_stock` operation with `stock_absolute`
- [ ] Test with logs showing "Mode ABSOLU"

#### Option C: Auto-apply (Optional)
- [ ] Modify handleSaleItemUpsert if needed
- [ ] Add auto-generated stock ops
- [ ] Test end-to-end

### Step 3: Verify Stock Updates

Run this test scenario:
1. Product: code='139', unit='CARTON', mark='DZ'
2. Sheet stock before: 4793
3. Create sale: qty=1
4. Send `update_stock` with `stock_change=-1`
5. **Expected**: Sheet stock = 4792
6. **Verify logs**:
   - `✅ Produit trouvé par UUID`
   - `✅ Mode RELATIF: 4793 + (-1) = 4792`
   - `✅ Stock écrit avec succès`
   - `✅ Confirmation: La valeur a été correctement écrite`

---

## 📊 Expected Behavior After Fixes

### Before (BROKEN)
```
[SALES] Vente: 139/CARTON/DZ qty=1
         ✅ Row added to Ventes
         ❌ UUID doesn't match → stock unchanged
         ❌ CARTON mark logic fails → stock unchanged
         ❌ No update_stock call → stock unchanged
Result: Stock = 4793 (should be 4792)
```

### After (FIXED)
```
[SALES] Vente: 139/CARTON/DZ qty=1
        ✅ Row added to Ventes
[STOCK] update_stock called
        ✅ UUID matches with normalization
        ✅ CARTON ignores mark, matches by code
        ✅ stock_change=-1 applied
        ✅ Stock: 4793 → 4792
Result: Stock = 4792 ✅
```

---

## 🔍 Debugging Guide

### Symptom: "Product not found"

**Check Code.gs logs for**:
```
❌ [handleStockUpdate] Produit non trouvé dans CARTON:
   Code produit: 139
   Mark: 'DZ'
```

**Diagnostics**:
1. Does code '139' exist in CARTON sheet? → Search manually
2. Is UUID normalized correctly? → Check `UUID recherché: '...' (normalisé: '...')`
3. Is mark matching logic hitting CARTON case? → Should see `CARTON: ... ignoring mark`

### Symptom: "Stock didn't change"

**Check Code.gs logs for**:
```
✅ Produit trouvé dans CARTON à la ligne 5
   Stock actuel: 4793
   📊 Mode RELATIF: 4793 + (-1) = 4792
   ✅ Stock écrit avec succès
   🔍 Vérification: valeur lue après écriture: 4792
```

If you see this and stock didn't change in Sheets:
1. Sheets might be cached → Refresh F5
2. Cell might be formatted as text → Check column format (should be Number)
3. write permission issue → Check Apps Script authorization

### Symptom: "UUID doesn't match"

**Check logs**:
```
UUID recherché: '96a8387d-...' (normalisé: '96a8387d...')
```

If shows empty after normalization:
1. UUID might be null → Check `pickFirst()` in payload
2. UUID might have special chars → Check normalization logic
3. Row UUID also empty → Both need to be populated

---

## 📝 Code Changes Summary

### File: tools/apps-script/Code.gs

#### Change 1: UUID Normalization (Line ~1480)
```diff
- const uuidRaw = pickFirst(payload, ['uuid', '_uuid']);
+ const uuidRaw = pickFirst(payload, ['uuid', '_uuid']);
+ const uuidNorm = normalizeCode(uuidRaw);  // ✅ NEW

  ...

- if (uuid && rowUuid === uuid) {
+ if (uuidNorm && rowUuid === uuidNorm) {  // ✅ FIXED
    console.log(`   ✅ Produit trouvé par UUID`);
    break;
  }
```

#### Change 2: CARTON Mark Fix (Line ~1495)
```diff
- // ✅ NOUVELLE LOGIQUE: intelligente pour mark
- if (markProvided) {
-   if (rowMarkNorm === markNorm) {
+ // ✅ FIX B: CARTON matcher par code SEUL
+ if (isCarton) {
+   rowIndex = i + 1;
+   console.log(`   ✅ CARTON: ... ignoring mark`);
+   break;
+ }
+ 
+ if (markProvided) {
+   if (rowMarkNorm === markNorm) {
```

---

## 🚀 Next Steps

1. **Upload Code.gs** to Apps Script Editor (Ctrl+S)
2. **Choose stock_change option** (A recommended)
3. **Implement in Node.js** to send update_stock after sale
4. **Run test scenario** from debugging guide
5. **Monitor logs** for success patterns

---

## 📦 Impact Assessment

| Aspect | Before | After |
|--------|--------|-------|
| UUID Matching | ❌ Broken | ✅ Fixed |
| CARTON Mark Logic | ❌ Broken | ✅ Fixed |
| Stock Updates | ❌ None | ⏳ Requires update_stock |
| Error Messages | ❌ Silent | ✅ Detailed logs |

---

## ✅ Quality Checklist

- [x] UUID normalization bug identified & fixed
- [x] CARTON mark logic corrected
- [x] Code.gs changes applied
- [x] Logs updated for debugging
- [ ] Node.js update_stock implementation (to do)
- [ ] Production testing (to do)
- [ ] 24h monitoring (to do)

---

**Last Updated**: 7 January 2026  
**Status**: Code.gs Ready, Awaiting Node.js Integration
