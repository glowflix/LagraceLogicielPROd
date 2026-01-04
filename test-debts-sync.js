#!/usr/bin/env node
/**
 * Script pour déclencher manuellement la synchronisation des dettes
 * Test rapide du flux: Sheets → Node.js → SQLite
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Imports
import { getDb, initDb } from './src/db/sqlite.js';
import { DebtsRepository } from './src/db/repositories/debts.repo.js';
import { logger } from './src/core/logger.js';

// Config Sheets
const SHEETS_ENDPOINT = 'https://script.google.com/macros/d/1uP2gq1cNNlDG8vqAVzz8sxGGy5fVz_x3VXEfJE-sQQVBhkjUkLPjAM5/usercache';

console.log('\n' + '='.repeat(70));
console.log('🔄 SYNCHRONISATION MANUELLE DES DETTES');
console.log('='.repeat(70) + '\n');

async function testSync() {
  try {
    // 1. Initialiser BD
    console.log('📊 [1] Initialisation de la BD SQLite...');
    initDb();
    const db = getDb();
    console.log('   ✅ BD ouverte');

    // 2. Vérifier dettes existantes
    console.log('\n📋 [2] Vérification des dettes existantes dans SQLite...');
    const debtsRepo = new DebtsRepository();
    const existingDebts = debtsRepo.findAll();
    console.log(`   📊 ${existingDebts.length} dette(s) existante(s)`);
    if (existingDebts.length > 0) {
      console.log(`   🔍 Exemples:`);
      existingDebts.slice(0, 3).forEach((d, i) => {
        console.log(`      [${i+1}] ${d.invoice_number || 'N/A'} - ${d.client_name || 'N/A'} (${d.total_fc} FC) - UUID: ${d.uuid ? '✅' : '❌'}`);
      });
    }

    // 3. Récupérer depuis Sheets
    console.log('\n📥 [3] Récupération des dettes depuis Google Sheets...');
    console.log(`   URL: ${SHEETS_ENDPOINT}?entity=debts&full=1`);
    
    const response = await fetch(`${SHEETS_ENDPOINT}?entity=debts&full=1&action=test`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`   ✅ Réponse reçue: success=${result.success}, count=${result.count || 0}`);
    
    const sheetsDebts = result.data || [];
    console.log(`   📊 ${sheetsDebts.length} dette(s) depuis Sheets`);
    
    if (sheetsDebts.length > 0) {
      console.log(`   🔍 Exemples:`);
      sheetsDebts.slice(0, 3).forEach((d, i) => {
        console.log(`      [${i+1}] ${d.invoice_number || 'N/A'} - ${d.client_name || 'N/A'} (${d.total_fc} FC) - UUID: ${d.uuid ? d.uuid.substring(0, 8) + '...' : 'NULL'}`);
      });
    } else {
      console.log('   ⚠️  ATTENTION: Aucune dette depuis Sheets!');
      console.log('   💡 Vérifier que la feuille "Dettes" contient des données');
      return;
    }

    // 4. Insérer dans SQLite
    console.log('\n💾 [4] Insertion des dettes dans SQLite...');
    let insertedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < sheetsDebts.length; i++) {
      const debtData = sheetsDebts[i];
      try {
        console.log(`   📝 [${i+1}/${sheetsDebts.length}] ${debtData.invoice_number || 'N/A'} - ${debtData.client_name || 'N/A'}`);
        
        // Vérifier si existe déjà
        const existing = debtsRepo.findByInvoice(debtData.invoice_number);
        
        // Upsert
        const result = debtsRepo.upsert({
          uuid: debtData.uuid,
          invoice_number: debtData.invoice_number,
          client_name: debtData.client_name || '',
          client_phone: debtData.client_phone || null,
          product_description: debtData.product_description || null,
          total_fc: debtData.total_fc || 0,
          paid_fc: debtData.paid_fc || 0,
          remaining_fc: debtData.remaining_fc !== undefined ? debtData.remaining_fc : ((debtData.total_fc || 0) - (debtData.paid_fc || 0)),
          total_usd: debtData.total_usd || 0,
          debt_fc_in_usd: debtData.debt_fc_in_usd || null,
          note: debtData.note || null,
          status: debtData.status || 'open',
          created_at: debtData.created_at || new Date().toISOString()
        });

        if (existing) {
          updatedCount++;
          console.log(`      ✅ MISE À JOUR: ID=${result.id}, UUID=${result.uuid ? result.uuid.substring(0, 8) : '(généré)'}...`);
        } else {
          insertedCount++;
          console.log(`      ✅ INSERTION: ID=${result.id}, UUID=${result.uuid ? result.uuid.substring(0, 8) : '(généré)'}...`);
        }
      } catch (err) {
        errorCount++;
        console.log(`      ❌ ERREUR: ${err.message}`);
      }
    }

    // 5. Résumé
    console.log('\n📊 [5] RÉSUMÉ DE LA SYNCHRONISATION:');
    console.log(`   ✅ INSÉRÉE(S): ${insertedCount}`);
    console.log(`   ✅ MIS(E) À JOUR: ${updatedCount}`);
    console.log(`   ❌ EN ERREUR: ${errorCount}`);
    
    if (errorCount === 0 && (insertedCount + updatedCount) > 0) {
      console.log('\n   🎉 SYNCHRONISATION RÉUSSIE!');
    } else if (errorCount > 0) {
      console.log('\n   ⚠️  CERTAINES DETTES N\'ONT PAS PU ÊTRE SYNCHRONISÉES');
    }

    // 6. Vérifier finales
    console.log('\n🔍 [6] Vérification finale dans SQLite...');
    const finalDebts = debtsRepo.findAll();
    console.log(`   📊 Total dettes dans SQLite: ${finalDebts.length}`);
    
    const withUuid = finalDebts.filter(d => d.uuid).length;
    const withoutUuid = finalDebts.length - withUuid;
    console.log(`   🔑 UUID: ${withUuid} avec, ${withoutUuid} sans (STABLE GENERATED)`);
    
  } catch (error) {
    console.error('\n❌ ERREUR:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack.substring(0, 500));
    }
    process.exit(1);
  }
}

// Exécuter
testSync().then(() => {
  console.log('\n' + '='.repeat(70) + '\n');
  process.exit(0);
}).catch(err => {
  console.error('\n❌ ERREUR NON GÉRÉE:', err);
  process.exit(1);
});
