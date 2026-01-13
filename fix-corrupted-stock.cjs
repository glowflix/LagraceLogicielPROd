/**
 * Script pour corriger les données de stock corrompues dans SQLite
 * Problème: stock_current avec des valeurs impossibles (< -1000000)
 * Cause: Corruption lors de la synchronisation
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = 'C:\\Glowflixprojet\\db\\glowflixprojet.db';

console.log('🔧 [FIX-STOCK] Ouverture de la base de données...');
const db = new Database(DB_PATH);

try {
  // 1️⃣ Rechercher les données corrompues
  console.log('\n📊 [FIX-STOCK] RECHERCHE DES DONNÉES CORROMPUES...');
  console.log('─'.repeat(70));
  
  const corrupted = db.prepare(`
    SELECT code, unit_level, stock_current 
    FROM product_units 
    WHERE stock_current < -1000000
    ORDER BY stock_current
  `).all();

  if (corrupted.length === 0) {
    console.log('✅ Aucune donnée corrompue trouvée!');
  } else {
    console.log(`❌ ${corrupted.length} ligne(s) corrompue(s) détectée(s):\n`);
    
    for (const row of corrupted) {
      console.log(`   ⚠️  ${row.code}/${row.unit_level}: stock_current = ${row.stock_current}`);
    }
  }

  // 2️⃣ Spécifiquement 95/PIECE
  console.log('\n📦 [FIX-STOCK] RECHERCHE 95/PIECE...');
  console.log('─'.repeat(70));
  
  const product95 = db.prepare(`
    SELECT * FROM product_units 
    WHERE code='95' AND unit_level='PIECE'
  `).get();

  if (product95) {
    console.log(`Trouvé: code=${product95.code}, unit_level=${product95.unit_level}`);
    console.log(`   stock_current AVANT: ${product95.stock_current}`);
  } else {
    console.log('❌ Produit 95/PIECE non trouvé');
  }

  // 3️⃣ Corriger les données
  if (corrupted.length > 0) {
    console.log('\n🔨 [FIX-STOCK] CORRECTION DES DONNÉES...');
    console.log('─'.repeat(70));
    
    const updateResult = db.prepare(`
      UPDATE product_units 
      SET stock_current = 0 
      WHERE stock_current < -1000000
    `).run();
    
    console.log(`✅ ${updateResult.changes} ligne(s) corrigée(s)`);
  }

  // 4️⃣ Vérifier après correction
  console.log('\n✔️  [FIX-STOCK] VÉRIFICATION APRÈS CORRECTION...');
  console.log('─'.repeat(70));
  
  const product95After = db.prepare(`
    SELECT * FROM product_units 
    WHERE code='95' AND unit_level='PIECE'
  `).get();

  if (product95After) {
    console.log(`✅ 95/PIECE CORRIGÉ:`);
    console.log(`   stock_current APRÈS: ${product95After.stock_current}`);
  }

  // 5️⃣ Compter les anomalies restantes
  const remaining = db.prepare(`
    SELECT COUNT(*) as count FROM product_units 
    WHERE stock_current < -100000
  `).get();

  console.log('\n📈 [FIX-STOCK] RÉSUMÉ FINAL:');
  console.log('─'.repeat(70));
  console.log(`✅ Stock < -100000: ${remaining.count} (avant: ${corrupted.length})`);
  
  if (remaining.count === 0) {
    console.log('🎉 ✅ TOUTES LES DONNÉES CORROMPUES SONT FIXÉES!');
  }

} catch (error) {
  console.error('❌ [FIX-STOCK] ERREUR:', error.message);
  console.error(error);
} finally {
  db.close();
  console.log('\n✅ Base de données fermée');
}
