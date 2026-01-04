#!/usr/bin/env node
/**
 * Quick check: Vérifier les dettes dans SQLite avec UUID
 */

import { initDb, getDb } from './src/db/sqlite.js';

console.log('\n' + '='.repeat(70));
console.log('🔍 VÉRIFICATION RAPIDE DES DETTES DANS SQLite');
console.log('='.repeat(70) + '\n');

try {
  // Initialiser la BD
  initDb();
  const db = getDb();
  
  // Lire les dettes
  const debts = db.prepare(`
    SELECT 
      id,
      uuid,
      invoice_number,
      client_name,
      total_fc,
      status
    FROM debts
    ORDER BY id DESC
    LIMIT 10
  `).all();
  
  console.log(`📊 Total dettes: ${debts.length}\n`);
  
  if (debts.length === 0) {
    console.log('❌ AUCUNE DETTE TROUVÉE!');
  } else {
    console.log('✅ Dettes trouvées:');
    debts.forEach((d, i) => {
      const uuidStr = d.uuid ? `${d.uuid.substring(0, 8)}...` : '❌ MISSING';
      console.log(`  [${i+1}] ${d.invoice_number || 'N/A'} | ${d.client_name || 'N/A'} | ${d.total_fc} FC | UUID: ${uuidStr}`);
    });
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ Check complété!');
  console.log('='.repeat(70) + '\n');
  
  process.exit(0);
  
} catch (err) {
  console.error('❌ Erreur:', err.message);
  process.exit(1);
}
