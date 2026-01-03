/**
 * 🔧 TEST TECHNIQUE: Vérifier la logique de recherche de produits en Sheets
 * 
 * Cette fonction simule exactement ce que handleProductUpsert fait:
 * 1. Cherche par UUID (priorité)
 * 2. Sinon: cherche par code + mark
 * 3. Auto-génère UUID si absent
 * 4. Met à jour ou crée la ligne
 */

function testProductSearchLogic() {
  const uuid = '96a8387d-b9ff-4bf0-bd9a-e5568e81e190';
  const code = 'kloo';
  const mark = ''; // Vide pour CARTON
  const sheetName = SHEETS.CARTON;
  
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🔧 TEST: Logique de recherche de produit en Sheets');
  Logger.log('═══════════════════════════════════════════════════════════════\n');
  
  Logger.log(`Paramètres de recherche:`);
  Logger.log(`  UUID: ${uuid}`);
  Logger.log(`  Code: ${code}`);
  Logger.log(`  Mark: "${mark}"`);
  Logger.log(`  Sheet: ${sheetName}\n`);
  
  const sheet = getSheet(sheetName);
  
  // Colonnes clés
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colNom = findColumnIndex(sheet, 'Nom du produit');
  const colMark = findColumnIndex(sheet, 'Mark');
  const colUuid = findColumnIndex(sheet, '_uuid');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  
  Logger.log(`Colonnes trouvées:`);
  Logger.log(`  Code produit: ${colCode}`);
  Logger.log(`  Nom du produit: ${colNom}`);
  Logger.log(`  Mark: ${colMark}`);
  Logger.log(`  _uuid: ${colUuid}`);
  Logger.log(`  _updated_at: ${colUpdatedAt}\n`);
  
  if (colCode <= 0 || colNom <= 0) {
    Logger.log('❌ ERREUR: Colonnes critiques manquantes!');
    showAlert('❌ Missing critical columns (Code produit, Nom)');
    return;
  }
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  
  Logger.log(`Données Sheets:`);
  Logger.log(`  Last row: ${lastRow}`);
  Logger.log(`  Last col: ${lastCol}`);
  Logger.log(`  Values to search: ${values.length} ligne(s)\n`);
  
  // ===== ALGORITHME IDENTIQUE À handleProductUpsert =====
  let rowIndex = -1;
  let existingUuid = '';
  let matchMethod = 'NONE';
  
  for (let i = 0; i < values.length; i++) {
    const rowCode = normalizeCode(values[i][colCode - 1]);
    const rowUuid = colUuid > 0 ? normalizeCode(values[i][colUuid - 1]) : '';
    const rowMark = colMark > 0 ? normalizeMark(values[i][colMark - 1]) : '';
    
    // DEBUG: Log les 5 premières lignes
    if (i < 5) {
      Logger.log(`  Row ${i + 2}: code="${rowCode}", uuid="${rowUuid}", mark="${rowMark}"`);
    }
    
    // PRIORITÉ 1: UUID si fourni
    if (uuid && rowUuid && rowUuid === uuid) {
      rowIndex = i + 2;
      existingUuid = rowUuid;
      matchMethod = 'BY_UUID';
      Logger.log(`\n✅ MATCH PAR UUID à ligne ${rowIndex}\n`);
      break;
    }
    
    // PRIORITÉ 2: code + mark NORMALISÉS
    if (rowCode === normalizeCode(code) && rowMark === normalizeMark(mark)) {
      rowIndex = i + 2;
      existingUuid = rowUuid;
      matchMethod = 'BY_CODE_MARK';
      Logger.log(`\n✅ MATCH PAR CODE+MARK à ligne ${rowIndex}\n`);
      break;
    }
  }
  
  // Résultat de la recherche
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('📊 RÉSULTAT DE LA RECHERCHE:');
  Logger.log('═══════════════════════════════════════════════════════════════\n');
  
  if (rowIndex > 0) {
    Logger.log(`✅ PRODUIT TROUVÉ`);
    Logger.log(`  Method: ${matchMethod}`);
    Logger.log(`  Row: ${rowIndex}`);
    Logger.log(`  Existing UUID: ${existingUuid || '(vide)'}`);
    Logger.log(`  Action: UPDATE cette ligne\n`);
    
    // Montrer ce qui serait mis à jour
    Logger.log('Données à mettre à jour:');
    Logger.log(`  Code produit: ${code}`);
    Logger.log(`  Nom du produit: kloo (de la BD)`);
    Logger.log(`  Mark: "${mark}" (de la BD)`);
    Logger.log(`  UUID final: ${uuid || existingUuid || '(générer)'}`);
    Logger.log(`  _updated_at: ${nowIso()}\n`);
    
  } else {
    Logger.log(`❌ PRODUIT NON TROUVÉ`);
    Logger.log(`  Method: N/A`);
    Logger.log(`  Row: (new)`);
    Logger.log(`  Action: CREATE une nouvelle ligne\n`);
    
    Logger.log('Données qui seraient créées:');
    Logger.log(`  Code produit: ${code}`);
    Logger.log(`  Nom du produit: kloo`);
    Logger.log(`  Mark: "${mark}"`);
    Logger.log(`  UUID final: ${uuid || '(générer: ' + generateFullUUID() + ')'}`);
    Logger.log(`  _updated_at: ${nowIso()}\n`);
  }
  
  // ===== SIMULATION COMPLÈTE =====
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🧪 SIMULATION: Appel à handleProductUpsert');
  Logger.log('═══════════════════════════════════════════════════════════════\n');
  
  const testPayload = {
    code: code,
    name: 'kloo',
    unit_level: 'CARTON',
    unit_mark: mark,
    stock_initial: 44396,
    stock_current: 44396,
    purchase_price_usd: 9.2,
    sale_price_usd: 10,
    auto_stock_factor: 1,
    uuid: uuid,
    last_update: new Date().toISOString()
  };
  
  Logger.log('Payload à envoyer:');
  Logger.log(JSON.stringify(testPayload, null, 2));
  Logger.log('');
  
  try {
    // Appel réel à handleProductUpsert
    Logger.log('Appel à handleProductUpsert...\n');
    const result = handleProductUpsert(testPayload, 'products');
    
    if (result && result.success) {
      Logger.log('✅ handleProductUpsert SUCCESS!');
      Logger.log(`  Result: ${JSON.stringify(result, null, 2)}`);
      Logger.log('\n✅ SIMULATION COMPLÈTE - PRODUIT PRÊT POUR SYNC\n');
    } else {
      Logger.log('❌ handleProductUpsert FAILED!');
      Logger.log(`  Error: ${result?.error || 'unknown'}`);
      Logger.log(`\n❌ SIMULATION ÉCHOUÉE\n`);
    }
  } catch (e) {
    Logger.log('❌ handleProductUpsert ERROR!');
    Logger.log(`  ${e.message}`);
    Logger.log(`  ${e.stack}`);
    Logger.log(`\n❌ SIMULATION ÉCHOUÉE\n`);
  }
  
  Logger.log('═══════════════════════════════════════════════════════════════\n');
  
  showAlert('Test de logique terminé - Vérifiez les logs (Tools → Logs)');
}

/**
 * TEST SECONDAIRE: Normalisation du code
 * Vérifie que la recherche par code fonctionne correctement
 */
function testCodeNormalization() {
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🔤 TEST: Normalisation du code');
  Logger.log('═══════════════════════════════════════════════════════════════\n');
  
  const testCases = [
    'kloo',
    'KLOO',
    'Kloo',
    'kloo ',
    ' kloo',
    '  KLOO  ',
    'kloo\n',
    'k loo' // Attention: espace dans le code
  ];
  
  Logger.log('Tests de normalisation:\n');
  for (const testCode of testCases) {
    const normalized = normalizeCode(testCode);
    Logger.log(`  Input: "${testCode}" → Normalized: "${normalized}"`);
  }
  
  Logger.log('\n✅ Normalisation terminée\n');
  showAlert('Test normalisation terminé - Vérifiez les logs');
}

/**
 * Ajouter au menu
 */
function onOpen2() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('🧪 Tests Technique');
  
  menu.addItem('1️⃣  Test Logique Recherche', 'testProductSearchLogic');
  menu.addItem('2️⃣  Test Normalisation Code', 'testCodeNormalization');
  
  menu.addToUi();
}
