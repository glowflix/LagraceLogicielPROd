#!/usr/bin/env node

/**
 * Insert a test product patch into sync_operations to test the complete sync flow
 * Usage: node insert-test-patch.cjs
 */

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'data', 'la-grace.db');
console.log(`📊 Opening database: ${dbPath}`);

const db = new Database(dbPath);

// First, check if product 1 exists
const product1 = db.prepare('SELECT uuid, code, name FROM products WHERE code = ?').get('1');
if (!product1) {
  console.log('❌ Product with code "1" not found. Creating test product...');
  const testUuid = 'test-product-1-' + Date.now();
  db.prepare(`
    INSERT INTO products (uuid, code, name, is_active) 
    VALUES (?, '1', 'Test Product 1', 1)
  `).run(testUuid);
  console.log(`✅ Created test product with UUID: ${testUuid}`);
} else {
  console.log(`✅ Product found: code='${product1.code}', name='${product1.name}', uuid='${product1.uuid}'`);
}

// Insert a test PRODUCT_PATCH
const testOpId = 'test-patch-' + Date.now();
const testPayload = {
  name: `TEST_SYNC_${new Date().toLocaleTimeString('fr-FR')}`,
  is_active: 1
};

console.log(`\n📝 Inserting test patch: op_id='${testOpId}'`);
console.log(`   Payload: ${JSON.stringify(testPayload)}`);

try {
  db.prepare(`
    INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
    VALUES (?, 'PRODUCT_PATCH', ?, '1', ?, 'test-device', 'pending')
  `).run(testOpId, product1.uuid || 'test-uuid', JSON.stringify(testPayload));
  
  console.log(`✅ Test patch inserted successfully!`);
  console.log(`\nNext steps:`);
  console.log(`1. Start the dev server: npm run dev`);
  console.log(`2. Wait ~10 seconds for the sync cycle to run`);
  console.log(`3. Check Google Apps Script logs (Code.gs editor → Logs) for:`);
  console.log(`   - "[PRODUCT-PATCH 0] entity_code='1'"`);
  console.log(`   - "✅ Parsed JSON: name='TEST_SYNC_..."`);
  console.log(`   - "[handleProductUpsert] Début upsert: name='TEST_SYNC_..."`);
  console.log(`4. Check Google Sheets - product code '1' should have new name`);
  console.log(`\nOr check database:  SELECT * FROM sync_operations WHERE op_id = '${testOpId}'`);
} catch (error) {
  console.error(`❌ Error inserting test patch: ${error.message}`);
  process.exit(1);
}

db.close();
