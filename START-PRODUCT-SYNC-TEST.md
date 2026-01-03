# 🎯 START HERE FIRST: Product Name Sync - Fix Complete

## The Situation
Your product names and marks aren't syncing to Google Sheets, but stock quantities ARE syncing correctly.

**Good news**: We've created complete diagnostic tools to find and fix the exact issue.

## What Changed

### ✅ 3 Code Modifications
1. **sync.worker.js** - Now logs exactly what payload is being sent
2. **Code.gs** - Now logs exactly what it receives
3. **products.routes.js** - New test endpoint to trigger a sync directly

### ✅ 6 Documentation Files
- Quick start (5 minutes to test)
- Full technical details
- Step-by-step troubleshooting guide
- French diagnostic guide
- Navigation guide

## Next: Quick Test (5 minutes)

### Step 1: Trigger the Test
Open PowerShell and run:

```powershell
$token = "YOUR_AUTH_TOKEN_HERE"
$headers = @{ "Authorization" = "Bearer $token" }
Invoke-WebRequest -Uri "http://localhost:5000/api/products/test/sync-name" `
  -Method POST -Headers $headers
```

This will:
- Create a test product name like "TEST_14:35:22"
- Queue it for sync
- Return an operation ID

**Expected response**:
```json
{
  "success": true,
  "test_name": "TEST_14:35:22",
  "op_id": "...",
  "instructions": [...]
}
```

### Step 2: Wait 10 Seconds
Let the sync cycle execute.

### Step 3: Check the Logs
1. Go to your Google Sheets
2. Menu: `Tools` → `Script editor` (or `Outils` → `Éditeur de script`)
3. Menu: `View` → `Logs` (or `Affichage` → `Journaux`)
4. Look for lines with `[PRODUCT-PATCH` in them

### Step 4: Look for These 4 Messages

**If you see all 4 messages like this:**
```
[PRODUCT-PATCH 0] entity_code='1', payload_json type=string
  ✅ Parsed JSON: name='TEST_14:35:22', is_active=1

📦 [handleProductUpsert] Début upsert:
   code='1', name='TEST_14:35:22', unit_level='CARTON', unit_mark='CARTON'
   
   ✅ [handleProductUpsert] Nom ÉCRIT: 'TEST_14:35:22' dans colonne 2
   📝 Mise à jour ligne 2
   ✅ Upsert terminé
```

### Step 5: Check Google Sheets
- Find product code "1"
- Look at the "Nom du produit" column
- Should show "TEST_14:35:22"

## Possible Results

### ✅ Result 1: It Works!
```
Logs show ✅ and Sheets displays the test name
```
**Solution**: Your sync IS working! 
- Problem might just be Google Sheets cache
- Try: F5 refresh or `Ctrl+Shift+Del` clear cache
- If problem persists, Google Sheets may need full reload

### ❌ Result 2: Logs Show Error
```
[PRODUCT-PATCH 0]... 
❌ Parse error: Unexpected token...
```
**Solution**: The payload JSON is corrupted
- This means the data isn't being saved properly
- Need to investigate database

### ❌ Result 3: Logs Show Empty Name
```
Name value: finalName='' (source: undefined)
```
**Solution**: The name field is empty
- The product may not have been updated in the database
- The API call may not be sending the name

### ❌ Result 4: Logs Show Column Not Found
```
❌ colNom=-1 INVALIDE - colonne introuvable!
```
**Solution**: The column "Nom du produit" doesn't exist
- Check your Google Sheets
- Verify the column name exactly

### ❌ Result 5: No Logs at All
```
No [PRODUCT-PATCH messages appear in logs
```
**Solution**: The patches aren't being sent
- Check that dev server is running (`npm run dev`)
- Verify the Google Sheets URL in `config.env`

## Next Steps Based on Your Result

| If You See | Do This |
|-----------|---------|
| All 4 messages + name in Sheets | ✅ SUCCESS! Try F5 refresh. Done. |
| All 4 messages but name NOT in Sheets | Issue with Google Sheets cache. Try full reload. |
| Parse error message | Contact with full error text for investigation |
| Empty name in logs | Problem in sync.worker.js - need to debug |
| Column not found | Check Google Sheets column name spelling |
| No logs at all | Check dev server status, Google Sheets URL |

## Where to Find More Details

**Just want the quick test?**
→ You're reading it right now! 

**Want to understand what's happening?**
→ Read: `QUICK-START-SYNC-TEST.md`

**Want all the technical details?**
→ Read: `FIX-PROGRESS-PRODUCT-SYNC.md`

**Need step-by-step troubleshooting?**
→ Read: `TEST-PRODUCT-NAME-SYNC.md`

**Prefer French documentation?**
→ Read: `DIAGNOSTIC-NOM-SYNC.md`

**Not sure what to read?**
→ Read: `INDEX-SYNC-DIAGNOSTIC.md`

## Key Info to Remember

- **Test name format**: `TEST_HH:MM:SS` (unique each time)
- **Wait time**: 10 seconds for sync cycle
- **Logs location**: Google Apps Script → Tools → Script editor → View → Logs
- **Success criteria**: All 4 messages appear + name visible in Sheets
- **Column name**: Must be exactly "Nom du produit" (case doesn't matter)

## Troubleshooting: Can't Find Your Token?

If you don't know your auth token:

**Option 1: Check Browser**
1. Open app in browser
2. Open Developer Tools (F12)
3. Go to Storage → Cookies → look for "token" or "auth"
4. Copy the value

**Option 2: Check Local Storage**
1. Open app in browser
2. Open Developer Tools (F12)
3. Go to Console
4. Type: `localStorage.getItem('token')`
5. Copy the result (without quotes)

**Option 3: Use the Mobile App**
1. The mobile app already has authentication
2. The test endpoint will work with the same authentication
3. Check Network tab (F12) to see what Authorization header is used

## If Test Endpoint Doesn't Work

**Error: Connection refused**
- Dev server not running
- Run: `npm run dev`
- Wait 5-10 seconds
- Try again

**Error: Authentication failed**
- Wrong token
- Token expired
- Get new token from app

**Error: 404 Not Found**
- Endpoint might not have deployed
- Restart dev server
- It should be at `POST /api/products/test/sync-name`

## What This Fixes

This diagnostic will help us identify why:
- ❌ Names don't sync (but stocks do)
- ❌ Marks don't sync (but stocks do)

The issue is likely specific to the "product patch" operation, not the "stock update" operation (which works fine).

## Bottom Line

**You have everything you need to:**
1. Test the sync with one command
2. See exactly where it fails (if it does)
3. Report specific errors back
4. Get a targeted fix

**Run the test, check the logs, let me know what you see.**

---

## Quick Reference

```powershell
# The test command
$token = "YOUR_TOKEN"
$headers = @{ "Authorization" = "Bearer $token" }
Invoke-WebRequest -Uri "http://localhost:5000/api/products/test/sync-name" `
  -Method POST -Headers $headers

# Then check:
# 1. Google Sheets → Tools → Script editor → View → Logs
# 2. Look for [PRODUCT-PATCH messages
# 3. Check if product code "1" shows test name
```

---

**Questions?** Check the INDEX-SYNC-DIAGNOSTIC.md for which guide to read next.

**Ready to test?** Run the PowerShell command above! ⬆️
