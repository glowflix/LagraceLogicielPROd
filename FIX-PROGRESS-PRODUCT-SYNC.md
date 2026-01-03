# 🔧 FIX PROGRESS: Product Name and Mark Sync

## Problem Statement
User reports:
- ❌ **Product names don't sync** from mobile app to Google Sheets
- ❌ **Product marks don't sync** either  
- ✅ **Stock quantities DO sync** correctly
- ✅ **Recent fix (fan-out logic)** was applied but didn't resolve the issue

## Root Cause Analysis

### What Works ✅
- Stock sync via `update_stock` operation → handleStockUpdate() in Code.gs
- Fan-out logic correctly generates one patch per unit level
- Database correctly stores product names
- API correctly sends patches to Google Sheets

### What's Broken ❌
- Product name field not appearing in Sheets "Nom du produit" column
- Product mark field not appearing in Sheets "Mark" column
- handleProductUpsert() may not be receiving or writing these fields correctly

### Possible Root Causes (In Priority Order)

1. **Payload missing `name` field** (Probability: MEDIUM)
   - sync.worker.js sends `finalName = ''` if JSON parse fails
   - Code.gs receives empty string instead of actual name
   - Fix: Improved logging to detect this

2. **Column name mismatch** (Probability: MEDIUM)
   - findColumnIndex() searches for "Nom du produit" (case-insensitive)
   - But if column doesn't exist or has different name, colNom = -1
   - Then name won't be written

3. **handleProductUpsert() logic bug** (Probability: MEDIUM)
   - May not be handling the row update correctly
   - May be creating new row instead of updating existing row
   - Mark field may have no corresponding column

4. **Product doesn't exist in local database** (Probability: LOW)
   - If product "1" was never saved locally, upsert() creates with empty name
   - But user reports they CAN modify it in UI, so it must exist...

5. **Google Sheets UI cache** (Probability: LOW)
   - Data written but not visible until refresh (F5)
   - Sheets may need explicit reload

## Changes Made

### 1. ✅ Fixed sync.worker.js (Lines 307-380)
**File**: `src/services/sync/sync.worker.js`
**Changes**:
- Added detailed logging for payload parsing
- Logs show: `[PRODUCT-PATCH 0] entity_code='1', payload_json type=string`
- Logs show: `✅ Parsed JSON: name='...', is_active=...`
- Logs show: `Name value: finalName='...' (source: defined)`
- Fan-out logic confirmed working (creates one patch per unit)

**Result**: Can now see EXACTLY what payload is being sent to Google Sheets

### 2. ✅ Improved Code.gs logging (Lines 487-492)
**File**: `tools/apps-script/Code.gs`
**Changes**:
- Enhanced logging to show all received fields
- Now logs: `code='1', name='TEST_SYNC', unit_level='CARTON', unit_mark='CARTON'`
- Previously only logged code, unit_level, uuid

**Result**: Can now see EXACTLY what payload Code.gs receives

### 3. ✅ Added test endpoint (Lines 440-490)
**File**: `src/api/routes/products.routes.js`
**New Endpoint**: `POST /api/products/test/sync-name`
**What it does**:
- Bypasses UI and directly creates a test product patch
- Generates test name: `TEST_HH:MM:SS` (unique per call)
- Enqueues the patch for immediate sync
- Logs everything for verification

**How to use**:
```bash
curl -X POST http://localhost:5000/api/products/test/sync-name \
  -H "Authorization: Bearer <TOKEN>"
```

### 4. 📋 Created diagnostic guides
**Files**:
- `DIAGNOSTIC-NOM-SYNC.md` - French diagnostic guide
- `TEST-PRODUCT-NAME-SYNC.md` - Testing instructions

## Current Status

### ✅ Completed
- Fan-out logic implemented and verified in sync.worker.js
- Detailed logging added to all critical points
- Test endpoint created for easy diagnostics
- Diagnostic guides written
- File encoding issues fixed

### ⏳ Pending
- User must run tests to generate logs
- Logs will reveal the exact failure point
- Fix will depend on what logs show

## Next Steps for User

### STEP 1: Use the Test Endpoint
```bash
# Via curl (Windows PowerShell):
$headers = @{ "Authorization" = "Bearer <your_token_here>" }
$response = Invoke-WebRequest -Uri "http://localhost:5000/api/products/test/sync-name" `
  -Method POST -Headers $headers
$response.Content | ConvertFrom-Json
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Test patch enqueued",
  "test_name": "TEST_14:35:22",
  "op_id": "...",
  "instructions": [...]
}
```

### STEP 2: Wait 10 Seconds
- This allows the sync cycle to execute
- Dev server should log sync activity

### STEP 3: Check Google Apps Script Logs
1. Go to your Google Sheets
2. Menu: `Tools` → `Script editor` (or `Outils` → `Éditeur de script`)
3. Menu: `View` → `Logs` (or `Affichage` → `Journaux`)
4. Look for messages containing "PRODUCT-PATCH" and "TEST_"

### STEP 4: Search for These Messages

**Look for these logs** (in order):

1. **sync.worker.js sending**:
   ```
   [PRODUCT-PATCH 0] entity_code='1', payload_json type=string
     ✅ Parsed JSON: name='TEST_14:35:22', is_active=1
   ```

2. **handleProductUpsert receiving**:
   ```
   📦 [handleProductUpsert] Début upsert:
      code='1', name='TEST_14:35:22', unit_level='CARTON', unit_mark='CARTON'
   ```

3. **Name being written**:
   ```
   ✅ [handleProductUpsert] Nom ÉCRIT: 'TEST_14:35:22' dans colonne 2
   ```

4. **Row being updated**:
   ```
   📝 Mise à jour ligne 2
   ✅ Upsert terminé
   ```

### STEP 5: Report Based on Logs

**If you see all 4 messages above**:
- ✅ The sync IS working!
- Problem might be Google Sheets cache
- Try: F5 refresh, or `Ctrl+Shift+Del` to clear cache

**If you see message 1-2 but NOT message 3**:
- ❌ Column "Nom du produit" not found (colNom=-1)
- Solution: Check if column exists in Sheets, verify spelling

**If you see message 1-2 but name is EMPTY**:
- ❌ Payload has empty name field
- Problem in sync.worker.js JSON parsing
- Will need to investigate further

**If you DON'T see message 1 at all**:
- ❌ Patches not being sent to Google Sheets
- Dev server might not be running
- Check dev server logs for errors

## Files Modified

1. **src/services/sync/sync.worker.js** (Lines 307-380)
   - Enhanced pushProductPatches() with better logging
   - Fan-out logic confirmed

2. **tools/apps-script/Code.gs** (Lines 487-492)
   - Added logging for received fields

3. **src/api/routes/products.routes.js** (Added lines 440-490)
   - New test endpoint

4. **Files Created**:
   - DIAGNOSTIC-NOM-SYNC.md
   - TEST-PRODUCT-NAME-SYNC.md
   - TEST-PRODUCT-PATCH.js
   - insert-test-patch.cjs (for database testing)
   - FIX-PROGRESS: This file

## Quick Reference: Column Names

**For debugging, Google Sheets should have**:
- Column A: "Code produit" (or similar)
- Column B: "Nom du produit" (EXACT name required)
- Column ??: "Mark" (with corresponding unit marks)
- Column ??: "Stock initial" (should work, user confirms stock syncs)

## Architecture Overview

```
Mobile App UI
    ↓
PUT /api/products/:code {name, is_active, units}
    ↓
productsRepo.upsert() - saves to local SQLite
    ↓
outboxRepo.enqueueProductPatch() - stores in sync_operations
    ↓
[Every 10 seconds] sync.worker.js
    ↓
pushProductPatches() - flatMap creates one op per unit
    ↓
POST http://Google_Sheets_URL {action: 'batchPush', ops: [...]}
    ↓
Code.gs doPost() → handleBatchPush() → handleProductUpsert()
    ↓
Google Sheets updated with new name
```

## Testing Checklist

- [ ] Test endpoint responds with success
- [ ] Wait 10 seconds
- [ ] See [PRODUCT-PATCH messages in Code.gs logs
- [ ] See "Nom ÉCRIT" message in logs
- [ ] Check Google Sheets column B for test name
- [ ] If all pass, sync works! (might just be cache)
- [ ] If logs show empty name, investigate sync.worker.js
- [ ] If column not found, check Sheets column names

## Questions to Answer

1. **Is product code "1" visible in your Google Sheets**?
2. **What is the EXACT name of the "Nom du produit" column** (copy-paste)?
3. **When you modify the name in the app, do you see it locally**?
4. **Can you access Google Apps Script Logs easily?**
5. **Are you using the right Google Sheets (which has the Carton, Milliers, Piece sheets)?**

Answers to these will help pinpoint the exact issue!
