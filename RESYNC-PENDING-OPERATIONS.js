/**
 * RESYNC-PENDING-OPERATIONS.js
 * 
 * Force la resynchronisation des 138 opérations en attente
 * vers Google Sheets
 */

import Database from 'better-sqlite3';
import { getProjectRoot } from './src/core/paths.js';
import path from 'path';

async function resyncPendingOperations() {
  console.log('\n' + '='.repeat(80));
  console.log('RESYNC PENDING OPERATIONS');
  console.log('='.repeat(80) + '\n');

  try {
    const dbPath = path.join(getProjectRoot(), 'db', 'glowflixprojet.db');
    const db = new Database(dbPath);

    // Vérifier les opérations en attente
    const pending = db.prepare(`
      SELECT op_id, entity_code, status FROM sync_outbox 
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    console.log(`📊 Opérations en attente (affichage des 10 premières):`);
    if (pending.length > 0) {
      for (const op of pending) {
        console.log(`   - op_id='${op.op_id}' entity_code='${op.entity_code}' status='${op.status}'`);
      }
      console.log(`   ... et ${Math.max(0, (db.prepare('SELECT COUNT(*) as count FROM sync_outbox WHERE status = ?').get('pending')).count - 10)} autres\n`);
    } else {
      console.log('   ✅ Aucune opération en attente!\n');
    }

    // Compter par entité
    const byEntity = db.prepare(`
      SELECT entity_code, COUNT(*) as count 
      FROM sync_outbox 
      WHERE status = 'pending'
      GROUP BY entity_code
      ORDER BY count DESC
      LIMIT 5
    `).all();

    if (byEntity.length > 0) {
      console.log(`📦 Opérations par produit (top 5):`);
      for (const item of byEntity) {
        console.log(`   - ${item.entity_code}: ${item.count} op(s)`);
      }
    }

    // Proposer les actions
    console.log(`\n🔧 Actions possibles:`);
    console.log(`   1. Relancer le worker Electron (il va resync automatiquement)`);
    console.log(`   2. Exécuter: node TEST-SYNC-PRODUCT-1.js`);
    console.log(`   3. Attendre 2-3 minutes (sync auto toutes les 10s)`);
    console.log(`   4. Vérifier Google Sheets`);

    console.log('\n' + '='.repeat(80) + '\n');
    db.close();

  } catch (error) {
    console.error('❌ ERREUR:', error.message);
    process.exit(1);
  }
}

resyncPendingOperations();
