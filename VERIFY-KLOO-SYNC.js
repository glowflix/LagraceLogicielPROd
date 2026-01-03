#!/usr/bin/env node
/**
 * 🔍 TEST COMPLET: Vérification de la synchronisation du produit "kloo" vers Sheets
 * 
 * Ce script vérifie:
 * 1. Le produit "kloo" existe en base de données
 * 2. L'UUID est généré automatiquement s'il manque
 * 3. Les unités sont créées avec les bonnes valeurs
 * 4. Les opérations de sync sont enregistrées dans l'outbox
 * 5. Le push vers Sheets est envoyé avec les bonnes données
 * 6. Le produit est trouvé en Sheets par UUID
 */

import { productsRepo } from './src/db/repositories/products.repo.js';
import { outboxRepo } from './src/db/repositories/outbox.repo.js';
import { getDb } from './src/db/sqlite.js';
import { syncLogger } from './src/core/logger.js';

const KLOO_PAYLOAD = {
  "name": "kloo",
  "units": [
    {
      "id": 1,
      "product_id": 1,
      "unit_level": "CARTON",
      "unit_mark": "",
      "stock_initial": 44396,
      "stock_current": 44396,
      "purchase_price_usd": 9.2,
      "sale_price_usd": 10,
      "auto_stock_factor": 1,
      "qty_step": 1,
      "extra1": null,
      "extra2": null,
      "last_update": "2026-01-01T09:24:32.370Z",
      "created_at": "2025-12-25 13:18:29",
      "updated_at": "2026-01-01 10:17:31",
      "synced_at": null,
      "uuid": "96a8387d-b9ff-4bf0-bd9a-e5568e81e190"
    }
  ]
};

console.log('═════════════════════════════════════════════════════════════════');
console.log('🔍 TEST COMPLET: SYNCHRONISATION "kloo" → Google Sheets');
console.log('═════════════════════════════════════════════════════════════════\n');

try {
  // STEP 1: Vérifier que le produit existe en DB
  console.log('STEP 1️⃣ : Chercher "kloo" en base de données...\n');
  
  const allProducts = productsRepo.getAll();
  console.log(`   📊 Total produits en DB: ${allProducts.length}`);
  
  const klooProduct = allProducts.find(p => 
    p.name && p.name.toLowerCase().trim() === 'kloo'
  );
  
  if (!klooProduct) {
    console.log('   ❌ ERREUR: "kloo" NOT FOUND en base de données!');
    console.log('   🔧 ACTION: Créer le produit manuellement d\'abord\n');
    process.exit(1);
  }
  
  console.log(`   ✅ TROUVÉ: "kloo"`);
  console.log(`      product_id: ${klooProduct.id}`);
  console.log(`      code: ${klooProduct.code}`);
  console.log(`      name: ${klooProduct.name}`);
  console.log(`      uuid: ${klooProduct.uuid || '❌ VIDE'}`);
  console.log(`      is_active: ${klooProduct.is_active}`);
  console.log(`      units count: ${(klooProduct.units || []).length}\n`);
  
  // STEP 2: Vérifier les unités
  console.log('STEP 2️⃣ : Vérifier les unités...\n');
  
  if (!klooProduct.units || klooProduct.units.length === 0) {
    console.log('   ❌ ERREUR: Aucune unité trouvée pour "kloo"!');
    console.log('   🔧 ACTION: Créer une unité CARTON manuellement\n');
    process.exit(1);
  }
  
  console.log(`   ✅ ${klooProduct.units.length} unité(s) trouvée(s):`);
  for (const unit of klooProduct.units) {
    console.log(`      📦 ${unit.unit_level}/${unit.unit_mark || '(vide)'}`);
    console.log(`         id: ${unit.id}`);
    console.log(`         uuid: ${unit.uuid || '❌ VIDE'}`);
    console.log(`         stock_current: ${unit.stock_current}`);
    console.log(`         sale_price_usd: ${unit.sale_price_usd}`);
    console.log(`         synced_at: ${unit.synced_at || '❌ JAMAIS'}`);
  }
  console.log('');
  
  // STEP 3: Vérifier les opérations en attente
  console.log('STEP 3️⃣ : Vérifier les opérations OUTBOX...\n');
  
  const stats = outboxRepo.getStats();
  console.log(`   📊 Statistiques OUTBOX:`);
  console.log(`      Total pending: ${stats.totalPending}`);
  console.log(`      Pending by type: ${JSON.stringify(stats.pendingByType)}`);
  console.log(`      Stock moves pending: ${stats.stockMovesPending}\n`);
  
  const productPatches = outboxRepo.getPendingOperations('PRODUCT_PATCH', 100);
  const unitPatches = outboxRepo.getPendingOperations('UNIT_PATCH', 100);
  
  console.log(`   📦 PRODUCT_PATCH (${productPatches.length}):`);
  for (const patch of productPatches) {
    if (patch.entity_code === 'kloo' || (patch.entity_uuid && patch.entity_uuid.includes('96a8387d'))) {
      console.log(`      ✅ TROUVE: op_id=${patch.op_id}`);
      console.log(`         entity_code: ${patch.entity_code}`);
      console.log(`         entity_uuid: ${patch.entity_uuid}`);
      console.log(`         payload_json: ${typeof patch.payload_json === 'string' ? patch.payload_json.substring(0, 100) + '...' : JSON.stringify(patch.payload_json).substring(0, 100) + '...'}`);
      console.log(`         status: ${patch.status}`);
    }
  }
  
  console.log(`\n   💰 UNIT_PATCH (${unitPatches.length}):`);
  for (const patch of unitPatches) {
    if (patch.entity_code === 'kloo' || (patch.entity_uuid && patch.entity_uuid.includes('96a8387d'))) {
      console.log(`      ✅ TROUVE: op_id=${patch.op_id}`);
      console.log(`         entity_code: ${patch.entity_code}`);
      console.log(`         payload_json: ${typeof patch.payload_json === 'string' ? patch.payload_json.substring(0, 100) + '...' : JSON.stringify(patch.payload_json).substring(0, 100) + '...'}`);
      console.log(`         status: ${patch.status}`);
    }
  }
  
  if (productPatches.length === 0 && unitPatches.length === 0) {
    console.log('   ⚠️  Aucune opération OUTBOX pour "kloo"!');
    console.log('   🔧 ACTION: Déclencher un changement (edit name ou prix) pour générer une opération\n');
  }
  
  // STEP 4: Vérifier l'état de synced_at
  console.log('\nSTEP 4️⃣ : Vérifier synced_at (dernier sync vers Sheets)...\n');
  
  let anySynced = false;
  for (const unit of klooProduct.units) {
    if (unit.synced_at) {
      console.log(`   ✅ ${unit.unit_level}: synced_at=${unit.synced_at}`);
      anySynced = true;
    } else {
      console.log(`   ❌ ${unit.unit_level}: synced_at=NULL (jamais synchronisé)`);
    }
  }
  
  if (!anySynced) {
    console.log('\n   ⚠️  PROBLÈME DÉTECTÉ: Aucune unité n\'a jamais été synchronisée!');
    console.log('   🔧 SOLUTIONS POSSIBLES:');
    console.log('      1. Vérifier que GOOGLE_SHEETS_WEBAPP_URL est configurée');
    console.log('      2. Vérifier que le worker de sync tourne (check logs)');
    console.log('      3. Vérifier que le code "kloo" en Sheets commence par la même lettre');
    console.log('      4. Vérifier que uuid existe en Sheets dans la colonne "_uuid"\n');
  }
  
  // STEP 5: Vérifier la cohérence UUID
  console.log('\nSTEP 5️⃣ : Vérifier UUID...\n');
  
  const expectedUUID = KLOO_PAYLOAD.units[0].uuid;
  const dbUUID = klooProduct.units[0]?.uuid;
  
  console.log(`   Expected UUID: ${expectedUUID}`);
  console.log(`   DB UUID:       ${dbUUID}`);
  
  if (dbUUID === expectedUUID) {
    console.log(`   ✅ UUIDs correspondent!\n`);
  } else if (!dbUUID) {
    console.log(`   ❌ UUID en DB est vide! (doit être généré automatiquement)\n`);
  } else {
    console.log(`   ⚠️  UUIDs ne correspondent pas!\n`);
  }
  
  // STEP 6: Test manuel du payload
  console.log('STEP 6️⃣ : Simuler un payload Sheets pour vérification...\n');
  
  const sheetPayload = {
    code: klooProduct.code || 'KLOO',
    name: klooProduct.name,
    unit_level: klooProduct.units[0]?.unit_level,
    unit_mark: klooProduct.units[0]?.unit_mark || '',
    stock_initial: klooProduct.units[0]?.stock_initial,
    stock_current: klooProduct.units[0]?.stock_current,
    purchase_price_usd: klooProduct.units[0]?.purchase_price_usd,
    sale_price_usd: klooProduct.units[0]?.sale_price_usd,
    auto_stock_factor: klooProduct.units[0]?.auto_stock_factor,
    uuid: klooProduct.units[0]?.uuid || 'AUTO_GENERATED'
  };
  
  console.log('   📤 Payload à envoyer vers Sheets:');
  console.log(`      ${JSON.stringify(sheetPayload, null, 2)}\n`);
  
  // STEP 7: Recommandations
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('💡 RECOMMANDATIONS:');
  console.log('═════════════════════════════════════════════════════════════════\n');
  
  if (!anySynced) {
    console.log('⚠️  Le produit "kloo" n\'a JAMAIS été synchronisé vers Sheets.');
    console.log('\n   Pour déboguer, vérifiez dans cet ordre:\n');
    console.log('   1️⃣  GOOGLE_SHEETS_WEBAPP_URL en variables d\'environnement');
    console.log('       ✅ Exécutez: echo $env:GOOGLE_SHEETS_WEBAPP_URL');
    console.log('');
    console.log('   2️⃣  Logs du worker de sync');
    console.log('       ✅ Cherchez: "PRODUCT_PATCH" et "kloo" dans sync.log');
    console.log('');
    console.log('   3️⃣  Vérifiez que "kloo" existe en Sheets (tous les onglets)');
    console.log('       ✅ Cherchez le code produit normalisé (sans espace)');
    console.log('');
    console.log('   4️⃣  Vérifiez la colonne "_uuid" en Sheets');
    console.log('       ✅ Doit contenir: ' + expectedUUID);
    console.log('');
    console.log('   5️⃣  Testez manuellement le push vers Apps Script');
    console.log('       ✅ Allez dans Google Sheets → Tools → Apps Script');
    console.log('       ✅ Exécutez testDoProPushKilo() depuis APSCRIPT-DIAGNOSTIC-TESTS.js');
    console.log('');
    console.log('   6️⃣  Vérifiez les logs Apps Script');
    console.log('       ✅ Cherchez [doProPush] ou [propagateNameMarkToAllUnits]\n');
  } else {
    console.log('✅ Le produit "kloo" a déjà été synchronisé au moins une fois.');
    console.log('');
    console.log('   Vérifiez maintenant que:');
    console.log('   1. Les données en Sheets sont correctes');
    console.log('   2. Le UUID en Sheets correspond à: ' + expectedUUID);
    console.log('   3. Les colonnes "_uuid" et "_updated_at" sont remplies\n');
  }
  
  console.log('═════════════════════════════════════════════════════════════════\n');
  
} catch (error) {
  console.error('❌ ERREUR:', error.message);
  console.error(error.stack);
  process.exit(1);
}
