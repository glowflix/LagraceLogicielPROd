// TEST SCRIPT: Directly push a product patch to Google Sheets
// This bypasses the UI and outbox to test the end-to-end flow

// Step 1: Manually insert a test patch into sync_operations
const testOpId = 'test-patch-' + Date.now();
const testPayload = {
  name: 'TEST_PRODUCT_' + new Date().toLocaleTimeString('fr'),
  is_active: 1
};

// For SQLite (local dev):
// INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
// VALUES ('test-patch-xxx', 'PRODUCT_PATCH', '550e8400-e29b-41d4-a716-446655440000', '1', '{"name":"TEST_XXX","is_active":1}', 'test-device', 'pending');

// Step 2: Run sync manually with: npm run dev (which triggers sync.worker.js periodically)
//         OR call POST http://localhost:5000/api/sync-test

// Step 3: Check Google Apps Script logs (in Code.gs editor, View → Logs)
// Look for:
// - "[PRODUCT-PATCH X] entity_code='1'..."
// - "✅ Parsed JSON: name='TEST_PRODUCT_...'"
// - "[handleProductUpsert] Début upsert: name='TEST_PRODUCT_...'"
// - "Nom ÉCRIT: 'TEST_PRODUCT_...'"

// Step 4: Check Google Sheets - should see product code '1' with new name

console.log('Test Data:');
console.log('Op ID:', testOpId);
console.log('Payload:', JSON.stringify(testPayload));
console.log('');
console.log('SQL to insert test patch:');
console.log(`INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)`);
console.log(`VALUES ('${testOpId}', 'PRODUCT_PATCH', '550e8400-e29b-41d4-a716-446655440000', '1', '${JSON.stringify(testPayload)}', 'test-device', 'pending');`);
