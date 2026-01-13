/**
 * TEST APPSCRIPT - Vérifier le format de réponse de handleBatchPush()
 * 
 * INSTRUCTIONS:
 * 1. Ouvre Google Sheets (ton projet existant)
 * 2. Clique sur "Extensions" > "Apps Script"
 * 3. Crée un nouvel onglet ou colle ce code
 * 4. Lance la fonction testBatchPush() depuis le menu Run
 * 5. Regarde les logs avec View > Execution log
 */

/**
 * TEST 1: Vérifier le format de réponse avec des opérations valides
 */
function testBatchPushValid() {
  Logger.log('=== TEST: BATCH PUSH VALIDE ===');
  
  const ops = [
    {
      entity: 'products',
      entity_id: 'PROD-001',
      op: 'upsert',
      op_id: 'op-' + Date.now() + '-1',
      payload: {
        code: 'TEST-001',
        name: 'Test Product',
        unit_level: 'MILLIERS',  // ✅ Valide
        unit_value: 50
      }
    },
    {
      entity: 'stock_move',
      entity_id: 'MOV-001',
      op: 'create',
      op_id: 'op-' + Date.now() + '-2',
      payload: {
        product_code: 'TEST-001',
        qty: 10,
        unit_level: 'CARTON',
        stock_absolute: 100
      }
    }
  ];
  
  // Simule l'appel à handleBatchPush
  const response = handleBatchPush(ops);
  
  Logger.log('📤 RÉPONSE BRUTE:');
  Logger.log(JSON.stringify(response, null, 2));
  
  Logger.log('📋 VÉRIFICATION:');
  Logger.log('  success: ' + response.success);
  Logger.log('  applied.length: ' + (response.applied ? response.applied.length : 'MISSING'));
  Logger.log('  conflicts.length: ' + (response.conflicts ? response.conflicts.length : 'MISSING'));
  Logger.log('  failed.length: ' + (response.failed ? response.failed.length : 'MISSING'));
  Logger.log('  stats: ' + JSON.stringify(response.stats));
  
  return response;
}

/**
 * TEST 2: Avec erreur de validation (MILLIER au lieu de MILLIERS)
 */
function testBatchPushInvalid() {
  Logger.log('=== TEST: BATCH PUSH INVALIDE (mauvaise unit_level) ===');
  
  const ops = [
    {
      entity: 'products',
      entity_id: 'PROD-002',
      op: 'upsert',
      op_id: 'op-' + Date.now() + '-3',
      payload: {
        code: 'TEST-002',
        name: 'Test Product Bad',
        unit_level: 'MILLIER',  // ❌ FAUX (devrait être MILLIERS)
        unit_value: 50
      }
    }
  ];
  
  const response = handleBatchPush(ops);
  
  Logger.log('📤 RÉPONSE BRUTE:');
  Logger.log(JSON.stringify(response, null, 2));
  
  Logger.log('📋 VÉRIFICATION:');
  Logger.log('  success: ' + response.success);
  Logger.log('  applied.length: ' + (response.applied ? response.applied.length : 'MISSING'));
  Logger.log('  conflicts.length: ' + (response.conflicts ? response.conflicts.length : 'MISSING'));
  Logger.log('  failed.length: ' + (response.failed ? response.failed.length : 'MISSING'));
  Logger.log('  stats: ' + JSON.stringify(response.stats));
  
  return response;
}

/**
 * TEST 3: Vérifier que tous les returns ont le bon format
 */
function testAllReturns() {
  Logger.log('=== TEST: TOUS LES CAS POSSIBLES ===');
  
  // Cas 1: Opération valide
  Logger.log('\n1️⃣  CAS VALIDE:');
  testBatchPushValid();
  
  // Cas 2: Opération invalide
  Logger.log('\n2️⃣  CAS INVALIDE:');
  testBatchPushInvalid();
  
  // Cas 3: URL test direct
  Logger.log('\n3️⃣  TEST DIRECT SANS OPS:');
  const emptyResponse = handleBatchPush([]);
  Logger.log('Empty ops response: ' + JSON.stringify(emptyResponse, null, 2));
  
  Logger.log('\n✅ TOUS LES TESTS TERMINÉS');
}

/**
 * FONCTION DE VÉRIFICATION RAPIDE
 * Lance cette fonction pour un test rapide
 */
function quickTest() {
  Logger.clear();
  testAllReturns();
}
