# ⚡ Quick Reference: UUID Duplicates Fix

## 🔥 TL;DR

**Problem**: Duplicate rows appearing in synced Google Sheets data (same UUID, timestamp)  
**Root Cause**: Pagination without deduplication in getSalesPage()  
**Solution**: 3-layer deduplication (Apps Script + Client + Database)  
**Status**: ✅ Fixed and documented  

---

## 🚀 Quick Start

### 1. Deploy Google Apps Script
```
1. Open Google Apps Script Editor (linked to Spreadsheet)
2. Copy modified Code.gs
3. Deploy as new version
4. Test getSalesPage endpoint
```

### 2. Restart Local Service
```bash
npm run dev
```

### 3. Verify It's Working
```bash
SYNC_VERBOSE=1 npm run dev 2>&1 | grep -E "(UUID dupliquée|doublons supprimés)"
```

Expected output:
```
⚠️ [getSalesPage] Ligne X ignorée: UUID dupliquée dans la même page
Page 1: 98/100 items (2 doublons supprimés)
```

---

## 📂 Files Modified

| File | Change | Purpose |
|------|--------|---------|
| `tools/apps-script/Code.gs` | Line 1933-1950 | Filter duplicates at source (Apps Script) |
| `src/services/sync/sheets.client.js` | Line 310-350 | Double-check at client level |

---

## 📊 Architecture

```
Google Sheets
    ↓
[1] getSalesPage() ← Filters UUID duplicates IN THIS PAGE
    ↓
[2] pullAllPaged() ← Filters UUID duplicates ACROSS ALL PAGES
    ↓
[3] upsert() ← Checks if UUID already in database
    ↓
SQLite (No duplicates guaranteed)
```

---

## ✅ Verification Checklist

### Logs Check
```bash
SYNC_VERBOSE=1 npm run dev
# Should see: "UUID dupliquée filtrée" or "UUID dupliquée dans la même page"
```

### Database Check
```bash
sqlite3 app.db << EOF
SELECT uuid, COUNT(*) as count FROM sale_items 
WHERE uuid IS NOT NULL AND uuid != '' 
GROUP BY uuid HAVING COUNT(*) > 1;
EOF
# Should return: (empty / no results)
```

### Count Check
```bash
sqlite3 app.db << EOF
SELECT 
  COUNT(*) as total,
  COUNT(DISTINCT uuid) as unique,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT uuid) THEN '✅ OK'
    ELSE '❌ Problem'
  END as status
FROM sale_items WHERE uuid IS NOT NULL;
EOF
```

---

## 🧹 Clean Up Existing Duplicates

If database already has duplicates:

```bash
# 1. Backup
cp app.db app.db.backup.$(date +%Y%m%d)

# 2. Clean
sqlite3 app.db << EOF
BEGIN TRANSACTION;
DELETE FROM sale_items 
WHERE id IN (
  SELECT id FROM (
    SELECT id,
    ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id ASC) as rn
    FROM sale_items 
    WHERE uuid IS NOT NULL AND uuid != ''
  )
  WHERE rn > 1
);
COMMIT;
EOF

# 3. Verify
sqlite3 app.db "SELECT COUNT(*) FROM sale_items; SELECT COUNT(DISTINCT uuid) FROM sale_items WHERE uuid IS NOT NULL;"
```

---

## 📚 Documentation Files

1. **`SYNC-DEDUPLICATION-FIX.md`** - Technical details & architecture
2. **`CLEANUP-DUPLICATES.md`** - SQL scripts & cleanup procedures
3. **`UUID-DUPLICATES-RESOLUTION.md`** - Complete resolution summary
4. **`DIAGNOSTIC-UUID-DUPLICATES.md`** - Analysis & validation guide

---

## 🔧 Code Changes at a Glance

### Google Apps Script (Code.gs)
```javascript
// NEW: Line ~1933
const uuidsSeenInThisPage = new Set();

// NEW: Line ~1945
if (pageUuid && uuidsSeenInThisPage.has(pageUuid)) {
  skippedDuplicateUuid++;
  continue;
}
```

### Node.js (sheets.client.js)
```javascript
// NEW: Line ~310
const seenUuids = new Set();
let duplicatesRemoved = 0;

// NEW: Line ~340-350
const filteredPageData = [];
for (const item of pageData) {
  if (item.uuid && seenUuids.has(item.uuid)) {
    duplicatesRemoved++;
  } else {
    if (item.uuid) seenUuids.add(item.uuid);
    filteredPageData.push(item);
  }
}
```

---

## ⏱️ Timeline

- **Before Fix**: Duplicates accumulate during pagination
- **After Fix**: Duplicates filtered at 3 layers
  - Layer 1: Removed in getSalesPage()
  - Layer 2: Removed in pullAllPaged()
  - Layer 3: Prevented in upsert()

---

## 🎯 Success Criteria

✅ No "UUID dupliquée" warnings in logs  
✅ `COUNT(*) == COUNT(DISTINCT uuid)` in database  
✅ Zero duplicates in new synced data  

---

## 🆘 Troubleshooting

| Issue | Fix |
|-------|-----|
| Duplicates still appearing | Redeploy Code.gs in Google |
| No dedup logs | Enable `SYNC_VERBOSE=1` |
| Performance degraded | Check network (not caused by fix) |
| Database locked | Kill process: `Get-Process node \| Stop-Process` |

---

## 📞 Support

See detailed docs:
- Technical: `SYNC-DEDUPLICATION-FIX.md`
- Cleanup: `CLEANUP-DUPLICATES.md`
- Diagnostic: `DIAGNOSTIC-UUID-DUPLICATES.md`

---

**Quick Reference**  
**Updated**: 2025-12-30  
**Status**: ✅ Ready to Deploy
