# 📋 NODE.JS COPY-PASTE SNIPPETS

**Purpose**: Exact code to add request_id support (optional)  
**Effort**: ~5 minutes  
**Files**: 3 (sheets.client.js, sync.worker.js, debts-sync-manager.js)

---

## 📄 File 1: sheets.client.js

**Location**: [src/services/sync/sheets.client.js](src/services/sync/sheets.client.js#L119)

**Find this (around line 119)**:
```javascript
const res = await this.axios.post(url, {
  action: 'batchPush',
  device_id: process.env.DEVICE_ID || 'PC-1',
  ops
}, { timeout });
```

**Replace with**:
```javascript
const res = await this.axios.post(url, {
  action: 'batchPush',
  device_id: process.env.DEVICE_ID || 'PC-1',
  request_id: opts?.request_id || null,
  ops
}, { timeout });
```

**What changed**: Added `request_id: opts?.request_id || null,`

---

## 📄 File 2: sync.worker.js

**Location**: [src/services/sync/sync.worker.js](src/services/sync/sync.worker.js)

### Snippet 1: pushStockMoves (around line 680)

**Find this**:
```javascript
const result = await sheetsClient.pushBatch(ops, { timeout: 60000 });
```

**Replace with**:
```javascript
const batchRequestId = `STOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const result = await sheetsClient.pushBatch(ops, { 
  timeout: 60000,
  request_id: batchRequestId
});
```

---

### Snippet 2: pushDebts (around line 788)

**Find this**:
```javascript
const result = await sheetsClient.pushBatch(ops, { timeout: 60000 });
```

**Replace with**:
```javascript
const batchRequestId = `DEBT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const result = await sheetsClient.pushBatch(ops, { 
  timeout: 60000,
  request_id: batchRequestId
});
```

---

### Snippet 3: pushSales (around line 896)

**Find this**:
```javascript
const result = await sheetsClient.pushBatch(ops, { timeout: 60000 });
```

**Replace with**:
```javascript
const batchRequestId = `SALE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const result = await sheetsClient.pushBatch(ops, { 
  timeout: 60000,
  request_id: batchRequestId
});
```

---

## 📄 File 3: debts-sync-manager.js

**Location**: [src/services/sync/debts-sync-manager.js](src/services/sync/debts-sync-manager.js)

### Snippet 1: DEBTS (around line 72)

**Find this**:
```javascript
const result = await sheetsClient.pushBatch(ops, { timeout: 60000 });
```

**Replace with**:
```javascript
const batchRequestId = `IDEMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const result = await sheetsClient.pushBatch(ops, { 
  timeout: 60000,
  request_id: batchRequestId
});
```

---

### Snippet 2: PAYMENTS (around line 148)

**Find this**:
```javascript
const result = await sheetsClient.pushBatch(ops, { timeout: 60000 });
```

**Replace with**:
```javascript
const batchRequestId = `IDEMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const result = await sheetsClient.pushBatch(ops, { 
  timeout: 60000,
  request_id: batchRequestId
});
```

---

### Snippet 3: CLIENTS (around line 214)

**Find this**:
```javascript
const result = await sheetsClient.pushBatch(ops, { timeout: 60000 });
```

**Replace with**:
```javascript
const batchRequestId = `IDEMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const result = await sheetsClient.pushBatch(ops, { 
  timeout: 60000,
  request_id: batchRequestId
});
```

---

## ✅ Verification Checklist

After applying all snippets, verify:

- [ ] sheets.client.js: `request_id: opts?.request_id || null,` added
- [ ] sync.worker.js: 3 methods (pushStockMoves, pushDebts, pushSales) updated
- [ ] debts-sync-manager.js: 3 sections (DEBTS, PAYMENTS, CLIENTS) updated
- [ ] All files: `batchRequestId` generated before each `sheetsClient.pushBatch()`
- [ ] All files: request_id passed in options object

---

## 🧪 Quick Test

Run this to verify apps-script receives request_id:

```javascript
// In Apps Script Code.gs, in doPost function, add:
console.log(`📨 [doPost] request_id received: ${data.request_id || '(none)'}`);
```

Expected logs when using Node.js snippets:
```
📨 [doPost] request_id received: STOCK-1704702048123-a1b2c3d
📨 [doPost] request_id received: DEBT-1704702048456-x9y8z7w
📨 [doPost] request_id received: SALE-1704702048789-m5n4o3p
```

---

## 📊 Summary

| File | Additions | Effort |
|------|-----------|--------|
| sheets.client.js | 1 line | 1 min |
| sync.worker.js | 6 lines (3×2) | 2 min |
| debts-sync-manager.js | 6 lines (3×2) | 2 min |
| **Total** | **13 lines** | **~5 min** |

---

## ⚠️ Important Notes

1. **Backward Compatible**: Works with or without Node.js changes
2. **Cache TTL**: Apps Script side = 6 hours
3. **Request ID Format**: Any unique string works (example: UUID, timestamp, counter)
4. **Edge Cases**: If request_id omitted, Apps Script still dedupes with UUID stable

---

**That's it!** 5 minutes to ultra-resilience 🚀
