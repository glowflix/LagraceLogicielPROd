/**
 * Google Apps Script pour LA GRACE - Alimentation
 * Synchronisation bidirectionnelle entre SQLite local et Google Sheets
 * 
 * Spreadsheet ID: 111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI
 * 
 * Feuilles réelles (structure exacte):
 * - Carton
 * - Milliers
 * - Piece
 * - Ventes
 * - Dettes
 * - Taux
 * - Compter Utilisateur
 * - Stock de prix effectué
 */

const SPREADSHEET_ID = '111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI';

// Mapping des noms de feuilles
const SHEETS = {
  CARTON: 'Carton',
  MILLIERS: 'Milliers',
  PIECE: 'Piece',
  VENTES: 'Ventes',
  DETTES: 'Dettes',
  TAUX: 'Taux',
  COMPTER_UTILISATEUR: 'Compter Utilisateur',
  STOCK_PRIX: 'Stock de prix effectué'
};

/**
 * Obtient le spreadsheet
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Obtient une feuille par nom (crée si n'existe pas)
 */
function getSheet(sheetName) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * Trouve l'index d'une colonne par son nom d'en-tête
 * Retourne -1 si non trouvé
 */
function findColumnIndex(sheet, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] && headers[i].toString().trim().toLowerCase() === headerName.toLowerCase()) {
      return i + 1; // +1 car Sheets utilise 1-based
    }
  }
  return -1;
}

/**
 * Trouve ou crée une colonne par nom
 */
function ensureColumn(sheet, headerName, insertAfter = null) {
  let colIndex = findColumnIndex(sheet, headerName);
  if (colIndex === -1) {
    // Colonne n'existe pas, l'ajouter
    const lastCol = sheet.getLastColumn();
    colIndex = lastCol + 1;
    sheet.getRange(1, colIndex).setValue(headerName);
    sheet.getRange(1, colIndex).setFontWeight('bold');
  }
  return colIndex;
}

/**
 * ENDPOINT: Push depuis local vers Sheets
 * POST avec body: { entity, entity_id, op, payload }
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { entity, entity_id, op, payload } = data;
    
    let result;
    
    switch (entity) {
      case 'products':
      case 'product_units':
        result = handleProductUpsert(payload, entity);
        break;
      case 'sales':
        result = handleSaleUpsert(payload);
        break;
      case 'sale_items':
        result = handleSaleItemUpsert(payload);
        break;
      case 'debts':
        result = handleDebtUpsert(payload);
        break;
      case 'debt_payments':
        result = handleDebtPaymentUpsert(payload);
        break;
      case 'rates':
        result = handleRateUpsert(payload);
        break;
      case 'users':
        result = handleUserUpsert(payload);
        break;
      case 'price_logs':
        result = handlePriceLogUpsert(payload);
        break;
      default:
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: 'Entity inconnue: ' + entity
        })).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      result: result,
      remote_version: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ENDPOINT: Pull depuis Sheets vers local
 * GET avec query: ?entity=...&since=...
 */
function doGet(e) {
  try {
    const { entity, since } = e.parameter;
    
    if (!entity) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Paramètre entity requis'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    let result;
    const sinceDate = since ? new Date(since) : new Date(0);
    
    switch (entity) {
      case 'products':
        result = getProductsSince(sinceDate, 'products');
        break;
      case 'product_units':
        result = getProductsSince(sinceDate, 'product_units');
        break;
      case 'sales':
        result = getSalesSince(sinceDate);
        break;
      case 'debts':
        result = getDebtsSince(sinceDate);
        break;
      case 'rates':
        result = getRatesSince(sinceDate);
        break;
      case 'users':
        result = getUsersSince(sinceDate);
        break;
      default:
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: 'Entity inconnue: ' + entity
        })).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      data: result,
      count: result.length
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Gère l'upsert d'un produit/unité dans les feuilles Stock (Carton/Milliers/Piece)
 */
function handleProductUpsert(payload, entityType) {
  const { code, name, unit_level, unit_mark, stock_initial, stock_current,
          purchase_price_usd, sale_price_fc, sale_price_usd,
          auto_stock_factor, qty_step, extra1, extra2, last_update, uuid } = payload;
  
  // Détermine la feuille selon unit_level
  let sheetName;
  if (unit_level === 'CARTON') {
    sheetName = SHEETS.CARTON;
  } else if (unit_level === 'MILLIER') {
    sheetName = SHEETS.MILLIERS;
  } else if (unit_level === 'PIECE') {
    sheetName = SHEETS.PIECE;
  } else {
    throw new Error('unit_level invalide: ' + unit_level);
  }
  
  const sheet = getSheet(sheetName);
  
  // S'assurer que les colonnes existent
  ensureColumn(sheet, 'Code produit');
  ensureColumn(sheet, 'Nom du produit');
  ensureColumn(sheet, 'Stock initial');
  ensureColumn(sheet, 'Prix d\'achat (USD)');
  ensureColumn(sheet, 'Prix de vente (FC)');
  ensureColumn(sheet, 'Prix de vente détail (FC)');
  ensureColumn(sheet, 'Mark');
  ensureColumn(sheet, 'Date de dernière mise à jour');
  ensureColumn(sheet, 'Automatisation Stock');
  ensureColumn(sheet, 'Prix ventes (USD)');
  ensureColumn(sheet, '_uuid'); // Colonne technique pour UUID
  
  // Trouver les index de colonnes
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colNom = findColumnIndex(sheet, 'Nom du produit');
  const colStockInit = findColumnIndex(sheet, 'Stock initial');
  const colPrixAchatUSD = findColumnIndex(sheet, 'Prix d\'achat (USD)');
  const colPrixVenteFC = findColumnIndex(sheet, 'Prix de vente (FC)');
  const colPrixVenteDetailFC = findColumnIndex(sheet, 'Prix de vente détail (FC)');
  const colMark = findColumnIndex(sheet, 'Mark');
  const colDateUpdate = findColumnIndex(sheet, 'Date de dernière mise à jour');
  const colAutoStock = findColumnIndex(sheet, 'Automatisation Stock');
  const colPrixVenteUSD = findColumnIndex(sheet, 'Prix ventes (USD)');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Recherche par Code produit ou UUID
  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    const rowCode = values[i][colCode - 1];
    const rowUuid = colUuid > 0 ? values[i][colUuid - 1] : null;
    if (rowCode === code || (uuid && rowUuid === uuid)) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const now = new Date().toISOString();
  
  // Préparer les valeurs selon la feuille
  const rowData = [];
  const maxCol = Math.max(colCode, colNom, colStockInit, colPrixAchatUSD, 
                          colPrixVenteFC, colPrixVenteDetailFC, colMark, 
                          colDateUpdate, colAutoStock, colPrixVenteUSD, colUuid);
  
  // Initialiser toutes les colonnes
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  // Remplir les valeurs
  if (colCode > 0) rowData[colCode - 1] = code || '';
  if (colNom > 0) rowData[colNom - 1] = name || '';
  if (colStockInit > 0) rowData[colStockInit - 1] = stock_current || stock_initial || 0;
  if (colPrixAchatUSD > 0) rowData[colPrixAchatUSD - 1] = purchase_price_usd || 0;
  
  // Prix de vente selon la feuille
  if (sheetName === SHEETS.PIECE && colPrixVenteDetailFC > 0) {
    rowData[colPrixVenteDetailFC - 1] = sale_price_fc || 0;
  } else if (colPrixVenteFC > 0) {
    rowData[colPrixVenteFC - 1] = sale_price_fc || 0;
  }
  
  if (colMark > 0) rowData[colMark - 1] = unit_mark || '';
  if (colDateUpdate > 0) rowData[colDateUpdate - 1] = last_update || now;
  if (colAutoStock > 0) rowData[colAutoStock - 1] = auto_stock_factor || 1;
  if (colPrixVenteUSD > 0) rowData[colPrixVenteUSD - 1] = sale_price_usd || 0;
  if (colUuid > 0) rowData[colUuid - 1] = uuid || '';
  
  if (rowIndex > 0) {
    // Mise à jour
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // Insertion
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
  }
  
  return { row: rowIndex, sheet: sheetName };
}

/**
 * Gère l'upsert d'une vente (ligne dans feuille Ventes)
 */
function handleSaleUpsert(payload) {
  const sheet = getSheet(SHEETS.VENTES);
  
  // S'assurer que les colonnes existent
  ensureColumn(sheet, 'Date');
  ensureColumn(sheet, 'Numéro de facture');
  ensureColumn(sheet, 'Code produit');
  ensureColumn(sheet, 'client');
  ensureColumn(sheet, 'QTE');
  ensureColumn(sheet, 'MARK');
  ensureColumn(sheet, 'Prix unitaire');
  ensureColumn(sheet, 'Vendeur');
  ensureColumn(sheet, 'mode stock');
  ensureColumn(sheet, 'Telephone');
  ensureColumn(sheet, 'USD');
  ensureColumn(sheet, '_uuid');
  
  const colDate = findColumnIndex(sheet, 'Date');
  const colFacture = findColumnIndex(sheet, 'Numéro de facture');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colClient = findColumnIndex(sheet, 'client');
  const colQte = findColumnIndex(sheet, 'QTE');
  const colMark = findColumnIndex(sheet, 'MARK');
  const colPrixUnitaire = findColumnIndex(sheet, 'Prix unitaire');
  const colVendeur = findColumnIndex(sheet, 'Vendeur');
  const colModeStock = findColumnIndex(sheet, 'mode stock');
  const colTelephone = findColumnIndex(sheet, 'Telephone');
  const colUSD = findColumnIndex(sheet, 'USD');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  // Si c'est une vente complète avec items, créer une ligne par item
  if (payload.items && Array.isArray(payload.items)) {
    const results = [];
    for (const item of payload.items) {
      const result = handleSaleItemUpsert({
        ...item,
        invoice_number: payload.invoice_number,
        sold_at: payload.sold_at,
        client_name: payload.client_name,
        client_phone: payload.client_phone,
        seller_name: payload.seller_name,
        uuid: item.uuid || payload.uuid
      });
      results.push(result);
    }
    return { rows: results };
  }
  
  // Sinon, traiter comme une ligne simple
  return handleSaleItemUpsert(payload);
}

/**
 * Gère l'upsert d'un item de vente (une ligne dans Ventes)
 */
function handleSaleItemUpsert(payload) {
  const sheet = getSheet(SHEETS.VENTES);
  
  const colDate = findColumnIndex(sheet, 'Date');
  const colFacture = findColumnIndex(sheet, 'Numéro de facture');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colClient = findColumnIndex(sheet, 'client');
  const colQte = findColumnIndex(sheet, 'QTE');
  const colMark = findColumnIndex(sheet, 'MARK');
  const colPrixUnitaire = findColumnIndex(sheet, 'Prix unitaire');
  const colVendeur = findColumnIndex(sheet, 'Vendeur');
  const colModeStock = findColumnIndex(sheet, 'mode stock');
  const colTelephone = findColumnIndex(sheet, 'Telephone');
  const colUSD = findColumnIndex(sheet, 'USD');
  const colUuid = ensureColumn(sheet, '_uuid');
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Recherche par UUID ou clé composite
  let rowIndex = -1;
  const searchUuid = payload.uuid;
  const searchFacture = payload.invoice_number;
  const searchCode = payload.product_code;
  const searchQte = payload.qty;
  const searchPrix = payload.unit_price_fc;
  
  for (let i = 1; i < values.length; i++) {
    const rowUuid = colUuid > 0 ? values[i][colUuid - 1] : null;
    const rowFacture = colFacture > 0 ? values[i][colFacture - 1] : null;
    const rowCode = colCode > 0 ? values[i][colCode - 1] : null;
    const rowQte = colQte > 0 ? values[i][colQte - 1] : null;
    const rowPrix = colPrixUnitaire > 0 ? values[i][colPrixUnitaire - 1] : null;
    
    // Match par UUID (prioritaire)
    if (searchUuid && rowUuid === searchUuid) {
      rowIndex = i + 1;
      break;
    }
    // Match par clé composite
    if (rowFacture === searchFacture && rowCode === searchCode && 
        Math.abs(rowQte - searchQte) < 0.01 && Math.abs(rowPrix - searchPrix) < 0.01) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const maxCol = Math.max(colDate, colFacture, colCode, colClient, colQte, 
                          colMark, colPrixUnitaire, colVendeur, colModeStock, 
                          colTelephone, colUSD, colUuid);
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colDate > 0) rowData[colDate - 1] = payload.sold_at || new Date().toISOString();
  if (colFacture > 0) rowData[colFacture - 1] = payload.invoice_number || '';
  if (colCode > 0) rowData[colCode - 1] = payload.product_code || '';
  if (colClient > 0) rowData[colClient - 1] = payload.client_name || '';
  if (colQte > 0) rowData[colQte - 1] = payload.qty || 0;
  if (colMark > 0) rowData[colMark - 1] = payload.unit_mark || '';
  if (colPrixUnitaire > 0) rowData[colPrixUnitaire - 1] = payload.unit_price_fc || 0;
  if (colVendeur > 0) rowData[colVendeur - 1] = payload.seller_name || '';
  if (colModeStock > 0) rowData[colModeStock - 1] = payload.unit_level || '';
  if (colTelephone > 0) rowData[colTelephone - 1] = payload.client_phone || '';
  if (colUSD > 0) rowData[colUSD - 1] = payload.unit_price_usd || payload.subtotal_usd || 0;
  if (colUuid > 0) rowData[colUuid - 1] = searchUuid || '';
  
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
  }
  
  return { row: rowIndex };
}

/**
 * Gère l'upsert d'une dette
 */
function handleDebtUpsert(payload) {
  const sheet = getSheet(SHEETS.DETTES);
  
  ensureColumn(sheet, 'Client');
  ensureColumn(sheet, 'Produit');
  ensureColumn(sheet, 'Argent');
  ensureColumn(sheet, 'prix a payer');
  ensureColumn(sheet, 'prix payer deja');
  ensureColumn(sheet, 'reste');
  ensureColumn(sheet, 'date');
  ensureColumn(sheet, 'numero de facture');
  ensureColumn(sheet, 'Dollars');
  ensureColumn(sheet, 'objet\\Description');
  ensureColumn(sheet, 'Dettes Fc en usd');
  ensureColumn(sheet, '_uuid');
  
  const colClient = findColumnIndex(sheet, 'Client');
  const colProduit = findColumnIndex(sheet, 'Produit');
  const colArgent = findColumnIndex(sheet, 'Argent');
  const colPrixAPayer = findColumnIndex(sheet, 'prix a payer');
  const colPrixPaye = findColumnIndex(sheet, 'prix payer deja');
  const colReste = findColumnIndex(sheet, 'reste');
  const colDate = findColumnIndex(sheet, 'date');
  const colFacture = findColumnIndex(sheet, 'numero de facture');
  const colDollars = findColumnIndex(sheet, 'Dollars');
  const colDescription = findColumnIndex(sheet, 'objet\\Description');
  const colDettesFCUSD = findColumnIndex(sheet, 'Dettes Fc en usd');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Recherche par UUID ou clé composite
  let rowIndex = -1;
  const searchUuid = payload.uuid;
  const searchFacture = payload.invoice_number;
  const searchClient = payload.client_name;
  
  for (let i = 1; i < values.length; i++) {
    const rowUuid = colUuid > 0 ? values[i][colUuid - 1] : null;
    const rowFacture = colFacture > 0 ? values[i][colFacture - 1] : null;
    const rowClient = colClient > 0 ? values[i][colClient - 1] : null;
    
    if (searchUuid && rowUuid === searchUuid) {
      rowIndex = i + 1;
      break;
    }
    if (rowFacture === searchFacture && rowClient === searchClient) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const maxCol = Math.max(colClient, colProduit, colArgent, colPrixAPayer, 
                          colPrixPaye, colReste, colDate, colFacture, 
                          colDollars, colDescription, colDettesFCUSD, colUuid);
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colClient > 0) rowData[colClient - 1] = payload.client_name || '';
  if (colProduit > 0) rowData[colProduit - 1] = payload.product_description || '';
  if (colArgent > 0) rowData[colArgent - 1] = payload.total_fc || 0;
  if (colPrixAPayer > 0) rowData[colPrixAPayer - 1] = payload.total_fc || 0;
  if (colPrixPaye > 0) rowData[colPrixPaye - 1] = payload.paid_fc || 0;
  if (colReste > 0) rowData[colReste - 1] = payload.remaining_fc || 0;
  if (colDate > 0) rowData[colDate - 1] = payload.created_at || new Date().toISOString();
  if (colFacture > 0) rowData[colFacture - 1] = payload.invoice_number || '';
  if (colDollars > 0) rowData[colDollars - 1] = payload.total_usd || 0;
  if (colDescription > 0) rowData[colDescription - 1] = payload.product_description || payload.note || '';
  if (colDettesFCUSD > 0) rowData[colDettesFCUSD - 1] = payload.debt_fc_in_usd || 0;
  if (colUuid > 0) rowData[colUuid - 1] = searchUuid || '';
  
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
  }
  
  return { row: rowIndex };
}

/**
 * Gère l'upsert d'un paiement de dette
 */
function handleDebtPaymentUpsert(payload) {
  // Met à jour la dette parente
  return handleDebtUpsert(payload);
}

/**
 * Gère l'upsert d'un taux de change
 */
function handleRateUpsert(payload) {
  const sheet = getSheet(SHEETS.TAUX);
  
  ensureColumn(sheet, 'Taux');
  ensureColumn(sheet, 'USD');
  ensureColumn(sheet, 'Fc');
  ensureColumn(sheet, 'DATE');
  ensureColumn(sheet, '_uuid');
  
  const colTaux = findColumnIndex(sheet, 'Taux');
  const colUSD = findColumnIndex(sheet, 'USD');
  const colFC = findColumnIndex(sheet, 'Fc');
  const colDate = findColumnIndex(sheet, 'DATE');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Recherche par DATE + Taux ou UUID
  let rowIndex = -1;
  const searchUuid = payload.uuid;
  const searchDate = payload.effective_at || payload.created_at;
  const searchTaux = payload.rate_fc_per_usd;
  
  for (let i = 1; i < values.length; i++) {
    const rowUuid = colUuid > 0 ? values[i][colUuid - 1] : null;
    const rowDate = colDate > 0 ? values[i][colDate - 1] : null;
    const rowTaux = colTaux > 0 ? values[i][colTaux - 1] : null;
    
    if (searchUuid && rowUuid === searchUuid) {
      rowIndex = i + 1;
      break;
    }
    if (rowDate && rowTaux && 
        new Date(rowDate).getTime() === new Date(searchDate).getTime() &&
        Math.abs(rowTaux - searchTaux) < 0.01) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const rate = payload.rate_fc_per_usd || 2800;
  const maxCol = Math.max(colTaux, colUSD, colFC, colDate, colUuid);
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colTaux > 0) rowData[colTaux - 1] = rate;
  if (colUSD > 0) rowData[colUSD - 1] = 100; // Standard: 100 USD
  if (colFC > 0) rowData[colFC - 1] = rate * 100; // 100 USD en FC
  if (colDate > 0) rowData[colDate - 1] = searchDate || new Date().toISOString();
  if (colUuid > 0) rowData[colUuid - 1] = searchUuid || '';
  
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
  }
  
  return { row: rowIndex };
}

/**
 * Gère l'upsert d'un utilisateur
 */
function handleUserUpsert(payload) {
  const sheet = getSheet(SHEETS.COMPTER_UTILISATEUR);
  
  ensureColumn(sheet, 'Nom');
  ensureColumn(sheet, 'Mode passe');
  ensureColumn(sheet, 'Numero');
  ensureColumn(sheet, 'Valide');
  ensureColumn(sheet, 'date de creation du compter');
  ensureColumn(sheet, 'Token Expo Push');
  ensureColumn(sheet, 'marque');
  ensureColumn(sheet, 'Urlprofile');
  ensureColumn(sheet, 'admi');
  ensureColumn(sheet, '_uuid');
  
  const colNom = findColumnIndex(sheet, 'Nom');
  const colModePasse = findColumnIndex(sheet, 'Mode passe');
  const colNumero = findColumnIndex(sheet, 'Numero');
  const colValide = findColumnIndex(sheet, 'Valide');
  const colDateCreation = findColumnIndex(sheet, 'date de creation du compter');
  const colToken = findColumnIndex(sheet, 'Token Expo Push');
  const colMarque = findColumnIndex(sheet, 'marque');
  const colUrlProfile = findColumnIndex(sheet, 'Urlprofile');
  const colAdmi = findColumnIndex(sheet, 'admi');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Recherche par Numero (téléphone) ou UUID
  let rowIndex = -1;
  const searchUuid = payload.uuid;
  const searchNumero = payload.phone;
  const searchNom = payload.username;
  
  for (let i = 1; i < values.length; i++) {
    const rowUuid = colUuid > 0 ? values[i][colUuid - 1] : null;
    const rowNumero = colNumero > 0 ? values[i][colNumero - 1] : null;
    const rowNom = colNom > 0 ? values[i][colNom - 1] : null;
    
    if (searchUuid && rowUuid === searchUuid) {
      rowIndex = i + 1;
      break;
    }
    if (rowNumero === searchNumero || rowNom === searchNom) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const maxCol = Math.max(colNom, colModePasse, colNumero, colValide, 
                          colDateCreation, colToken, colMarque, colUrlProfile, colAdmi, colUuid);
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colNom > 0) rowData[colNom - 1] = payload.username || '';
  // Ne pas écrire le mot de passe en clair
  // if (colModePasse > 0) rowData[colModePasse - 1] = ''; 
  if (colNumero > 0) rowData[colNumero - 1] = payload.phone || '';
  if (colValide > 0) rowData[colValide - 1] = payload.is_active ? 1 : 0;
  if (colDateCreation > 0) rowData[colDateCreation - 1] = payload.created_at || new Date().toISOString();
  if (colToken > 0) rowData[colToken - 1] = payload.expo_push_token || '';
  if (colMarque > 0) rowData[colMarque - 1] = payload.device_brand || '';
  if (colUrlProfile > 0) rowData[colUrlProfile - 1] = payload.profile_url || '';
  if (colAdmi > 0) rowData[colAdmi - 1] = payload.is_admin ? 1 : 0;
  if (colUuid > 0) rowData[colUuid - 1] = searchUuid || '';
  
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
  }
  
  return { row: rowIndex };
}

/**
 * Gère l'upsert d'un log de prix
 */
function handlePriceLogUpsert(payload) {
  const sheet = getSheet(SHEETS.STOCK_PRIX);
  
  ensureColumn(sheet, 'Date');
  ensureColumn(sheet, 'Prix');
  ensureColumn(sheet, 'Numero du produit');
  ensureColumn(sheet, 'Total');
  ensureColumn(sheet, 'Numero de facture');
  ensureColumn(sheet, '_uuid');
  
  const colDate = findColumnIndex(sheet, 'Date');
  const colPrix = findColumnIndex(sheet, 'Prix');
  const colNumeroProduit = findColumnIndex(sheet, 'Numero du produit');
  const colTotal = findColumnIndex(sheet, 'Total');
  const colFacture = findColumnIndex(sheet, 'Numero de facture');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Recherche par UUID ou clé composite
  let rowIndex = -1;
  const searchUuid = payload.uuid;
  const searchDate = payload.at;
  const searchProduit = payload.product_code;
  const searchFacture = payload.invoice_number;
  const searchPrix = payload.unit_price_fc;
  
  for (let i = 1; i < values.length; i++) {
    const rowUuid = colUuid > 0 ? values[i][colUuid - 1] : null;
    const rowDate = colDate > 0 ? values[i][colDate - 1] : null;
    const rowProduit = colNumeroProduit > 0 ? values[i][colNumeroProduit - 1] : null;
    const rowFacture = colFacture > 0 ? values[i][colFacture - 1] : null;
    const rowPrix = colPrix > 0 ? values[i][colPrix - 1] : null;
    
    if (searchUuid && rowUuid === searchUuid) {
      rowIndex = i + 1;
      break;
    }
    if (rowDate && rowProduit && rowFacture && 
        new Date(rowDate).getTime() === new Date(searchDate).getTime() &&
        rowProduit === searchProduit && rowFacture === searchFacture &&
        Math.abs(rowPrix - searchPrix) < 0.01) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const maxCol = Math.max(colDate, colPrix, colNumeroProduit, colTotal, colFacture, colUuid);
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colDate > 0) rowData[colDate - 1] = searchDate || new Date().toISOString();
  if (colPrix > 0) rowData[colPrix - 1] = payload.unit_price_fc || 0;
  if (colNumeroProduit > 0) rowData[colNumeroProduit - 1] = payload.product_code || '';
  if (colTotal > 0) rowData[colTotal - 1] = payload.line_total_fc || 0;
  if (colFacture > 0) rowData[colFacture - 1] = payload.invoice_number || '';
  if (colUuid > 0) rowData[colUuid - 1] = searchUuid || '';
  
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
  }
  
  return { row: rowIndex };
}

/**
 * Récupère les produits modifiés depuis une date
 * Retourne TOUS les produits de toutes les feuilles si sinceDate est 1970-01-01 (import initial)
 */
function getProductsSince(sinceDate, entityType) {
  // Si c'est un import initial (sinceDate = 1970), on retourne TOUS les produits
  const isInitialImport = sinceDate.getTime() < new Date('2000-01-01').getTime();
  
  const sheetNames = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
  const results = [];
  const productsByCode = {}; // Grouper par code produit
  
  for (const sheetName of sheetNames) {
    const sheet = getSheet(sheetName);
    if (!sheet) continue;
    
    const colDateUpdate = findColumnIndex(sheet, 'Date de dernière mise à jour');
    const colCode = findColumnIndex(sheet, 'Code produit');
    const colNom = findColumnIndex(sheet, 'Nom du produit');
    const colStockInit = findColumnIndex(sheet, 'Stock initial');
    const colPrixAchatUSD = findColumnIndex(sheet, 'Prix d\'achat (USD)');
    const colPrixVenteFC = findColumnIndex(sheet, 'Prix de vente (FC)');
    const colPrixVenteDetailFC = findColumnIndex(sheet, 'Prix de vente détail (FC)');
    const colMark = findColumnIndex(sheet, 'Mark');
    const colAutoStock = findColumnIndex(sheet, 'Automatisation Stock');
    const colPrixVenteUSD = findColumnIndex(sheet, 'Prix ventes (USD)');
    const colUuid = findColumnIndex(sheet, '_uuid');
    
    if (colCode === -1) continue; // Pas de colonne Code produit
    
    // Optimisation : utiliser getLastRow() pour éviter de lire toutes les colonnes vides
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    if (lastRow <= 1) continue; // Pas de données (seulement l'en-tête)
    
    // Lire seulement les lignes de données (plus rapide que getDataRange qui lit toutes les colonnes vides)
    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    
    const unitLevel = sheetName === SHEETS.CARTON ? 'CARTON' : 
                     sheetName === SHEETS.MILLIERS ? 'MILLIER' : 'PIECE';
    
    for (let i = 0; i < values.length; i++) {
      const codeValue = colCode > 0 ? values[i][colCode - 1] : '';
      const code = codeValue ? String(codeValue).trim() : '';
      if (!code) continue; // Ignorer les lignes vides
      
      // Optimisation: ne convertir la date que si nécessaire (pas d'import initial)
      let dateUpdate = null;
      if (!isInitialImport && colDateUpdate > 0) {
        const dateValue = values[i][colDateUpdate - 1];
        if (dateValue) {
          // Si c'est déjà un objet Date, l'utiliser directement
          if (dateValue instanceof Date) {
            dateUpdate = dateValue;
          } else if (typeof dateValue === 'string' && dateValue.length > 0) {
            // Essayer de convertir seulement si c'est une chaîne non vide
            try {
              const parsedDate = new Date(dateValue);
              if (!isNaN(parsedDate.getTime())) {
                dateUpdate = parsedDate;
              }
            } catch (e) {
              // Ignorer les erreurs de conversion
            }
          } else if (typeof dateValue === 'number') {
            // Si c'est un nombre (timestamp Sheets)
            dateUpdate = new Date(dateValue);
          }
          
          // Si import incrémental, vérifier la date maintenant
          if (dateUpdate && dateUpdate < sinceDate) {
            continue;
          }
        }
      }
      
      // Créer ou mettre à jour l'entrée produit
      if (!productsByCode[code]) {
        const nomValue = colNom > 0 ? values[i][colNom - 1] : '';
        const nom = nomValue ? String(nomValue).trim() : '';
        productsByCode[code] = {
          uuid: colUuid > 0 ? values[i][colUuid - 1] || null : null,
          code: code,
          name: nom,
          units: []
        };
      }
      
      // Optimisation: créer l'objet unité avec moins d'opérations
      const stockValue = colStockInit > 0 ? values[i][colStockInit - 1] : 0;
      const stock = parseFloat(stockValue) || 0;
      const prixVenteFC = colPrixVenteDetailFC > 0 ? values[i][colPrixVenteDetailFC - 1] : 
                         (colPrixVenteFC > 0 ? values[i][colPrixVenteFC - 1] : 0);
      
      const unitData = {
        uuid: colUuid > 0 ? values[i][colUuid - 1] || null : null,
        unit_level: unitLevel,
        unit_mark: colMark > 0 ? (values[i][colMark - 1] ? String(values[i][colMark - 1]).trim() : '') : '',
        stock_initial: stock,
        stock_current: stock,
        purchase_price_usd: colPrixAchatUSD > 0 ? (parseFloat(values[i][colPrixAchatUSD - 1]) || 0) : 0,
        sale_price_fc: parseFloat(prixVenteFC) || 0,
        sale_price_usd: colPrixVenteUSD > 0 ? (parseFloat(values[i][colPrixVenteUSD - 1]) || 0) : 0,
        auto_stock_factor: colAutoStock > 0 ? (parseFloat(values[i][colAutoStock - 1]) || 1) : 1,
        qty_step: 1,
        last_update: dateUpdate ? dateUpdate.toISOString() : new Date().toISOString(),
        _origin: 'SHEETS',
        _syncedAt: new Date().toISOString()
      };
      
      productsByCode[code].units.push(unitData);
      
      // Mettre à jour le nom si vide
      if (!productsByCode[code].name && colNom > 0) {
        const nomValue = values[i][colNom - 1];
        if (nomValue) {
          productsByCode[code].name = String(nomValue).trim();
        }
      }
    }
  }
  
  // Convertir en format attendu par le client
  const productCount = Object.keys(productsByCode).length;
  let totalUnits = 0;
  for (const code in productsByCode) {
    totalUnits += productsByCode[code].units.length;
  }
  
  if (entityType === 'product_units') {
    // Retourner seulement les unités
    const unitsList = [];
    for (const code in productsByCode) {
      for (const unit of productsByCode[code].units) {
        unitsList.push({
          ...unit,
          code: productsByCode[code].code,
          name: productsByCode[code].name
        });
      }
    }
    return unitsList;
  } else {
    // Retourner les produits avec leurs unités
    return Object.values(productsByCode);
  }
}

/**
 * Récupère les ventes modifiées depuis une date
 * Retourne les items de vente groupés par facture
 */
function getSalesSince(sinceDate) {
  const sheet = getSheet(SHEETS.VENTES);
  const colDate = findColumnIndex(sheet, 'Date');
  const isInitialImport = sinceDate.getTime() < new Date('2000-01-01').getTime();
  
  if (colDate === -1) return [];
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const results = [];
  
  const colFacture = findColumnIndex(sheet, 'Numéro de facture');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colClient = findColumnIndex(sheet, 'client');
  const colQte = findColumnIndex(sheet, 'QTE');
  const colMark = findColumnIndex(sheet, 'MARK');
  const colPrixUnitaire = findColumnIndex(sheet, 'Prix unitaire');
  const colVendeur = findColumnIndex(sheet, 'Vendeur');
  const colModeStock = findColumnIndex(sheet, 'mode stock');
  const colTelephone = findColumnIndex(sheet, 'Telephone');
  const colUSD = findColumnIndex(sheet, 'USD');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  for (let i = 1; i < values.length; i++) {
    const dateVente = values[i][colDate - 1];
    const invoiceNumber = colFacture > 0 ? values[i][colFacture - 1] : '';
    
    // Ignorer les lignes sans facture ou date
    if (!invoiceNumber || invoiceNumber.toString().trim() === '') continue;
    if (!dateVente) continue;
    
    // Vérifier la date si ce n'est pas un import initial
    if (!isInitialImport && new Date(dateVente) < sinceDate) {
      continue;
    }
    
    const item = {
      uuid: colUuid > 0 ? values[i][colUuid - 1] : null,
      invoice_number: invoiceNumber,
      sold_at: dateVente instanceof Date ? dateVente.toISOString() : (typeof dateVente === 'string' ? dateVente : new Date(dateVente).toISOString()),
      product_code: colCode > 0 ? (values[i][colCode - 1] || '') : '',
      product_name: '', // Sera rempli depuis les produits
      client_name: colClient > 0 ? (values[i][colClient - 1] || '') : '',
      client_phone: colTelephone > 0 ? (values[i][colTelephone - 1] || '') : '',
      qty: colQte > 0 ? (parseFloat(values[i][colQte - 1]) || 0) : 0,
      qty_label: colQte > 0 ? (values[i][colQte - 1] ? values[i][colQte - 1].toString() : '0') : '0',
      unit_mark: colMark > 0 ? (values[i][colMark - 1] || '') : '',
      unit_level: colModeStock > 0 ? (values[i][colModeStock - 1] || 'PIECE') : 'PIECE',
      unit_price_fc: colPrixUnitaire > 0 ? (parseFloat(values[i][colPrixUnitaire - 1]) || 0) : 0,
      subtotal_fc: 0, // Sera calculé
      unit_price_usd: colUSD > 0 ? (parseFloat(values[i][colUSD - 1]) || 0) : 0,
      subtotal_usd: 0, // Sera calculé
      seller_name: colVendeur > 0 ? (values[i][colVendeur - 1] || '') : '',
      _origin: 'SHEETS',
      _syncedAt: new Date().toISOString()
    };
    
    // Calculer les subtotaux
    item.subtotal_fc = item.qty * item.unit_price_fc;
    item.subtotal_usd = item.qty * item.unit_price_usd;
    
    results.push(item);
  }
  
  return results;
}

/**
 * Récupère les dettes modifiées depuis une date
 */
function getDebtsSince(sinceDate) {
  const sheet = getSheet(SHEETS.DETTES);
  const colDate = findColumnIndex(sheet, 'date');
  const isInitialImport = sinceDate.getTime() < new Date('2000-01-01').getTime();
  
  if (colDate === -1) return [];
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const results = [];
  
  const colClient = findColumnIndex(sheet, 'Client');
  const colProduit = findColumnIndex(sheet, 'Produit');
  const colPrixAPayer = findColumnIndex(sheet, 'prix a payer');
  const colPrixPaye = findColumnIndex(sheet, 'prix payer deja');
  const colReste = findColumnIndex(sheet, 'reste');
  const colFacture = findColumnIndex(sheet, 'numero de facture');
  const colDollars = findColumnIndex(sheet, 'Dollars');
  const colDescription = findColumnIndex(sheet, 'objet\\Description');
  const colDettesFCUSD = findColumnIndex(sheet, 'Dettes Fc en usd');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  for (let i = 1; i < values.length; i++) {
    const dateDette = values[i][colDate - 1];
    if (!dateDette) continue;
    
    // Vérifier la date si ce n'est pas un import initial
    if (!isInitialImport && new Date(dateDette) < sinceDate) {
      continue;
    }
    
    const totalFC = colPrixAPayer > 0 ? (parseFloat(values[i][colPrixAPayer - 1]) || 0) : 0;
    const paidFC = colPrixPaye > 0 ? (parseFloat(values[i][colPrixPaye - 1]) || 0) : 0;
    const remainingFC = colReste > 0 ? (parseFloat(values[i][colReste - 1]) || 0) : (totalFC - paidFC);
    
    // Déterminer le statut
    let status = 'open';
    if (remainingFC <= 0) {
      status = 'closed';
    } else if (paidFC > 0) {
      status = 'partial';
    }
    
    results.push({
      uuid: colUuid > 0 ? values[i][colUuid - 1] : null,
      client_name: colClient > 0 ? (values[i][colClient - 1] || '') : '',
      product_description: colProduit > 0 ? (values[i][colProduit - 1] || '') : '',
      total_fc: totalFC,
      paid_fc: paidFC,
      remaining_fc: remainingFC,
      invoice_number: colFacture > 0 ? (values[i][colFacture - 1] || '') : '',
      total_usd: colDollars > 0 ? (parseFloat(values[i][colDollars - 1]) || 0) : 0,
      debt_fc_in_usd: colDettesFCUSD > 0 ? (parseFloat(values[i][colDettesFCUSD - 1]) || 0) : 0,
      note: colDescription > 0 ? (values[i][colDescription - 1] || '') : '',
      status: status,
      created_at: dateDette instanceof Date ? dateDette.toISOString() : (typeof dateDette === 'string' ? dateDette : new Date(dateDette).toISOString()),
      _origin: 'SHEETS',
      _syncedAt: new Date().toISOString()
    });
  }
  
  return results;
}

/**
 * Récupère les taux modifiés depuis une date
 * Retourne le taux le plus récent si plusieurs
 */
function getRatesSince(sinceDate) {
  const sheet = getSheet(SHEETS.TAUX);
  const colDate = findColumnIndex(sheet, 'DATE');
  const isInitialImport = sinceDate.getTime() < new Date('2000-01-01').getTime();
  
  if (colDate === -1) return [];
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const results = [];
  
  const colTaux = findColumnIndex(sheet, 'Taux');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  // Pour les taux, on prend le plus récent
  let latestRate = null;
  let latestDate = null;
  
  for (let i = 1; i < values.length; i++) {
    const dateTaux = values[i][colDate - 1];
    if (!dateTaux) continue;
    
    // Vérifier la date si ce n'est pas un import initial
    if (!isInitialImport && new Date(dateTaux) < sinceDate) {
      continue;
    }
    
    const rate = colTaux > 0 ? (parseFloat(values[i][colTaux - 1]) || 2800) : 2800;
    const dateObj = dateTaux instanceof Date ? dateTaux : new Date(dateTaux);
    
    if (!latestDate || dateObj > latestDate) {
      latestDate = dateObj;
      latestRate = {
        uuid: colUuid > 0 ? values[i][colUuid - 1] : null,
        rate_fc_per_usd: rate,
        effective_at: dateObj.toISOString(),
        _origin: 'SHEETS',
        _syncedAt: new Date().toISOString()
      };
    }
  }
  
  if (latestRate) {
    results.push(latestRate);
  }
  
  return results;
}

/**
 * Récupère les utilisateurs modifiés depuis une date
 */
function getUsersSince(sinceDate) {
  const sheet = getSheet(SHEETS.COMPTER_UTILISATEUR);
  const colDateCreation = findColumnIndex(sheet, 'date de creation du compter');
  if (colDateCreation === -1) return [];
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const results = [];
  
  for (let i = 1; i < values.length; i++) {
    const dateCreation = values[i][colDateCreation - 1];
    if (dateCreation && new Date(dateCreation) >= sinceDate) {
      const colNom = findColumnIndex(sheet, 'Nom');
      const colNumero = findColumnIndex(sheet, 'Numero');
      const colValide = findColumnIndex(sheet, 'Valide');
      const colAdmi = findColumnIndex(sheet, 'admi');
      const colUuid = findColumnIndex(sheet, '_uuid');
      
      results.push({
        uuid: colUuid > 0 ? values[i][colUuid - 1] : null,
        username: colNom > 0 ? values[i][colNom - 1] : '',
        phone: colNumero > 0 ? values[i][colNumero - 1] : '',
        is_active: colValide > 0 ? (values[i][colValide - 1] == 1) : true,
        is_admin: colAdmi > 0 ? (values[i][colAdmi - 1] == 1) : false,
        created_at: dateCreation,
        _origin: 'SHEETS',
        _syncedAt: new Date().toISOString()
      });
    }
  }
  
  return results;
}

/**
 * Fonction utilitaire pour tester la connexion
 */
function testConnection() {
  try {
    const ss = getSpreadsheet();
    return {
      success: true,
      name: ss.getName(),
      id: ss.getId()
    };
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}
