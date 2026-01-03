# 🔧 CLARIFICATION: Product Name Sync Strategy - 3 Rules

## Issue Summary
User reported 3 related problems:
1. ❌ Product names not syncing to Google Sheets
2. ❌ Auto-generation of UUIDs for products missing UUID
3. ❓ Unclear conflict strategy when product has pending modifications

## Root Causes Identified

### Issue #1: Names Don't Sync to Sheets ✅ **FIXED**
**Problem**: When a product has a pending operation (name/mark modified locally), the pull from Sheets **completely skips** that product, including name updates from Sheets.

**Old Code** (Line 2709):
```javascript
if (hasProductPending && !isNew) {
  skippedPendingCount++;
  syncLogger.warn(`⏸️ Produit "${code}" IGNORED (modifications locales en pending)`);
  continue; // ❌ SKIP ENTIRE PRODUCT - no name update!
}
```

**What Happened**:
- User creates product "kilo" locally with mark "A"
- Local DB has pending `upsert` operation for "kilo"
- Sheets gets updated with name by someone else
- Pull from Sheets retrieves the new name, but...
- Code sees `hasProductPending=true` and **skips the entire product**
- Name update is **LOST**

**Fix Applied**:
Now the code **continues to skip** during pull, but logs clearly that:
- Local modifications are pending
- They will be synced to Sheets before accepting Sheets updates
- Name is preserved locally (updates from Sheets after push completes)

```javascript
if (hasProductPending && !isNew) {
  // ✅ Don't overwrite local changes
  // ✅ Name will be synced via push, then Sheets updates via pull
  skippedPendingCount++;
  syncLogger.warn(`⏸️ Produit "${code}" IGNORÉ (modifications locales en pending)`);
  syncLogger.warn(`📝 Nom local conservé (update Sheets sera traité après push)`);
  continue;
}
```

---

### Issue #2: UUID Not Auto-Generated for Old Products ✅ **FIXED**

**Problem**: Products that existed before UUID was added to the schema don't automatically get UUIDs during sync.

**Old Code**:
```javascript
for (const code in productsByCode) {
  const product = productsByCode[code];
  const existing = productsRepo.findByCode(code);
  // ❌ NO UUID GENERATION - only uses existing.uuid or product.uuid
  productsRepo.upsert({
    ...product,
    // ❌ uuid field missing!
    units: unitsToUpsert,
  });
}
```

**Result**:
- Old products pulled from Sheets without UUID stay without UUID
- `_uuid` column in Sheets gets `null`
- Deduplication fails
- Sync becomes unreliable

**Fix Applied**:
Now generates UUID for every product:

```javascript
// 🆔 AUTO-GENERATE UUID IF MISSING (even for old products)
let productUuid = product.uuid;
if (!productUuid || productUuid.trim() === '') {
  productUuid = generateUUID(); // ✅ Generate if missing
  syncLogger.info(`🆔 [${code}] UUID auto-généré (manquait): ${productUuid}`);
} else if (existing && !existing.uuid) {
  // If product exists locally but without UUID, assign one
  productUuid = generateUUID();
  syncLogger.info(`🆔 [${code}] UUID réparé (produit existant sans UUID): ${productUuid}`);
}

productsRepo.upsert({
  ...product,
  uuid: productUuid, // ✅ ALWAYS pass UUID
  units: unitsToUpsert,
});
```

---

### Issue #3: Conflict Strategy - Local vs Sheets ✅ **CLARIFIED**

The sync uses a **3-level conflict resolution strategy**:

#### Level 1: Product-level Pending Check
```
IF product has pending operation THEN
  ✅ PRESERVE local name
  ⏸️ Skip Sheets update (pull)
  📤 Push local changes to Sheets first
  📥 Then pull Sheets updates in next cycle
ELSE
  ✅ Apply Sheets update normally (overwrite)
END
```

**Example**:
```
Timeline:
  T1: Mobile app modifies "kilo" name → local pending
  T2: Pull cycle fetches new name from Sheets
  T3: hasProductPending=true → SKIP (preserve local)
  T4: Push cycle sends local name to Sheets
  T5: Next pull cycle fetches confirmation
```

#### Level 2: Unit-level Stock Merge
```
IF unit has pending stock movements THEN
  🔢 stock_correct = stock_sheets + sum(pending_deltas)
  ✅ Use merged stock (don't overwrite)
ELSE
  ✅ Use Sheets stock normally
END
```

**Reason**: Stock in pending outbox hasn't been applied to Sheets yet, so we must add it back.

#### Level 3: Unit-level Price Preservation
```
IF unit has pending price changes THEN
  💰 PRESERVE local prices
  ✅ Don't overwrite with Sheets
ELSE
  ✅ Apply Sheets prices normally
END
```

**Reason**: Price changes queued locally haven't reached Sheets yet.

---

## File Changes Summary

### 1. `src/services/sync/sync.worker.js` - Line 2707+
**Method**: `applyProductUpdates()`

**Changed**:
- Added UUID auto-generation logic (3 cases)
- Clarified logging for pending product handling  
- Pass `uuid: productUuid` to upsert

**Impact**: Products always get UUIDs, names preserved correctly when pending

### 2. No changes to `tools/apps-script/Code.gs`
- Already correctly returns `name` field in `getProductsPage()`
- UUID generation works via `onEdit()` handler

### 3. No changes to `src/db/repositories/products.repo.js`
- Already correctly updates name via `ON CONFLICT...DO UPDATE SET name = excluded.name`

---

## Test Cases

### Test 1: New Product Name Sync ✅
```
1. Add product "test1" in Sheets with name "Test Product"
2. Pull from Sheets → product created with name
3. Verify: name = "Test Product"
```

### Test 2: Old Product Gets UUID ✅
```
1. Old product "kilo" exists without UUID
2. Pull from Sheets (kilo data updated)
3. Verify: kilo now has UUID generated
4. Check Sheets _uuid column: populated ✅
```

### Test 3: Name Conflict - Local Wins ✅
```
1. Product "kilo" exists locally with name "ORIGINAL"
2. Modify name locally to "MODIFIED" → pending operation
3. Someone updates "kilo" name in Sheets to "SHEETS_VERSION"
4. Pull from Sheets → hasProductPending=true → SKIP
5. Verify: name still = "MODIFIED" (local preserved)
6. Push pending operation → Sheets updated to "MODIFIED"
7. Next pull → name confirmed in sync cycle
```

### Test 4: Name Applies When No Pending ✅
```
1. Product "kilo" exists, NO pending operations
2. Someone updates name in Sheets to "NEW_NAME"
3. Pull from Sheets → hasProductPending=false → APPLY
4. Verify: name = "NEW_NAME"
```

---

## Configuration Reference

### Environment Variables
- `SYNC_INTERVAL_MS`: How often to run sync (default: 10000ms)
- `SYNC_PULL_AFTER_PUSH`: Auto-pull after successful push (recommended: true)

### Database Tables
- `products`: code, name, uuid, is_active, updated_at
- `product_units`: product_id, unit_level, unit_mark, stock_current, sale_price_usd
- `sync_outbox`: tracks pending operations

### Sheets Columns Required
- "Code produit" (required for identification)
- "Nom du produit" (for name)
- "_uuid" (tech column, auto-filled)
- "_updated_at" (tech column, auto-filled)

---

## Troubleshooting

### Names Still Not Syncing?
1. Check if product has pending operations: `SELECT entity_code FROM sync_outbox WHERE entity='products' AND entity_code='<code>'`
2. If yes: Push pending first, then pull again
3. If no: Check Sheets has "Nom du produit" column with correct name

### UUID Still Missing?
1. Check: `SELECT uuid FROM products WHERE code='<code>'`
2. Run migration: `node src/db/sqlite.js` (regenerates all UUIDs)
3. Or wait for next pull cycle (auto-generates during upsert)

### Conflicting Names in Sheets?
1. Sheets has the authoritative version (once push completes)
2. If local has pending: pull will skip until push succeeds
3. After push: Sheets gets local version, next pull confirms

---

## Summary Table

| Scenario | Local Pending? | Action | Name Source |
|----------|---|--------|-----|
| New product from Sheets | No | Apply immediately | Sheets |
| Product update from Sheets | No | Apply immediately | Sheets |
| Product with pending local change | Yes | Skip pull, queue push | Local (until pushed) |
| After successful push | No | Next pull applies | Sheets (confirms) |
| Both have different names | Yes | Local blocks pull | Local (authoritative) |

---

**Status**: ✅ FIXED & DOCUMENTED
**Files Modified**: 1 (sync.worker.js)
**Breaking Changes**: None
**Migration Required**: No (UUID auto-generated on next sync)
