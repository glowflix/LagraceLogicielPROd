import Database from 'better-sqlite3';
const db = new Database('./db/production.db');

const rows = db.prepare(
  "SELECT op_id, entity_code, entity_type, payload_json FROM sync_operations WHERE entity_code='1' ORDER BY created_at DESC LIMIT 3"
).all();

console.log('Outbox entries for product code "1":');
rows.forEach((row, idx) => {
  console.log(`\n[${idx}] op_id: ${row.op_id}`);
  console.log(`    entity_code: ${row.entity_code}`);
  console.log(`    entity_type: ${row.entity_type}`);
  console.log(`    payload_json: ${row.payload_json}`);
  try {
    const parsed = JSON.parse(row.payload_json);
    console.log(`    parsed: ${JSON.stringify(parsed, null, 2)}`);
  } catch (e) {
    console.log(`    ERROR parsing: ${e.message}`);
  }
});

db.close();
