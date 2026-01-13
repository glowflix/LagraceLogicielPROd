#!/usr/bin/env node

/**
 * Script pour vérifier l'état des STOCK_MOVE dans sync_operations
 * Utilisation: node check-pending-stock-moves.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'laGrace.db');
console.log(`📂 Ouverture de la base de données: ${dbPath}\n`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

try {
  // Récupérer toutes les STOCK_MOVE
  const allStockMoves = db.prepare(`
    SELECT op_id, status, op_type, created_at, updated_at, payload_json
    FROM sync_operations
    WHERE op_type = 'STOCK_MOVE'
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  console.log(`📊 Total STOCK_MOVE trouvées: ${allStockMoves.length}\n`);
  
  if (allStockMoves.length === 0) {
    console.log('❌ Aucune STOCK_MOVE trouvée dans sync_operations!');
    process.exit(0);
  }

  // Compter par status
  const byStatus = {};
  for (const op of allStockMoves) {
    byStatus[op.status] = (byStatus[op.status] || 0) + 1;
  }

  console.log('📈 Répartition par status:');
  for (const [status, count] of Object.entries(byStatus)) {
    const emoji = status === 'acked' ? '✅' : status === 'pending' ? '⏳' : status === 'error' ? '❌' : '❓';
    console.log(`   ${emoji} ${status.toUpperCase()}: ${count}`);
  }
  console.log('');

  // Afficher les détails
  console.log('📋 Détails des STOCK_MOVE:');
  console.log(''.padEnd(100, '─'));

  for (const op of allStockMoves) {
    let payload = {};
    try {
      payload = JSON.parse(op.payload_json);
    } catch (e) {
      // ignore
    }
    
    const emoji = op.status === 'acked' ? '✅' : op.status === 'pending' ? '⏳' : '❌';
    const product = payload.product_code || 'N/A';
    const unit = payload.unit_level || 'N/A';
    const stock = payload.stock_absolute !== undefined ? payload.stock_absolute : (payload.delta || 'N/A');
    
    console.log(`${emoji} ${op.status.padEnd(8)} │ ${product.padEnd(12)} │ ${unit.padEnd(8)} │ Stock: ${stock}`);
    console.log(`   📅 Créée: ${op.created_at} │ Modif: ${op.updated_at}`);
    console.log(`   🆔 op_id: ${op.op_id}`);
    console.log('');
  }

  // Résumé final
  const pendingCount = (byStatus['pending'] || 0);
  const ackedCount = (byStatus['acked'] || 0);
  const errorCount = (byStatus['error'] || 0);

  console.log(''.padEnd(100, '─'));
  console.log(`\n📊 RÉSUMÉ:`);
  console.log(`   ⏳ Pending (en attente): ${pendingCount}`);
  console.log(`   ✅ Acked (confirmées): ${ackedCount}`);
  console.log(`   ❌ Error (erreurs): ${errorCount}`);

  if (pendingCount > 0) {
    console.log(`\n⚠️  ATTENTION: ${pendingCount} STOCK_MOVE en attente!`);
    console.log('   → Ces opérations seront renvoyées au prochain cycle sync');
    console.log('   → Si non-acked, elles peuvent causer des doublons\n');
  } else {
    console.log(`\n✅ Aucune STOCK_MOVE en attente (toutes confirmées)\n`);
  }

} catch (error) {
  console.error('❌ Erreur:', error.message);
  process.exit(1);
} finally {
  db.close();
}
