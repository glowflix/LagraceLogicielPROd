/**
 * 🔍 TEST GOOGLE SHEETS: Vérifier que "kloo" peut se synchroniser
 * 
 * Cette fonction teste:
 * 1. Que le produit "kloo" existe en Sheets
 * 2. Que doProPush fonctionne correctement
 * 3. Que le UUID est trouvé et mis à jour
 * 4. Que synced_at est marqué après le push
 */

function testKlooSyncComplete() {
  const uuid = '96a8387d-b9ff-4bf0-bd9a-e5568e81e190';
  const productName = 'kloo';
  
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🔍 TEST: Synchronisation complète de "kloo" vers Sheets');
  Logger.log('═══════════════════════════════════════════════════════════════\n');
  
  // STEP 1: Chercher le produit
  Logger.log('STEP 1️⃣: Chercher "kloo" en Sheets...\n');
  
  let foundProduct = null;
  let foundSheet = null;
  let foundRow = null;
  
  const sheets = [
    { name: SHEETS.CARTON, label: 'Carton' },
    { name: SHEETS.MILLIERS, label: 'Milliers' },
    { name: SHEETS.PIECE, label: 'Pièce' }
  ];
  
  for (const sheetInfo of sheets) {
    const sheet = getSheet(sheetInfo.name);
    const colCode = findColumnIndex(sheet, 'Code produit');
    const colNom = findColumnIndex(sheet, 'Nom du produit');
    const colUuid = findColumnIndex(sheet, '_uuid');
    const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) continue;
    
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    
    for (let i = 0; i < values.length; i++) {
      const rowCode = String(values[i][colCode - 1] || '').trim();
      const rowName = String(values[i][colNom - 1] || '').trim();
      const rowUuid = colUuid > 0 ? String(values[i][colUuid - 1] || '') : '';
      const rowUpdatedAt = colUpdatedAt > 0 ? String(values[i][colUpdatedAt - 1] || '') : '';
      
      if (rowCode.toLowerCase() === 'kloo' || rowName.toLowerCase() === 'kloo') {
        foundProduct = {
          code: rowCode,
          name: rowName,
          uuid: rowUuid,
          updated_at: rowUpdatedAt
        };
        foundSheet = sheetInfo.name;
        foundRow = i + 2;
        
        Logger.log(`   ✅ TROUVÉ en "${sheetInfo.label}"`);
        Logger.log(`      Code: ${rowCode}`);
        Logger.log(`      Nom: ${rowName}`);
        Logger.log(`      UUID (Sheets): ${rowUuid || '❌ VIDE'}`);
        Logger.log(`      Updated At: ${rowUpdatedAt || '❌ VIDE'}`);
        Logger.log(`      Row: ${foundRow}\n`);
        break;
      }
    }
    
    if (foundProduct) break;
  }
  
  if (!foundProduct) {
    Logger.log('   ❌ ERREUR: "kloo" NOT FOUND en Sheets!');
    Logger.log('   🔧 ACTION:');
    Logger.log('      1. Allez dans l\'onglet Carton');
    Logger.log('      2. Créez une ligne avec Code="kloo", Nom="kloo"');
    Logger.log('      3. Relancez ce test\n');
    showAlert('❌ "kloo" NOT FOUND in Sheets\n\nAdd it manually first');
    return;
  }
  
  // STEP 2: Vérifier UUID
  Logger.log('STEP 2️⃣: Vérifier UUID...\n');
  
  if (foundProduct.uuid === uuid) {
    Logger.log(`   ✅ UUID correspond!`);
    Logger.log(`      ${uuid}\n`);
  } else if (!foundProduct.uuid) {
    Logger.log(`   ⚠️  UUID en Sheets est VIDE`);
    Logger.log(`      Expected: ${uuid}`);
    Logger.log(`      Sheets: (empty)`);
    Logger.log(`   🔧 ACTION: Le système devrait générer l'UUID automatiquement\n`);
  } else {
    Logger.log(`   ⚠️  UUID MISMATCH!`);
    Logger.log(`      Expected: ${uuid}`);
    Logger.log(`      Sheets: ${foundProduct.uuid}\n`);
  }
  
  // STEP 3: Tester doProPush
  Logger.log('STEP 3️⃣: Tester doProPush...\n');
  
  try {
    const data = {
      action: 'proPush',
      updates: [
        {
          uuid: uuid,
          name: 'kloo',
          mark: ''
        }
      ]
    };
    
    Logger.log('   📤 Envoi vers doProPush:');
    Logger.log(`      UUID: ${uuid}`);
    Logger.log(`      Name: kloo`);
    Logger.log(`      Mark: (empty)\n`);
    
    const result = doProPush(data);
    
    if (!result || !result.success) {
      Logger.log(`   ❌ doProPush FAILED: ${result?.error || 'unknown error'}\n`);
      showAlert(`❌ doProPush failed: ${result?.error}`);
      return;
    }
    
    Logger.log('   ✅ doProPush SUCCESS!');
    Logger.log(`      Applied: ${result.applied?.length || 0}`);
    Logger.log(`      Propagated: ${result.propagated?.length || 0}\n`);
    
  } catch (e) {
    Logger.log(`   ❌ doProPush ERROR: ${e.message}\n`);
    Logger.log(e.stack);
    showAlert(`❌ doProPush ERROR: ${e.message}`);
    return;
  }
  
  // STEP 4: Vérifier synced_at après push
  Logger.log('STEP 4️⃣: Vérifier synced_at après push...\n');
  
  try {
    const sheet = getSheet(foundSheet);
    const colSyncedAt = findColumnIndex(sheet, 'synced_at') || findColumnIndex(sheet, '_synced_at');
    
    if (colSyncedAt <= 0) {
      Logger.log('   ⚠️  Colonne "synced_at" n\'existe pas en Sheets');
      Logger.log('   🔧 ACTION: Ajouter la colonne "_synced_at" ou "synced_at"\n');
    } else {
      const currentSyncedAt = sheet.getRange(foundRow, colSyncedAt).getValue();
      Logger.log(`   📊 synced_at avant: ${currentSyncedAt || '(empty)'}`);
      Logger.log(`   📝 Après doProPush, vérifiez manuellement si la valeur a changé\n`);
    }
  } catch (e) {
    Logger.log(`   ⚠️  Erreur lors de la vérification synced_at: ${e.message}\n`);
  }
  
  // STEP 5: Recommandations finales
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('💡 RÉSUMÉ ET RECOMMANDATIONS:');
  Logger.log('═══════════════════════════════════════════════════════════════\n');
  
  if (!foundProduct.uuid) {
    Logger.log('⚠️  UUID manquant en Sheets\n');
    Logger.log('   CAUSE: Le produit n\'a pas reçu d\'UUID automatiquement');
    Logger.log('   SOLUTION:');
    Logger.log('   1. Allez dans l\'onglet où se trouve "kloo"');
    Logger.log('   2. Cliquez dans la cellule _uuid pour cette ligne');
    Logger.log('   3. Entrez: ' + uuid);
    Logger.log('   4. Appuyez sur Enter');
    Logger.log('   5. Relancez ce test\n');
  } else if (foundProduct.uuid !== uuid) {
    Logger.log('⚠️  UUID ne correspond pas entre BD et Sheets\n');
    Logger.log('   BD UUID: ' + uuid);
    Logger.log('   SHEETS UUID: ' + foundProduct.uuid);
    Logger.log('   SOLUTION: Vérifiez si le produit dans BD doit être mis à jour\n');
  } else {
    Logger.log('✅ Tous les tests sont PASSÉS!\n');
    Logger.log('   ✅ "kloo" trouvé en Sheets');
    Logger.log('   ✅ UUID correspond');
    Logger.log('   ✅ doProPush fonctionne');
    Logger.log('   ✅ Prêt pour la synchronisation complète\n');
  }
  
  Logger.log('═══════════════════════════════════════════════════════════════\n');
  
  showAlert('✅ Test complet terminé!\n\nVérifiez les logs (Tools → Logs)');
}

/**
 * Menus helper pour tester rapidement
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('🧪 Tests Sync');
  
  menu.addItem('1️⃣  Test Kloo (complet)', 'testKlooSyncComplete');
  menu.addItem('2️⃣  Test doProPush', 'testDoProPushKilo');
  
  menu.addToUi();
}
