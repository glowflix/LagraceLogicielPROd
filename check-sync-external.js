import Database from 'better-sqlite3';
import path from 'path';

// Ouvrir la DB de Glowflixprojet
const dbPath = 'C:\\Glowflixprojet\\db\\glowflixprojet.db';
const db = new Database(dbPath);

console.log('\n═══════════════════════════════════════════');
console.log('📊 Opérations SALE/SALE_DELETED/STOCK_MOVE');
console.log(`📁 DB: ${dbPath}`);
console.log('═══════════════════════════════════════════\n');

const rows = db.prepare(`
  SELECT 
    op_id, 
    op_type, 
    status, 
    entity_code,
    created_at 
  FROM sync_operations 
  WHERE op_type IN ('SALE', 'SALE_DELETED', 'STOCK_MOVE') 
  ORDER BY created_at DESC 
  LIMIT 50
`).all();

console.log(`Found: ${rows.length} operations\n`);

rows.forEach(row => {
  const statusEmoji = {
    'pending': '⏳',
    'sent': '📤',
    'acked': '✅',
    'error': '❌'
  }[row.status] || '❓';
  
  console.log(`${statusEmoji} [${row.op_type}] ${row.status.toUpperCase()}`);
  console.log(`   Entity: ${row.entity_code}`);
  console.log(`   Op ID: ${row.op_id.substring(0, 12)}...`);
  console.log(`   Created: ${row.created_at}`);
  console.log('');
});

db.close();
