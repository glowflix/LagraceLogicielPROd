/**
 * TEST BATCH PUSH - SIMPLIFIÉ
 * Copie cette fonction dans Apps Script et lance-la avec Run
 */

function testBatch() {
  console.log('=== 🧪 TEST BATCH PUSH START ===');
  
  const testData = {
    device_id: 'TEST-PC',
    ops: [
      {
        op_id: 'test-op-' + Date.now(),
        entity: 'stock_moves',
        op: 'create',
        payload: {
          product_code: '8',
          unit_level: 'CARTON',
          stock_absolute: 100
        }
      }
    ]
  };
  
  console.log('📤 Appel handleBatchPush...');
  console.log('Data:', JSON.stringify(testData));
  
  // Appel handleBatchPush
  // NOTE: handleBatchPush retourne jsonOut(...) qui est un ContentService object
  // Les console.log à l'intérieur de handleBatchPush vont s'afficher dans l'Execution log
  handleBatchPush(testData);
  
  console.log('=== ✅ TEST TERMINÉ - Regarde les logs au-dessus ===');
}
