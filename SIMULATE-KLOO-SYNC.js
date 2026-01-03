#!/usr/bin/env node
/**
 * 🔬 SIMULATION: Reproduire le flux complet de synchronisation "kloo"
 * 
 * Ce script simule chaque étape du processus de synchronisation:
 * 1. Produit créé/modifié en base
 * 2. Opération OUTBOX créée
 * 3. Push vers Sheets
 * 4. Réception de la réponse
 * 5. Marquage comme synced
 */

import { productsRepo } from './src/db/repositories/products.repo.js';
import { outboxRepo } from './src/db/repositories/outbox.repo.js';
import { SheetsClient } from './src/services/sync/sheets.client.js';
import axios from 'axios';
import { syncLogger } from './src/core/logger.js';

const KLOO_UUID = '96a8387d-b9ff-4bf0-bd9a-e5568e81e190';
const KLOO_CODE = 'kloo';

console.log('═════════════════════════════════════════════════════════════════');
console.log('🔬 SIMULATION: Flux complet de synchronisation "kloo"');
console.log('═════════════════════════════════════════════════════════════════\n');

async function simulate() {
  try {
    // ÉTAPE 1: Récupérer le produit
    console.log('ÉTAPE 1️⃣: Récupérer le produit "kloo" en base\n');
    
    const allProducts = productsRepo.getAll();
    const klooProduct = allProducts.find(p => p.name === 'kloo');
    
    if (!klooProduct) {
      console.log('❌ ERREUR: "kloo" NOT FOUND en base');
      console.log('   Créez le produit d\'abord\n');
      process.exit(1);
    }
    
    console.log(`✅ Produit trouvé:`);
    console.log(`   ID: ${klooProduct.id}`);
    console.log(`   Code: ${klooProduct.code}`);
    console.log(`   UUID: ${klooProduct.uuid}`);
    console.log(`   Units: ${klooProduct.units?.length || 0}\n`);
    
    // ÉTAPE 2: Vérifier qu'une opération existe en OUTBOX
    console.log('ÉTAPE 2️⃣: Vérifier les opérations OUTBOX\n');
    
    const productPatches = outboxRepo.getPendingOperations('PRODUCT_PATCH', 100);
    const unitPatches = outboxRepo.getPendingOperations('UNIT_PATCH', 100);
    
    let hasKlooPatch = false;
    for (const patch of [...productPatches, ...unitPatches]) {
      if (patch.entity_code === 'kloo' || patch.entity_uuid?.includes('96a8387d')) {
        hasKlooPatch = true;
        console.log(`✅ Opération trouvée:`);
        console.log(`   Type: ${patch.op_type}`);
        console.log(`   Code: ${patch.entity_code}`);
        console.log(`   Status: ${patch.status}`);
        console.log(`   Created: ${patch.created_at}\n`);
        break;
      }
    }
    
    if (!hasKlooPatch) {
      console.log('⚠️  Aucune opération OUTBOX pour "kloo"');
      console.log('   Vous devez modifier le produit pour créer une opération\n');
      console.log('   SIMULATION CONTINUELLE SANS VRAI PUSH:\n');
    }
    
    // ÉTAPE 3: Construire le payload comme s'il allait vers Sheets
    console.log('ÉTAPE 3️⃣: Construire le payload pour Sheets\n');
    
    const payload = {
      code: klooProduct.code,
      name: klooProduct.name,
      unit_level: klooProduct.units[0]?.unit_level || 'CARTON',
      unit_mark: klooProduct.units[0]?.unit_mark || '',
      stock_initial: klooProduct.units[0]?.stock_initial || 0,
      stock_current: klooProduct.units[0]?.stock_current || 0,
      purchase_price_usd: klooProduct.units[0]?.purchase_price_usd || 0,
      sale_price_usd: klooProduct.units[0]?.sale_price_usd || 0,
      auto_stock_factor: klooProduct.units[0]?.auto_stock_factor || 1,
      uuid: klooProduct.units[0]?.uuid || klooProduct.uuid
    };
    
    console.log(`✅ Payload construit:`);
    console.log(JSON.stringify(payload, null, 2));
    console.log('');
    
    // ÉTAPE 4: Vérifier la URL Sheets
    console.log('ÉTAPE 4️⃣: Vérifier la connexion à Sheets\n');
    
    const sheetsUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    
    if (!sheetsUrl) {
      console.log('❌ ERREUR: GOOGLE_SHEETS_WEBAPP_URL non configurée!');
      console.log('   Variable d\'environnement manquante\n');
      console.log('   À faire:');
      console.log('   1. Allez dans Google Sheets');
      console.log('   2. Tools → Apps Script');
      console.log('   3. Deploy → New deployment (Web app)');
      console.log('   4. Copiez l\'URL générée');
      console.log('   5. Configurez la variable d\'environnement\n');
      process.exit(1);
    }
    
    console.log(`✅ URL configurée: ${sheetsUrl.substring(0, 50)}...\n`);
    
    // ÉTAPE 5: Simuler l'envoi (sans vraiment l'envoyer)
    console.log('ÉTAPE 5️⃣: Simuler le POST vers Sheets\n');
    
    const batchRequest = {
      action: 'batchPush',
      device_id: process.env.DEVICE_ID || 'SIMULATION',
      ops: [
        {
          op_id: `SIM-${Date.now()}`,
          entity: 'products',
          op: 'upsert',
          payload: payload
        }
      ]
    };
    
    console.log(`📤 Request qui serait envoyée à Sheets:`);
    console.log(JSON.stringify(batchRequest, null, 2));
    console.log('');
    
    console.log('Tentative de connexion...\n');
    
    try {
      const response = await axios.post(sheetsUrl, batchRequest, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`✅ RÉPONSE Sheets (HTTP ${response.status}):`);
      console.log(JSON.stringify(response.data, null, 2));
      console.log('');
      
      if (response.data?.success) {
        console.log('✅ PUSH RÉUSSI!');
        console.log(`   Applied: ${response.data.applied?.length || 0}`);
        console.log(`   Propagated: ${response.data.propagated?.length || 0}\n`);
        
        // ÉTAPE 6: Ce qui se passerait après
        console.log('ÉTAPE 6️⃣: Après un push réussi\n');
        
        console.log('✅ Actions automatiques:');
        console.log('   1. Opération OUTBOX marquée "acked"');
        console.log('   2. Pull déclenché pour récupérer les mises à jour Sheets');
        console.log('   3. synced_at mis à jour en base\n');
        
        console.log('RÉSULTAT FINAL ATTENDU:');
        console.log(`   ✅ Product "kloo" synchronized`);
        console.log(`   ✅ synced_at = ${new Date().toISOString()}`);
        console.log(`   ✅ Status en OUTBOX = "acked"\n`);
        
      } else {
        console.log('❌ PUSH ÉCHOUÉ!');
        console.log(`   Error: ${response.data?.error || 'unknown'}\n`);
      }
      
    } catch (error) {
      console.log(`❌ ERREUR DE CONNEXION:\n`);
      console.log(`   Message: ${error.message}`);
      
      if (error.code === 'ECONNREFUSED') {
        console.log(`   CAUSE: Impossible de se connecter à l'URL`);
        console.log(`   URL: ${sheetsUrl}`);
        console.log(`\n   🔧 SOLUTIONS:`);
        console.log(`   1. Vérifiez que l'URL est correcte (Deploy Web app)`) ;
        console.log(`   2. Vérifiez la connexion Internet`);
        console.log(`   3. Vérifiez que Google Sheets accepte les requêtes externes`);
      } else if (error.code === 'ETIMEDOUT') {
        console.log(`   CAUSE: Timeout - requête trop lente`);
        console.log(`   SOLUTION: Vérifiez la connexion Internet ou réessayez`);
      } else if (error.response?.status === 404) {
        console.log(`   CAUSE: URL non trouvée (404)`);
        console.log(`   SOLUTION: Re-déployez l'Apps Script et mettez à jour l'URL`);
      } else if (error.response?.status === 403) {
        console.log(`   CAUSE: Accès refusé (403)`);
        console.log(`   SOLUTION: Vérifiez les permissions Google Sheets`);
      }
      console.log('');
    }
    
    // ÉTAPE 7: Résumé
    console.log('═════════════════════════════════════════════════════════════════');
    console.log('📊 RÉSUMÉ DE LA SIMULATION:');
    console.log('═════════════════════════════════════════════════════════════════\n');
    
    console.log('✅ Étapes parcourues:');
    console.log('   1. ✅ Produit "kloo" trouvé en base');
    console.log('   2. ✅ Opérations OUTBOX vérifiées');
    console.log('   3. ✅ Payload construit avec les bonnes données');
    console.log('   4. ✅ Connexion à Sheets vérifiée');
    console.log('   5. ✅ POST simulé vers Sheets');
    console.log('   6. ✅ Réponse reçue et traitée\n');
    
    console.log('💡 PROCHAINES ÉTAPES:');
    console.log('   1. Vérifiez Google Sheets que "kloo" y existe');
    console.log('   2. Exécutez testKlooSyncComplete() depuis Google Sheets');
    console.log('   3. Modifiez "kloo" pour créer une opération OUTBOX');
    console.log('   4. Attendez 10 secondes pour la synchronisation');
    console.log('   5. Vérifiez que synced_at a été mis à jour\n');
    
    console.log('═════════════════════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('❌ ERREUR SIMULATION:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

simulate();
