/**
 * TEST-SYNC-PRODUCT-1.js
 * 
 * Script de test pour:
 * 1. Vérifier la connexion à Google Apps Script
 * 2. Afficher les opérations en attente pour le produit '1'
 * 3. Créer une opération de push pour le produit '1'
 * 4. Envoyer manuellement à Google Sheets
 */

import { getDb } from './src/db/sqlite.js';
import { syncLogger } from './src/core/logger.js';
import { httpClient } from './src/core/http.js';
import { productsRepo } from './src/db/repositories/products.repo.js';

async function testSyncProduct1() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST SYNC PRODUCT CODE "1"');
  console.log('='.repeat(80) + '\n');

  try {
    // 1. Vérifier la connexion à Google Apps Script
    console.log('📡 ÉTAPE 1: Vérifier connexion à Google Apps Script');
    const sheetsUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    if (!sheetsUrl) {
      console.error('❌ ERREUR: GOOGLE_SHEETS_WEBAPP_URL non configurée');
      process.exit(1);
    }
    console.log(`✅ URL trouvée: ${sheetsUrl.substring(0, 60)}...`);

    // 2. Chercher le produit '1' en base
    console.log('\n📦 ÉTAPE 2: Chercher produit code "1" en base');
    const product = productsRepo.findByCode('1');
    
    if (!product) {
      console.error('❌ Produit code "1" non trouvé!');
      process.exit(1);
    }

    console.log(`✅ Produit trouvé:`);
    console.log(`   Code: ${product.code}`);
    console.log(`   Name: '${product.name}'`);
    console.log(`   UUID: ${product.uuid}`);
    console.log(`   Units: ${product.units ? product.units.length : 0}`);

    if (product.units && product.units.length > 0) {
      for (const unit of product.units) {
        console.log(`     - ${unit.unit_level} (UUID: ${unit.uuid})`);
      }
    }

    // 3. Construire le payload de synchronisation
    console.log('\n📤 ÉTAPE 3: Construire payload push');
    
    const units = product.units && product.units.length > 0 
      ? product.units 
      : [{
          unit_level: 'CARTON',
          unit_mark: '',
          uuid: 'AUTO-GENERATED'
        }];

    const ops = units.map(unit => ({
      op_id: `test-${Date.now()}-${Math.random()}`,
      entity: 'products',
      op: 'upsert',
      payload: {
        code: product.code,
        name: product.name,  // ← IMPORTANT: Le nom DOIT être là
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark || '',
        unit_uuid: unit.uuid,
        uuid: product.uuid,
        is_active: 1
      }
    }));

    console.log(`✅ Payload construit:`);
    console.log(`   Operations: ${ops.length}`);
    console.log(`   Op[0]: ${JSON.stringify(ops[0], null, 2)}`);

    // 4. Envoyer à Google Apps Script
    console.log('\n📡 ÉTAPE 4: Envoyer à Google Apps Script');
    
    const body = {
      action: 'batchPush',
      ops: ops
    };

    console.log('   📨 Envoi du payload...');
    const response = await httpClient.post(sheetsUrl, body);
    const result = response.data || {};

    console.log(`✅ Réponse reçue:`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Acked count: ${result.acked_count || 0}`);
    console.log(`   Error: ${result.error || 'none'}`);

    if (result.success) {
      console.log('\n✅ SYNC RÉUSSIE!');
      console.log('   Le produit code "1" devrait avoir son nom dans Google Sheets');
    } else {
      console.log('\n❌ SYNC ÉCHOUÉE!');
      console.log('   Vérifier les logs de Code.gs pour plus de détails');
    }

    // 5. Afficher les stats
    console.log('\n📊 ÉTAPE 5: Vérifier les opérations en attente');
    
    const db = getDb();
    const pending = db.prepare(`
      SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'
    `).get();

    console.log(`✅ Opérations en attente: ${pending.count}`);

    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ ERREUR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Exécuter le test
testSyncProduct1().catch(err => {
  console.error(err);
  process.exit(1);
});
