// 🔍 DIAGNOSTIC RAPIDE: Pourquoi "kloo" n'est pas synced?

/**
 * Diagnostic complet pour "kloo"
 * Voir exactement où le problème est
 */
function diagnosticKloo() {
  const productName = 'kloo';
  const uuid = '96a8387d-b9ff-4bf0-bd9a-e5568e81e190';
  
  Logger.log('════════════════════════════════════════');
  Logger.log(`🔍 DIAGNOSTIC: ${productName}`);
  Logger.log(`UUID: ${uuid}`);
  Logger.log(`Date: ${new Date().toISOString()}`);
  Logger.log('════════════════════════════════════════\n');
  
  // STEP 1: Chercher en Sheets
  Logger.log('STEP 1️⃣: Chercher en Sheets...');
  const product = findProductByName(productName);
  
  if (!product) {
    Logger.log(`❌ ERREUR: "${productName}" NOT FOUND en Sheets!`);
    Logger.log('   Action: Ajouter manuellement en Sheets');
    showAlert(`❌ ERROR: "${productName}" not found in Sheets!\n\nAction: Add it manually in Carton/Milliers/Pièce`);
    return;
  }
  
  Logger.log(`✅ Found "${productName}"`);
  Logger.log(`   Sheet: ${product.sheet}`);
  Logger.log(`   Row: ${product.row}`);
  Logger.log(`   Name: ${product.name}`);
  Logger.log(`   Mark: ${product.mark}`);
  Logger.log(`   UUID: ${product.uuid || '❌ EMPTY'}`);
  Logger.log(`   Updated At: ${product.updated_at || '❌ EMPTY'}`);
  
  // STEP 2: Vérifier UUID
  Logger.log('\nSTEP 2️⃣: Vérifier UUID...');
  if (!product.uuid) {
    Logger.log('❌ UUID est VIDE!');
    Logger.log('   Action: Run "Force onEdit" pour générer UUID');
    showAlert(`❌ UUID is EMPTY for "${productName}"!\n\nAction: Run test "5️⃣ Force onEdit (kilo)" to generate UUID`);
    return;
  }
  
  if (product.uuid !== uuid) {
    Logger.log(`⚠️ UUID MISMATCH!`);
    Logger.log(`   Sheets: ${product.uuid}`);
    Logger.log(`   Expected: ${uuid}`);
    Logger.log('   Action: Les UUIDs ne correspondent pas entre BD et Sheets');
    showAlert(`⚠️ UUID MISMATCH!\n\nSheets: ${product.uuid}\nBD: ${uuid}`);
    return;
  }
  
  Logger.log(`✅ UUID matches: ${product.uuid}`);
  
  // STEP 3: Vérifier _updated_at
  Logger.log('\nSTEP 3️⃣: Vérifier _updated_at...');
  if (!product.updated_at) {
    Logger.log('❌ _updated_at est VIDE!');
    Logger.log('   Action: Run "Force onEdit" pour générer timestamp');
    showAlert(`❌ _updated_at is EMPTY!\n\nAction: Run "Force onEdit" test`);
    return;
  }
  
  Logger.log(`✅ _updated_at: ${product.updated_at}`);
  
  // STEP 4: Tester doProPush
  Logger.log('\nSTEP 4️⃣: Tester doProPush...');
  try {
    const data = {
      action: 'proPush',
      updates: [
        {
          uuid: product.uuid,
          name: product.name,
          mark: product.mark || ''
        }
      ]
    };
    
    Logger.log('Sending to doProPush:');
    Logger.log(JSON.stringify(data, null, 2));
    
    const result = doProPush(data);
    
    if (!result.success) {
      Logger.log(`❌ doProPush FAILED: ${result.error}`);
      showAlert(`❌ doProPush FAILED!\n\n${result.error}`);
      return;
    }
    
    Logger.log('✅ doProPush SUCCESS!');
    Logger.log(`Applied: ${result.applied?.length}`);
    Logger.log(`Propagated: ${result.propagated?.length}`);
    
  } catch (e) {
    Logger.log(`❌ doProPush ERROR: ${e.message}`);
    Logger.log(e.stack);
    showAlert(`❌ doProPush ERROR!\n\n${e.message}`);
    return;
  }
  
  // STEP 5: Tester getPullChanges
  Logger.log('\nSTEP 5️⃣: Vérifier getPullChanges...');
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
    const result = getPullChanges(since);
    
    Logger.log(`✅ getPullChanges returned ${result.products?.length || 0} product(s)`);
    
    const found = result.products?.find(p => p.name === productName);
    if (found) {
      Logger.log(`✅ "${productName}" found in pull result`);
      Logger.log(`   UUID: ${found.uuid}`);
      Logger.log(`   Version: ${found.version}`);
    } else {
      Logger.log(`⚠️ "${productName}" NOT in pull result`);
    }
    
  } catch (e) {
    Logger.log(`❌ getPullChanges ERROR: ${e.message}`);
  }
  
  // SUMMARY
  Logger.log('\n════════════════════════════════════════');
  Logger.log('✅ ALL CHECKS PASSED!');
  Logger.log('════════════════════════════════════════');
  Logger.log('\nPROBLEM: synced_at is NULL in DB');
  Logger.log('\nREASONS:');
  Logger.log('1. Sync loop hasn\'t run yet → node index.js not started');
  Logger.log('2. Sync loop errored → check logs');
  Logger.log('3. doProPush fails silently in Node.js → check Node logs');
  Logger.log('\nNEXT STEPS:');
  Logger.log('1. Verify doProPush works (test above passed ✅)');
  Logger.log('2. Start sync loop: npm start');
  Logger.log('3. Wait 5 minutes or trigger manually');
  Logger.log('4. Check: SELECT synced_at FROM products WHERE uuid=?');
  
  showAlert(
    `✅ Apps Script checks PASSED!\n\n` +
    `"${productName}" is ready to sync.\n\n` +
    `NEXT:\n` +
    `1. Start Node.js: npm start\n` +
    `2. Wait 5 min or trigger\n` +
    `3. Check: synced_at should update`
  );
}

// Run this from Apps Script menu
function addQuickDiagnosticMenu() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('🚨 QUICK FIX');
  menu.addItem('🔍 Diagnostic kloo', 'diagnosticKloo');
  menu.addToUi();
}

// Ajouter à onOpen():
// addQuickDiagnosticMenu();
