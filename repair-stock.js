import Database from 'better-sqlite3';

const dbPath = 'C:\\Glowflixprojet\\db\\glowflixprojet.db';
const db = new Database(dbPath);

console.log('\n╔════════════════════════════════════════╗');
console.log('║  🔧 RÉPARATION STOCK PIECE CASSÉ      ║');
console.log('╚════════════════════════════════════════╝\n');

// 1. Trouver les stocks négatifs impossibles
const badStocks = db.prepare(`
  SELECT pu.id, p.code, p.name, pu.unit_level, pu.stock_current, pu.stock_initial
  FROM product_units pu
  JOIN products p ON p.id = pu.product_id
  WHERE pu.stock_current < -1000000000 OR pu.stock_initial < -1000000000
  ORDER BY p.code
`).all();

console.log(`📊 Stocks cassés trouvés: ${badStocks.length}\n`);

if (badStocks.length > 0) {
  console.log('Avant réparation:');
  badStocks.forEach(s => {
    console.log(`  ${s.code}/${s.unit_level}: stock_current=${s.stock_current}, stock_initial=${s.stock_initial}`);
  });
  
  // 2. Réinitialiser à 0
  console.log('\n🔄 Réparation...');
  const updateStmt = db.prepare(`
    UPDATE product_units
    SET stock_current = 0, stock_initial = 0, updated_at = datetime('now')
    WHERE stock_current < -1000000000 OR stock_initial < -1000000000
  `);
  const result = updateStmt.run();
  console.log(`✅ ${result.changes} unité(s) réparée(s)\n`);
  
  // 3. Vérifier
  const fixed = db.prepare(`
    SELECT pu.id, p.code, p.name, pu.unit_level, pu.stock_current, pu.stock_initial
    FROM product_units pu
    JOIN products p ON p.id = pu.product_id
    WHERE pu.stock_current < -1000000000 OR pu.stock_initial < -1000000000
  `).all();
  
  console.log(`Après réparation: ${fixed.length} stock(s) cassés restants`);
}

// 3. Nettoyer les sync_operations en erreur avec stock cassé
console.log('\n🗑️  Nettoyage sync_operations en erreur...');
const errorOps = db.prepare(`
  SELECT COUNT(*) as count FROM sync_operations
  WHERE op_type = 'STOCK_MOVE' AND status = 'error'
`).get();

if (errorOps.count > 0) {
  const delResult = db.prepare(`
    DELETE FROM sync_operations
    WHERE op_type = 'STOCK_MOVE' AND status = 'error'
  `).run();
  console.log(`✅ ${delResult.changes} opération(s) en erreur supprimée(s)\n`);
}

// 4. Compter pending
const pending = db.prepare(`
  SELECT COUNT(*) as count FROM sync_operations
  WHERE status = 'pending'
`).get();

console.log(`📈 État actuel:`);
console.log(`   Pending: ${pending.count}`);

db.close();
console.log('\n✅ Réparation terminée!\n');
