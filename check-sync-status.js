#!/usr/bin/env node

/**
 * Diagnostic COMPLET du status sync des opérations STOCK_MOVE
 * Vérifie:
 * 1. Nombre d'opérations pending/sent/acked/error
 * 2. Opérations STOCK_MOVE et leur détail
 * 3. Stock moves synced vs non-synced
 * 4. Opérations concernant certains produits
 */

import { getDb } from './src/db/sqlite.js';
import { logger } from './src/core/logger.js';

console.log('\n' + '═'.repeat(70));
console.log('🔍 DIAGNOSTIC SYNC STATUS');
console.log('═'.repeat(70));

const db = getDb();

try {
  // 1. STATISTIQUES GÉNÉRALES sync_operations
  console.log('\n📊 SYNC_OPERATIONS (par status):');
  const statsByStatus = db.prepare(`
    SELECT status, op_type, COUNT(*) as count
    FROM sync_operations
    GROUP BY status, op_type
    ORDER BY status, op_type
  `).all();

  console.log('  Status\t\tType\t\tCount');
  console.log('  ─'.repeat(35));
  for (const row of statsByStatus) {
    console.log(`  ${row.status.padEnd(12)}\t${row.op_type.padEnd(15)}\t${row.count}`);
  }

  // 2. RÉSUMÉ GLOBAL
  console.log('\n📈 RÉSUMÉ GLOBAL:');
  const globalStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status='acked' THEN 1 ELSE 0 END) as acked,
      SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors
    FROM sync_operations
  `).get();

  console.log(`  Total: ${globalStats.total} opérations`);
  console.log(`  ├─ PENDING: ${globalStats.pending} (à envoyer)`);
  console.log(`  ├─ SENT: ${globalStats.sent} (envoyées, en attente d'ack)`);
  console.log(`  ├─ ACKED: ${globalStats.acked} (confirmées)`);
  console.log(`  └─ ERRORS: ${globalStats.errors} (erreurs)`);

  // 3. STOCK_MOVE en détail
  console.log('\n📦 STOCK_MOVE (dernières 20):');
  const stockMoves = db.prepare(`
    SELECT op_id, entity_code, status, created_at, payload_json
    FROM sync_operations
    WHERE op_type = 'STOCK_MOVE'
    ORDER BY created_at DESC
    LIMIT 20
  `).all();

  console.log(`  Trouvées: ${stockMoves.length} STOCK_MOVE`);
  for (const move of stockMoves.slice(0, 10)) {
    let payload = {};
    try {
      payload = JSON.parse(move.payload_json);
    } catch (e) {}
    const age = Math.round((Date.now() - new Date(move.created_at).getTime()) / 1000 / 60);
    console.log(`  ├─ op_id=${move.op_id.substring(0, 8)}... status=${move.status} age=${age}m product=${move.entity_code} stock_abs=${payload.stock_absolute}`);
  }

  // 4. STOCK_MOVES TABLE (journaux de mouvement)
  console.log('\n📋 STOCK_MOVES (synced status):');
  const moveStats = db.prepare(`
    SELECT synced, COUNT(*) as count
    FROM stock_moves
    GROUP BY synced
  `).all();

  for (const row of moveStats) {
    const syncedLabel = row.synced === 1 ? 'SYNCED' : 'PENDING';
    console.log(`  ${syncedLabel}: ${row.count}`);
  }

  // 5. RECENT STOCK_MOVES (dernières 24h)
  console.log('\n⏰ STOCK_MOVES RÉCENTS (dernières 24h):');
  const recentMoves = db.prepare(`
    SELECT 
      product_code, unit_level, unit_mark,
      COUNT(*) as count,
      SUM(CASE WHEN synced=0 THEN 1 ELSE 0 END) as pending_count,
      SUM(delta) as total_delta
    FROM stock_moves
    WHERE created_at > datetime('now', '-24 hours')
    GROUP BY product_code, unit_level, unit_mark
    ORDER BY created_at DESC
    LIMIT 15
  `).all();

  if (recentMoves.length === 0) {
    console.log('  Aucun mouvement récent');
  } else {
    for (const move of recentMoves) {
      console.log(`  ├─ ${move.product_code}/${move.unit_level}/${move.unit_mark || '∅'}: ${move.count} moves (${move.pending_count} pending, delta=${move.total_delta})`);
    }
  }

  // 6. OPÉRATIONS EN ERREUR
  console.log('\n❌ OPÉRATIONS EN ERREUR:');
  const errors = db.prepare(`
    SELECT op_id, entity_code, last_error, tries, created_at
    FROM sync_operations
    WHERE status = 'error'
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  if (errors.length === 0) {
    console.log('  Aucune erreur');
  } else {
    for (const err of errors) {
      const age = Math.round((Date.now() - new Date(err.created_at).getTime()) / 1000 / 60);
      console.log(`  ├─ ${err.entity_code} (tries=${err.tries}, age=${age}m)`);
      console.log(`  │  Error: ${err.last_error}`);
    }
  }

  // 7. OPÉRATIONS STUCK (pending > 1 heure)
  console.log('\n⏳ STUCK OPERATIONS (pending > 1h):');
  const stuck = db.prepare(`
    SELECT op_type, COUNT(*) as count
    FROM sync_operations
    WHERE status = 'pending'
      AND created_at < datetime('now', '-1 hour')
    GROUP BY op_type
  `).all();

  if (stuck.length === 0) {
    console.log('  Aucune opération stuck');
  } else {
    for (const row of stuck) {
      console.log(`  ├─ ${row.op_type}: ${row.count} opérations`);
    }
  }

  // 8. OPÉRATIONS RÉCENTES (dernière 5 minutes)
  console.log('\n✨ OPÉRATIONS RÉCENTES (< 5m):');
  const recent = db.prepare(`
    SELECT op_type, COUNT(*) as count, 
           SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending
    FROM sync_operations
    WHERE created_at > datetime('now', '-5 minutes')
    GROUP BY op_type
  `).all();

  if (recent.length === 0) {
    console.log('  Aucune opération récente');
  } else {
    for (const row of recent) {
      console.log(`  ├─ ${row.op_type}: ${row.count} opérations (${row.pending} pending)`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('✅ Diagnostic terminé');
  console.log('═'.repeat(70) + '\n');

} catch (error) {
  console.error('❌ Erreur:', error);
  process.exit(1);
}
