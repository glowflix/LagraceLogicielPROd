# 🚀 QUICK REFERENCE - DEBTS SYNC TESTS

## 1️⃣ BACKFILL (Google Apps Script) - DO THIS FIRST
```javascript
// In Google Apps Script Console:
backfillDettesTechColumns()

// Wait for: [backfillDettesTechColumns] ✅ Terminé. Modifs: 500
```

---

## 2️⃣ PULL TESTS (GET debts from Sheets)

### Full Import (tous les dettes)
```bash
curl "http://localhost:3000/api/sync?entity=debts&full=1&cursor=2&limit=300"
```
Expected: Array of ~500 debts with uuid, invoice_number, client_name, total_fc, etc.

### Incremental Pull (depuis une date)
```bash
curl "http://localhost:3000/api/sync?entity=debts&since=2026-01-01T00:00:00Z&limit=300"
```
Expected: Only debts modified after 2026-01-01

### Pagination Test
```bash
curl "http://localhost:3000/api/sync?entity=debts&cursor=2&limit=5"
# Should return 5 debts
# next_cursor = 7 (if more exist)
# done = false (if more exist)
```

---

## 3️⃣ PUSH TESTS (POST/upsert to Sheets)

### Test 3.1: Create New Debt
```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "debts",
    "op": "upsert",
    "payload": {
      "client_name": "Test Client ABC",
      "invoice_number": "TEST-2026-001",
      "product_description": "Test Product",
      "total_fc": 50000,
      "paid_fc": 0,
      "remaining_fc": 50000,
      "status": "open"
    }
  }'
```

Expected: 
- HTTP 200
- Response with generated UUID
- New row in Sheets "Dettes"

### Test 3.2: Update Existing Debt
```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "debts",
    "op": "upsert",
    "payload": {
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "invoice_number": "001",
      "client_name": "PA MUKANIA",
      "product_description": "139",
      "total_fc": 13800,
      "paid_fc": 6900,
      "remaining_fc": 6900,
      "status": "partial"
    }
  }'
```

Expected:
- HTTP 200
- Existing row updated (not new row created)
- paid_fc changed to 6900
- status changed to "partial"

### Test 3.3: Multi-Product Same Invoice (No Overwrite Test)
```bash
# Product 1: Invoice 001, Client PA MUKANIA, Product 139
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "debts",
    "op": "upsert",
    "payload": {
      "invoice_number": "001",
      "client_name": "PA MUKANIA",
      "product_description": "139",
      "total_fc": 13800,
      "paid_fc": 0,
      "remaining_fc": 13800,
      "status": "open"
    }
  }'

# Product 2: Same invoice 001, same client, different product 69
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "debts",
    "op": "upsert",
    "payload": {
      "invoice_number": "001",
      "client_name": "PA MUKANIA",
      "product_description": "69",
      "total_fc": 40020,
      "paid_fc": 0,
      "remaining_fc": 40020,
      "status": "open"
    }
  }'
```

Expected: 
- TWO separate rows in Sheets (not one overwritten)
- Row 1: Product 139, 13800 FC
- Row 2: Product 69, 40020 FC
- Both have different UUIDs

---

## 4️⃣ SQL VALIDATION

### Check SQLite debts table
```sql
-- Count
SELECT COUNT(*) FROM debts;

-- Sample
SELECT id, uuid, invoice_number, client_name, product_description, total_fc, paid_fc, status
FROM debts
ORDER BY created_at DESC
LIMIT 10;

-- Find multi-product debts
SELECT invoice_number, COUNT(*) as count
FROM debts
WHERE invoice_number IS NOT NULL
GROUP BY invoice_number
HAVING count > 1
ORDER BY invoice_number;
```

---

## 5️⃣ LOGS TO GREP FOR

### Success Indicators
```
✅ [getDebtsPage] Pull paginé terminé: X item(s)
📥 [DEBTS] Pull | Tentative 1/2
💳 [DEBT] X dette(s) à envoyer
✅ X dette(s) envoyée(s) avec succès
```

### Failure Indicators
```
❌ [getDebtsPage] FEUILLE "Dettes" NON TROUVÉE!
⚠️ Aucune dette retournée
Error: Cannot read property '0' of null
Error during PUSH: (any error)
```

---

## 6️⃣ ELECTRON APP TEST

### Quick Flow
1. Start app: `npm run dev`
2. Wait for sync (should see logs)
3. Create/Edit a debt in app
4. Check sync logs for: `💳 [DEBT] 1 dette(s) à envoyer`
5. Verify in Sheets: New row appeared

### Monitor Logs in Real-Time
```bash
# In separate terminal
tail -f app.log | grep -i "debt\|dettes"
```

---

## 7️⃣ COMMON TEST FLOW (Complete)

```bash
# Terminal 1: Start backend
cd "D:\logiciel\La Grace pro\v1"
npm run dev:backend

# Terminal 2: Run tests
# 2.1 Full Pull
curl "http://localhost:3000/api/sync?entity=debts&full=1" | jq '.data | length'
# Expected: 500+ (or number from backfill)

# 2.2 Create test debt
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"entity":"debts","op":"upsert","payload":{"client_name":"Test","invoice_number":"TST-001","product_description":"TestProd","total_fc":1000,"paid_fc":0,"remaining_fc":1000,"status":"open"}}' \
  | jq '.uuid'
# Expected: UUID returned

# 2.3 Check in Sheets - should see new row

# 2.4 Update the test debt
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"entity":"debts","op":"upsert","payload":{"client_name":"Test","invoice_number":"TST-001","product_description":"TestProd","total_fc":1000,"paid_fc":500,"remaining_fc":500,"status":"partial"}}' \
  | jq '.status'
# Expected: "partial"

# 2.5 Check in Sheets - row should update (not new row)
```

---

## 🔍 TROUBLESHOOTING

### "Colonne manquante" error
```
❌ [getDebtsPage] ERREUR: Colonne "date" manquante!
```
→ Check Sheets has column named "date" (case insensitive, can have accents)

### "FEUILLE Dettes NON TROUVÉE"
```
❌ [getDebtsPage] FEUILLE "Dettes" NON TROUVÉE!
```
→ Rename sheet to exactly "Dettes" (or update SHEETS.DETTES constant)

### UUID duplicates
```
// In SQL
SELECT uuid, COUNT(*) FROM debts GROUP BY uuid HAVING COUNT(*) > 1;
```
→ Run backfillDettesTechColumns() only ONCE
→ Each UUID should be unique

### Rows getting overwritten
```
INSERT 2 debts: same invoice_number + client_name, different products
→ Both should exist, not overwrite
```
→ Verify clé composite includes product_description

---

## 📊 SUCCESS METRICS

| Metric | Target | Command |
|--------|--------|---------|
| Total debts in Sheets | ~500 | COUNT(*) FROM debts |
| Unique UUIDs | 500 | SELECT DISTINCT uuid |
| _updated_at filled | 100% | WHERE _updated_at IS NULL |
| Multi-product invoices | Maintain count | GROUP BY invoice_number HAVING >1 |
| PULL latency | <2s | Monitor /api/sync response time |
| PUSH latency | <1s | Monitor /api/sync POST response |

---

## 🎯 ACCEPTANCE CRITERIA

- [ ] `backfillDettesTechColumns()` executed
- [ ] PULL full: Returns 500+ debts
- [ ] PULL incremental: Works with `since` parameter
- [ ] PUSH create: New debt created in Sheets
- [ ] PUSH update: Existing debt updated (not overwritten)
- [ ] PUSH multi-product: 2 products = 2 rows (no data loss)
- [ ] Logs show success messages (✅)
- [ ] App end-to-end: Create debt in Electron → appears in Sheets

---

**Generated**: 2026-01-03
**Status**: ✅ READY FOR TESTING
