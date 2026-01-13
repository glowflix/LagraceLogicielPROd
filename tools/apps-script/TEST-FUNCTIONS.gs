// ===================================
// 🧪 TEST FUNCTION - Ajoute ceci à la fin de Code.gs
// ===================================

/**
 * TEST: Vérifier que handleBatchPush met à jour le stock dans Sheets
 * Lance depuis Apps Script: Run → testBatch
 * Puis regarde: View → Execution log
 */
function testBatch() {
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  🧪 TEST BATCH PUSH - STOCK UPDATE                ║');
  console.log('╚════════════════════════════════════════════════════╝');
  
  const testData = {
    device_id: 'TEST-PC',
    ops: [
      {
        op_id: 'test-op-stock-' + Date.now(),
        entity: 'stock_moves',
        op: 'create',
        payload: {
          product_code: '8',
          unit_level: 'CARTON',
          stock_absolute: 100,
          unit_mark: ''
        }
      }
    ]
  };
  
  console.log('📤 APPEL handleBatchPush avec:');
  console.log('   product_code: 8');
  console.log('   unit_level: CARTON');
  console.log('   stock_absolute: 100');
  
  // Appel
  handleBatchPush(testData);
  
  // Vérifier après quelques secondes
  console.log('\n📋 VÉRIFICATION APRÈS APPEL:');
  
  const sheet = getSheet('Carton');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colStock = findColumnIndex(sheet, 'Stock initial');
  
  if (colCode > 0 && colStock > 0) {
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      const code = String(values[i][colCode - 1] || '').trim();
      if (code === '8') {
        const stock = values[i][colStock - 1];
        console.log(`   ✅ TROUVÉ: Code=8, Stock=${stock}`);
        return;
      }
    }
    console.log('   ❌ Code 8 non trouvé dans Carton');
  } else {
    console.log('   ❌ Colonnes Code/Stock non trouvées');
  }
}

/**
 * TEST: Vérifier la structure des feuilles
 */
function testSheetStructure() {
  console.log('\n🔍 STRUCTURE DES FEUILLES:');
  
  const sheetNames = ['Carton', 'Milliers', 'Piece'];
  
  for (const name of sheetNames) {
    try {
      const sheet = getSheet(name);
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      
      console.log(`\n  📊 ${name}: ${lastRow} lignes, ${lastCol} colonnes`);
      console.log(`     Headers: ${headers.slice(0, 5).join(', ')}...`);
    } catch (e) {
      console.log(`  ❌ ${name}: ERREUR - ${e.message}`);
    }
  }
}

// ===================================
// FIN TEST
// ===================================
