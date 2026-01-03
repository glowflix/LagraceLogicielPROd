// 🔍 DIAGNOSTIC APPS SCRIPT - Ajouter au Code.gs
// Copier/coller ces fonctions à la fin de Code.gs
// Puis run depuis Sheets > Extensions > Apps Script > Run

/**
 * 🧪 TEST 1: Vérifier que doProPull marche
 */
function testDoProPull() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Last 24h
  
  Logger.log('🧪 TEST: doProPull');
  Logger.log(`Since: ${since}`);
  
  try {
    const p = {
      since: since,
      includeConflicts: '1'
    };
    
    const result = doProPull(p);
    
    Logger.log('✅ doProPull SUCCESS:');
    Logger.log(JSON.stringify(result, null, 2));
    
    showAlert('✅ doProPull marche!\n\n' + 
      `Products: ${result.data.products.length}\n` +
      `Conflicts: ${result.data.conflicts.length}`);
      
  } catch (e) {
    Logger.log('❌ doProPull ERROR: ' + e.message);
    showAlert('❌ doProPull ERROR:\n' + e.message);
  }
}

/**
 * 🧪 TEST 2: Vérifier que doProPush marche (tester avec "kilo")
 */
function testDoProPushKilo() {
  Logger.log('🧪 TEST: doProPush avec "kilo"');
  
  try {
    // Chercher "kilo" dans les feuilles
    const product = findProductByName('kilo');
    
    if (!product) {
      Logger.log('❌ "kilo" non trouvé en Sheets');
      showAlert('❌ "kilo" non trouvé en Sheets');
      return;
    }
    
    Logger.log(`Found: ${JSON.stringify(product, null, 2)}`);
    
    // Tester doProPush avec ce produit
    const data = {
      action: 'proPush',
      updates: [
        {
          uuid: product.uuid || Utilities.getUuid(),
          name: product.name,
          mark: product.mark || ''
        }
      ]
    };
    
    Logger.log('Pushing: ' + JSON.stringify(data, null, 2));
    const result = doProPush(data);
    
    Logger.log('✅ doProPush SUCCESS:');
    Logger.log(JSON.stringify(result, null, 2));
    
    showAlert('✅ doProPush marche!\n\n' + 
      `Applied: ${result.applied?.length || 0}\n` +
      `Propagated: ${result.propagated?.length || 0}`);
      
  } catch (e) {
    Logger.log('❌ doProPush ERROR: ' + e.message);
    Logger.log(e.stack);
    showAlert('❌ doProPush ERROR:\n' + e.message);
  }
}

/**
 * 🧪 TEST 3: Vérifier tech columns (_uuid, _updated_at, etc)
 */
function testTechColumns() {
  Logger.log('🧪 TEST: Tech columns check');
  
  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  const results = [];
  
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (!['Carton', 'Milliers', 'Pièce'].includes(name)) continue;
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const techCols = {
      uuid: headers.indexOf('_uuid') + 1,
      updatedAt: headers.indexOf('_updated_at') + 1,
      version: headers.indexOf('_version') + 1,
      deleted: headers.indexOf('_deleted') + 1
    };
    
    results.push({
      sheet: name,
      hasUuid: techCols.uuid > 0,
      hasUpdatedAt: techCols.updatedAt > 0,
      hasVersion: techCols.version > 0,
      hasDeleted: techCols.deleted > 0,
      uuidColumn: techCols.uuid,
      updatedAtColumn: techCols.updatedAt,
      versionColumn: techCols.version,
      deletedColumn: techCols.deleted
    });
  }
  
  Logger.log('✅ Tech columns status:');
  for (const r of results) {
    Logger.log(`${r.sheet}: UUID(${r.uuidColumn}) UpdatedAt(${r.updatedAtColumn}) Version(${r.versionColumn}) Deleted(${r.deletedColumn})`);
  }
  
  showAlert('✅ Tech columns:\n' + 
    results.map(r => `${r.sheet}: ${r.hasUuid ? '✓' : '✗'} ${r.hasUpdatedAt ? '✓' : '✗'} ${r.hasVersion ? '✓' : '✗'}`).join('\n'));
}

/**
 * 🧪 TEST 4: Vérifier que "kilo" a un UUID et _updated_at
 */
function testKiloUUIDandTimestamp() {
  Logger.log('🧪 TEST: kilo UUID and _updated_at');
  
  const product = findProductByName('kilo');
  
  if (!product) {
    Logger.log('❌ kilo not found');
    showAlert('❌ kilo not found in Sheets');
    return;
  }
  
  Logger.log('Found kilo:');
  Logger.log(`  Name: ${product.name}`);
  Logger.log(`  UUID: ${product.uuid}`);
  Logger.log(`  Updated At: ${product.updated_at}`);
  Logger.log(`  Mark: ${product.mark}`);
  Logger.log(`  Sheet: ${product.sheet}`);
  Logger.log(`  Row: ${product.row}`);
  
  if (!product.uuid) {
    Logger.log('⚠️ UUID is EMPTY!');
  }
  if (!product.updated_at) {
    Logger.log('⚠️ _updated_at is EMPTY!');
  }
  
  showAlert(`kilo Found:\n` +
    `UUID: ${product.uuid || '❌ EMPTY'}\n` +
    `Updated: ${product.updated_at || '❌ EMPTY'}\n` +
    `Sheet: ${product.sheet}`);
}

/**
 * 🧪 TEST 5: Forcer onEdit sur "kilo" (génère UUID et _updated_at)
 */
function testForceOnEditKilo() {
  Logger.log('🧪 TEST: Force onEdit on kilo');
  
  try {
    const product = findProductByName('kilo');
    
    if (!product) {
      showAlert('❌ kilo not found');
      return;
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(product.sheet);
    const range = sheet.getRange(product.row, 1, 1, sheet.getLastColumn());
    
    // Trigger onEdit
    Logger.log(`Simulating onEdit on row ${product.row}`);
    
    const colB = range.getValues()[0][1]; // Column B = Name
    
    // Appeler directement la logique d'onEdit
    const p = {
      range: range,
      value: colB
    };
    
    // Trouver colonne _uuid et _updated_at
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const uuidCol = headers.indexOf('_uuid') + 1;
    const updatedAtCol = headers.indexOf('_updated_at') + 1;
    const versionCol = headers.indexOf('_version') + 1;
    
    if (uuidCol === 0) {
      showAlert('❌ Column _uuid not found!');
      return;
    }
    
    Logger.log(`UUID column: ${uuidCol}, UpdatedAt column: ${updatedAtCol}`);
    
    // Générer UUID
    const newUuid = Utilities.getUuid();
    const nowIso = new Date().toISOString();
    
    // Mettre à jour
    sheet.getRange(product.row, uuidCol).setValue(newUuid);
    if (updatedAtCol > 0) {
      sheet.getRange(product.row, updatedAtCol).setValue(nowIso);
    }
    if (versionCol > 0) {
      sheet.getRange(product.row, versionCol).setValue(1);
    }
    
    Logger.log(`✅ Updated kilo: UUID=${newUuid}, UpdatedAt=${nowIso}`);
    
    showAlert(`✅ kilo updated:\n` +
      `UUID: ${newUuid}\n` +
      `Updated: ${nowIso}`);
      
  } catch (e) {
    Logger.log('❌ ERROR: ' + e.message);
    showAlert('❌ ERROR:\n' + e.message);
  }
}

/**
 * 🧪 TEST 6: Pull changes since 24h ago
 */
function testGetPullChanges() {
  Logger.log('🧪 TEST: getPullChanges (last 24h)');
  
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    Logger.log(`Since: ${since.toISOString()}`);
    
    const result = getPullChanges(since);
    
    Logger.log('✅ getPullChanges result:');
    Logger.log(JSON.stringify(result, null, 2));
    
    showAlert(`✅ Pull changes found:\n` +
      `Products: ${result.products?.length || 0}\n` +
      `Conflicts: ${result.conflicts?.length || 0}`);
      
  } catch (e) {
    Logger.log('❌ ERROR: ' + e.message);
    showAlert('❌ ERROR:\n' + e.message);
  }
}

/**
 * 🧪 TEST 7: Vérifier que "kilo" propagate sur tous les units
 */
function testPropagateSyncKilo() {
  Logger.log('🧪 TEST: Propagate kilo to all units');
  
  try {
    const product = findProductByName('kilo');
    
    if (!product) {
      showAlert('❌ kilo not found');
      return;
    }
    
    const uuid = product.uuid || Utilities.getUuid();
    const name = product.name;
    const mark = product.mark;
    
    Logger.log(`Propagating: UUID=${uuid}, Name=${name}, Mark=${mark}`);
    
    const count = propagateNameMarkToAllUnits(uuid, name, mark);
    
    Logger.log(`✅ Propagated to ${count} unit(s)`);
    
    showAlert(`✅ Propagation done:\n${count} unit(s) updated`);
      
  } catch (e) {
    Logger.log('❌ ERROR: ' + e.message);
    showAlert('❌ ERROR:\n' + e.message);
  }
}

/**
 * 🧪 TEST 8: Voir tous les logs
 */
function testShowLogs() {
  const logs = Logger.getLog();
  SpreadsheetApp.getUi().showModelessDialog(
    HtmlService.createHtmlOutput(`<pre style="font-family: monospace; white-space: pre-wrap; word-wrap: break-word;">${logs}</pre>`),
    '📋 Logs'
  );
}

/**
 * Helper: Afficher alerte
 */
function showAlert(msg) {
  const ui = SpreadsheetApp.getUi();
  ui.alert(msg);
}

/**
 * Helper: Trouver product par nom
 */
function findProductByName(searchName) {
  const sheetNames = ['Carton', 'Milliers', 'Pièce'];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  for (const sheetName of sheetNames) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const nameIdx = headers.indexOf('Nom') !== -1 ? headers.indexOf('Nom') : 1; // Column B
    const markIdx = headers.indexOf('Mark') !== -1 ? headers.indexOf('Mark') : 5; // Column F
    const uuidIdx = headers.indexOf('_uuid') !== -1 ? headers.indexOf('_uuid') : -1;
    const updatedAtIdx = headers.indexOf('_updated_at') !== -1 ? headers.indexOf('_updated_at') : -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][nameIdx] === searchName) {
        return {
          name: data[i][nameIdx],
          mark: data[i][markIdx],
          uuid: uuidIdx >= 0 ? data[i][uuidIdx] : '',
          updated_at: updatedAtIdx >= 0 ? data[i][updatedAtIdx] : '',
          row: i + 1,
          sheet: sheetName
        };
      }
    }
  }
  
  return null;
}

// ============================================================================
// AJOUTER CES FONCTIONS AU MENU (ajouter après onOpen existant):
// ============================================================================

function addTestMenuItems() {
  // Modifier la fonction onOpen existante pour inclure:
  
  const ui = SpreadsheetApp.getUi();
  
  const menu = ui.createMenu('🧪 TEST SYNC');
  menu.addItem('1️⃣ Test doProPull', 'testDoProPull');
  menu.addItem('2️⃣ Test doProPush (kilo)', 'testDoProPushKilo');
  menu.addItem('3️⃣ Check Tech Columns', 'testTechColumns');
  menu.addItem('4️⃣ Check kilo UUID', 'testKiloUUIDandTimestamp');
  menu.addItem('5️⃣ Force onEdit (kilo)', 'testForceOnEditKilo');
  menu.addItem('6️⃣ Get Pull Changes', 'testGetPullChanges');
  menu.addItem('7️⃣ Propagate (kilo)', 'testPropagateSyncKilo');
  menu.addItem('📋 Show Logs', 'testShowLogs');
  menu.addToUi();
}

// À ajouter dans onOpen():
// addTestMenuItems();
