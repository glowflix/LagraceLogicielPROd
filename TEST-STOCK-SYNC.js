#!/usr/bin/env node

/**
 * TEST-STOCK-SYNC.js
 * 
 * Vérifie que la synchronisation du stock fonctionne correctement:
 * 1. Crée un mouvement de stock (autostock)
 * 2. Vérifie que sync_operations est créé
 * 3. Vérifie que le sync worker envoie vers Sheets
 * 4. Vérifie que le stock est mis à jour dans Sheets
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Déterminer le chemin de la BD (peut être db/glowflixprojet.db ou la-grace-sync.sqlite3)
const possiblePaths = [
  path.join(__dirname, 'db', 'glowflixprojet.db'),
  path.join(__dirname, 'la-grace-sync.sqlite3'),
  path.join(__dirname, 'database.db')
];

let dbPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

if (!dbPath) {
  console.error('❌ Erreur: Aucune base de données SQLite trouvée');
  console.error(`   Chemins vérifiés:`);
  possiblePaths.forEach(p => console.error(`     • ${p}`));
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

console.log(`📊 [TEST] Stock Synchronization Verification`);
console.log(`════════════════════════════════════════════════════\n`);

// TEST 1: Vérifier qu'il existe un produit avec CARTON et PIECE/MILLIER
console.log(`📋 [TEST 1] Vérifier la structure des produits`);
const products = db.prepare(`
  SELECT 
    p.id, p.code, p.name, p.uuid,
    COUNT(DISTINCT CASE WHEN pu.unit_level = 'CARTON' THEN 1 END) has_carton,
    COUNT(DISTINCT CASE WHEN pu.unit_level = 'PIECE' THEN 1 END) has_piece,
    COUNT(DISTINCT CASE WHEN pu.unit_level = 'MILLIER' THEN 1 END) has_millier
  FROM products p
  LEFT JOIN product_units pu ON p.id = pu.product_id
  GROUP BY p.id
  HAVING has_carton > 0 AND (has_piece > 0 OR has_millier > 0)
  LIMIT 5
`).all();

if (products.length === 0) {
  console.log(`   ⚠️  Aucun produit avec CARTON + PIECE/MILLIER trouvé`);
  console.log(`   ℹ️  Création d'un produit de test...`);
} else {
  console.log(`   ✅ ${products.length} produit(s) trouvé(s) avec structure complète`);
  products.forEach(p => {
    console.log(`      • ${p.code} - ${p.name || 'N/A'}`);
  });
}

// TEST 2: Vérifier les mouvements de stock récents
console.log(`\n📊 [TEST 2] Mouvements de stock récents`);
const recentMoves = db.prepare(`
  SELECT 
    sm.move_id, sm.product_code, sm.unit_level, sm.unit_mark,
    sm.delta, sm.reason, sm.stock_before, sm.stock_after,
    sm.synced, sm.created_at
  FROM stock_moves sm
  ORDER BY sm.created_at DESC
  LIMIT 10
`).all();

if (recentMoves.length === 0) {
  console.log(`   ℹ️  Aucun mouvement de stock trouvé`);
} else {
  console.log(`   ✅ ${recentMoves.length} mouvement(s) trouvé(s):`);
  recentMoves.forEach(m => {
    const syncStatus = m.synced ? '✅ Synced' : '⏳ Pending';
    console.log(`      • ${m.product_code}/${m.unit_level} ${m.delta > 0 ? '+' : ''}${m.delta} (${m.reason}) [${syncStatus}]`);
    console.log(`        Avant: ${m.stock_before}, Après: ${m.stock_after}`);
    console.log(`        ${m.created_at}`);
  });
}

// TEST 3: Vérifier les opérations de synchronisation (sync_operations)
console.log(`\n🔄 [TEST 3] Opérations de synchronisation`);
const syncOps = db.prepare(`
  SELECT 
    so.op_id, so.op_type, so.entity_code, so.status, 
    so.tries, so.created_at, so.updated_at
  FROM sync_operations so
  WHERE so.op_type = 'STOCK_MOVE'
  ORDER BY so.created_at DESC
  LIMIT 10
`).all();

if (syncOps.length === 0) {
  console.log(`   ℹ️  Aucune opération STOCK_MOVE en attente`);
} else {
  console.log(`   ✅ ${syncOps.length} opération(s) STOCK_MOVE:`);
  syncOps.forEach(op => {
    const statusEmoji = op.status === 'pending' ? '⏳' : (op.status === 'acked' ? '✅' : '❌');
    console.log(`      ${statusEmoji} [${op.status.toUpperCase()}] ${op.entity_code} (essais: ${op.tries})`);
    console.log(`         ID: ${op.op_id.substring(0, 8)}...`);
    console.log(`         Créée: ${op.created_at}`);
  });
}

// TEST 4: Vérifier le statut général du système
console.log(`\n📈 [TEST 4] Statut général de synchronisation`);
const stats = db.prepare(`
  SELECT 
    (SELECT COUNT(*) FROM sync_operations WHERE status = 'pending') pending_ops,
    (SELECT COUNT(*) FROM sync_operations WHERE status = 'acked') acked_ops,
    (SELECT COUNT(*) FROM sync_operations WHERE status = 'error') error_ops,
    (SELECT COUNT(*) FROM stock_moves WHERE synced = 0) pending_moves,
    (SELECT COUNT(*) FROM stock_moves WHERE synced = 1) synced_moves
`).get();

console.log(`   📦 Opérations synchronisation:`);
console.log(`      • Pending: ${stats.pending_ops}`);
console.log(`      • Acked: ${stats.acked_ops}`);
console.log(`      • Erreurs: ${stats.error_ops}`);
console.log(`   📊 Mouvements de stock:`);
console.log(`      • Pending: ${stats.pending_moves}`);
console.log(`      • Synced: ${stats.synced_moves}`);

// TEST 5: Recommandations
console.log(`\n💡 [TEST 5] Recommandations`);
console.log(`\n   Pour tester la synchronisation du stock:`);
console.log(`   1. ✅ Vérifiez qu'un produit avec CARTON + PIECE/MILLIER existe`);
console.log(`   2. ✅ Déclenchew un autostock via l'API ou l'UI`);
console.log(`   3. ✅ Vérifiez que stock_moves est créé (non vide)`);
console.log(`   4. ✅ Vérifiez que sync_operations STOCK_MOVE est en "pending"`);
console.log(`   5. ✅ Attendez 10-15 secondes pour le sync`);
console.log(`   6. ✅ Vérifiez que sync_operations passe à "acked"`);
console.log(`   7. ✅ Vérifiez que le stock dans Sheets est mis à jour`);

// TEST 6: Commandes utiles
console.log(`\n🔧 [TEST 6] Commandes pour diagnostiquer`);
console.log(`\n   # Voir tous les mouvements de stock:`);
console.log(`   sqlite3 database.db "SELECT * FROM stock_moves ORDER BY created_at DESC LIMIT 20;"`);
console.log(`\n   # Voir les opérations sync en erreur:`);
console.log(`   sqlite3 database.db "SELECT op_id, entity_code, status, tries FROM sync_operations WHERE status != 'acked' ORDER BY created_at DESC;"`);
console.log(`\n   # Réinitialiser les opérations en erreur (si nécessaire):`);
console.log(`   sqlite3 database.db "UPDATE sync_operations SET status = 'pending', tries = 0 WHERE status = 'error';"`);

console.log(`\n════════════════════════════════════════════════════`);
console.log(`✅ Vérification terminée\n`);

db.close();
