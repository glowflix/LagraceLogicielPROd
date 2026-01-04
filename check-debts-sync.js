#!/usr/bin/env node
/**
 * Diagnostic Dettes Sync - Vérifie tous les problèmes potentiels
 * Exécute les 7 checks de l'utilisateur
 */

import { getDb } from './src/db/sqlite.js';
import { logger } from './src/core/logger.js';

const db = getDb();

console.log('\n' + '='.repeat(80));
console.log('🔍 DIAGNOSTIC COMPLET - SYNCHRONISATION DETTES');
console.log('='.repeat(80) + '\n');

// VERIFICATI A: Détecter doublons par invoice_number
console.log('\n📊 CHECK A: Doublons par invoice_number');
console.log('─'.repeat(60));
try {
  const duplicates = db.prepare(`
    SELECT invoice_number, COUNT(*) AS c
    FROM debts
    WHERE invoice_number IS NOT NULL AND invoice_number != ''
    GROUP BY invoice_number
    HAVING c > 1
    ORDER BY c DESC
  `).all();

  if (duplicates.length === 0) {
    console.log('✅ Aucun doublon par invoice_number détecté');
  } else {
    console.log(`⚠️ ${duplicates.length} facture(s) avec doublons:`);
    duplicates.forEach(d => {
      console.log(`   - Invoice "${d.invoice_number}": ${d.c} occurrences`);
    });
  }
} catch (e) {
  console.log('❌ Erreur query doublons:', e.message);
}

// VERIFICATION B: Fausses valeurs null
console.log('\n📊 CHECK B: Fausses valeurs null (texte "null", "undefined", etc)');
console.log('─'.repeat(60));
try {
  const fakeNulls = db.prepare(`
    SELECT id, invoice_number, uuid, client_name
    FROM debts
    WHERE 
      uuid IN ('null','NULL','undefined','UNDEFINED','NaN','N/A')
      OR invoice_number IN ('null','NULL','undefined','UNDEFINED','NaN','N/A')
    LIMIT 10
  `).all();

  if (fakeNulls.length === 0) {
    console.log('✅ Aucune fausse valeur null détectée');
  } else {
    console.log(`⚠️ ${fakeNulls.length} ligne(s) avec fausses valeurs null:`);
    fakeNulls.forEach(row => {
      console.log(`   ID=${row.id}: uuid="${row.uuid}", invoice="${row.invoice_number}", client="${row.client_name}"`);
    });
  }
} catch (e) {
  console.log('❌ Erreur query fausses nulls:', e.message);
}

// VERIFICATION C: Invoice_number NULL
console.log('\n📊 CHECK C: Dettes avec invoice_number NULL');
console.log('─'.repeat(60));
try {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN invoice_number IS NULL THEN 1 ELSE 0 END) AS invoice_null,
      SUM(CASE WHEN invoice_number = '' THEN 1 ELSE 0 END) AS invoice_empty,
      SUM(CASE WHEN uuid IS NULL THEN 1 ELSE 0 END) AS uuid_null
    FROM debts
  `).get();

  console.log(`Total dettes: ${stats.total}`);
  console.log(`  - invoice_number NULL: ${stats.invoice_null} (${((stats.invoice_null/stats.total)*100).toFixed(1)}%)`);
  console.log(`  - invoice_number empty: ${stats.invoice_empty}`);
  console.log(`  - uuid NULL: ${stats.uuid_null}`);
  
  if (stats.invoice_null > stats.total * 0.1) {
    console.log('⚠️ ALERTE: >10% des dettes ont invoice_number NULL!');
  } else if (stats.invoice_null > 0) {
    console.log('⚠️ Attention: Certaines dettes sans invoice_number');
  } else {
    console.log('✅ Toutes les dettes ont un invoice_number');
  }
} catch (e) {
  console.log('❌ Erreur query stats:', e.message);
}

// VERIFICATION D: Foreign Key Violations
console.log('\n📊 CHECK D: Violations de clés étrangères');
console.log('─'.repeat(60));
try {
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
  
  if (fkViolations.length === 0) {
    console.log('✅ Aucune violation FK détectée');
  } else {
    console.log(`⚠️ ${fkViolations.length} violation(s) FK:`);
    fkViolations.forEach(v => {
      console.log(`   - Table ${v.table}, col ${v.column}, FK ${v.fkid}: value=${v.parent}`);
    });
  }
} catch (e) {
  console.log('❌ Erreur PRAGMA foreign_key_check:', e.message);
}

// VERIFICATION E: Index unique
console.log('\n📊 CHECK E: Index unique sur debts');
console.log('─'.repeat(60));
try {
  const indexes = db.prepare("PRAGMA index_list('debts')").all();
  const uniqueIdx = indexes.find(i => i.name === 'idx_debts_invoice_unique');
  
  if (uniqueIdx) {
    console.log('✅ Index idx_debts_invoice_unique existe');
    console.log(`   - unique: ${uniqueIdx.unique}, seq_in_index: ${uniqueIdx.seqno}`);
  } else {
    console.log('❌ Index idx_debts_invoice_unique MANQUANT!');
    console.log('   Indexes présents:');
    indexes.forEach(i => {
      console.log(`     - ${i.name} (unique=${i.unique})`);
    });
  }
} catch (e) {
  console.log('❌ Erreur PRAGMA index_list:', e.message);
}

// VERIFICATION F: DB Location
console.log('\n📊 CHECK F: Localisation de la base de données');
console.log('─'.repeat(60));
try {
  const dbList = db.prepare('PRAGMA database_list').all();
  dbList.forEach(d => {
    console.log(`   - ${d.name}: ${d.file}`);
  });
} catch (e) {
  console.log('❌ Erreur PRAGMA database_list:', e.message);
}

// VERIFICATION G: Sync_operations status
console.log('\n📊 CHECK G: Opérations sync_operations pour DEBT');
console.log('─'.repeat(60));
try {
  const syncOps = db.prepare(`
    SELECT 
      op_type,
      status,
      COUNT(*) AS count
    FROM sync_operations
    WHERE op_type = 'DEBT'
    GROUP BY status
  `).all();

  if (syncOps.length === 0) {
    console.log('⚠️ Aucune opération DEBT dans sync_operations!');
    console.log('   → Les dettes ne sont pas préparées pour le PUSH vers Sheets');
  } else {
    console.log('Opérations DEBT par statut:');
    syncOps.forEach(op => {
      console.log(`   - ${op.status.padEnd(10)}: ${op.count}`);
    });
  }
  
  // Montrer un exemple d'opération DEBT pending
  const example = db.prepare(`
    SELECT op_id, entity_code, status, created_at
    FROM sync_operations
    WHERE op_type = 'DEBT' AND status = 'pending'
    LIMIT 1
  `).get();
  
  if (example) {
    console.log(`\n   Exemple opération pending:`);
    console.log(`   - op_id: ${example.op_id}`);
    console.log(`   - entity_code: ${example.entity_code}`);
    console.log(`   - created_at: ${example.created_at}`);
  }
} catch (e) {
  console.log('❌ Erreur query sync_operations:', e.message);
}

// SAMPLES
console.log('\n📊 SAMPLES: Affichage des 3 premières dettes');
console.log('─'.repeat(60));
try {
  const samples = db.prepare(`
    SELECT 
      id, uuid, invoice_number, client_name, 
      total_fc, paid_fc, remaining_fc, status, created_at
    FROM debts
    ORDER BY created_at DESC
    LIMIT 3
  `).all();

  samples.forEach((d, i) => {
    console.log(`\n[${i+1}] ID=${d.id}`);
    console.log(`    invoice: "${d.invoice_number}"`);
    console.log(`    uuid: ${d.uuid}`);
    console.log(`    client: "${d.client_name}"`);
    console.log(`    total_fc=${d.total_fc}, paid_fc=${d.paid_fc}, remaining=${d.remaining_fc}`);
    console.log(`    status: ${d.status} | created: ${d.created_at}`);
  });
} catch (e) {
  console.log('❌ Erreur query samples:', e.message);
}

console.log('\n' + '='.repeat(80));
console.log('✅ DIAGNOSTIC COMPLET');
console.log('='.repeat(80) + '\n');
