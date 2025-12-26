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

// Helpers PRO pour mode batch
const DEBUG = false; // mettre true seulement pour debug local (sinon ralentit)

function logDebug(...args) { 
  if (DEBUG) console.log(...args); 
}

function nowIso() {
  return new Date().toISOString();
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeParseJson(str, fallback = null) {
  try { 
    return JSON.parse(str); 
  } catch(e) { 
    return fallback; 
  }
}

/**
 * Convertit une valeur en nombre (gère virgule comme séparateur décimal)
 */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).replace(/\s/g, '').replace(/,/g, '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Convertit une valeur en Date (gère formats FR dd/mm/yyyy et ISO)
 */
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    // Vérifier que la date est valide
    return isNaN(v.getTime()) ? null : v;
  }
  if (typeof v === 'number') {
    const dt = new Date(v);
    return isNaN(dt.getTime()) ? null : dt;
  }
  
  const s = String(v).trim();
  if (!s || s === '') return null;
  
  // Essayer d'abord le format ISO (2025-11-20T10:44:58.918Z)
  // Le constructeur Date() gère déjà ce format correctement
  const dtIso = new Date(s);
  if (!isNaN(dtIso.getTime())) {
    return dtIso;
  }
  
  // Format FR: dd/mm/yyyy ou dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    let y = parseInt(m[3], 10);
    if (y < 100) y = 2000 + y;
    const dtFr = new Date(y, mo, d);
    return isNaN(dtFr.getTime()) ? null : dtFr;
  }
  
  // Dernier essai avec le constructeur Date standard
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Assure colonnes techniques (_uuid, _updated_at, _device_id)
 */
function ensureTechColumns(sheet) {
  ensureColumn(sheet, '_uuid');
  ensureColumn(sheet, '_updated_at');
  ensureColumn(sheet, '_device_id');
  // ensureColumn(sheet, '_deleted_at'); // si vous voulez gérer delete plus tard
}

/**
 * Obtient le spreadsheet
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Obtient une feuille par nom (crée si n'existe pas)
 * Gère la casse mixte (majuscule + minuscule) pour correspondre exactement aux noms dans Sheets
 */
function getSheet(sheetName) {
  const ss = getSpreadsheet();
  
  // Chercher d'abord avec le nom exact (casse mixte)
  let sheet = ss.getSheetByName(sheetName);
  
  // Si non trouvé, chercher en ignorant la casse (pour compatibilité)
  if (!sheet) {
    const allSheets = ss.getSheets();
    for (let i = 0; i < allSheets.length; i++) {
      if (allSheets[i].getName().toLowerCase() === sheetName.toLowerCase()) {
        sheet = allSheets[i];
        console.log(`⚠️ Feuille trouvée avec casse différente: "${allSheets[i].getName()}" au lieu de "${sheetName}"`);
        break;
      }
    }
  }
  
  // Si toujours pas trouvé, créer la feuille avec le nom exact (casse mixte)
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    console.log(`✅ Nouvelle feuille créée: "${sheetName}"`);
  }
  
  return sheet;
}

/**
 * Trouve l'index d'une colonne par son nom d'en-tête
 * Retourne -1 si non trouvé
 */
function findColumnIndex(sheet, headerName) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol || lastCol < 1) return -1;
  
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
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
 * Trigger onEdit : met à jour _updated_at automatiquement quand une ligne est modifiée
 * IMPORTANT: Créer un trigger installable dans Apps Script:
 * Triggers → Add Trigger → onEdit → "From spreadsheet" → "On edit"
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const row = e.range.getRow();
    if (row <= 1) return; // ignore header
    
    // Mettre _updated_at sur la ligne modifiée
    ensureTechColumns(sheet);
    const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
    if (colUpdatedAt > 0) {
      sheet.getRange(row, colUpdatedAt).setValue(nowIso());
    }
  } catch (err) {
    // ne pas casser l'édition utilisateur
    logDebug('onEdit error:', err);
  }
}

/**
 * ENDPOINT: Push depuis local vers Sheets
 * POST avec body: { entity, entity_id, op, payload } OU { action: 'batchPush', ops: [...] }
 * Sécurité: { key: 'API_KEY' } (optionnel, vérifier si configuré)
 */
function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const data = safeParseJson(body, {});
    
    // Sécurité: Vérifier API key si configuré
    const apiKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (apiKey && data.key !== apiKey) {
      return jsonOut({ success: false, error: 'API key invalide', server_time: nowIso() });
    }
    
    const action = (data.action || '').toString().trim().toLowerCase();
    
    // Mode batchPush (PRO)
    if (action === 'batchpush') {
      return handleBatchPush(data);
    }
    
    // Compatibilité ancienne: { entity, entity_id, op, payload }
    const entityRaw = data.entity || '';
    const entity = entityRaw.toString().trim().toLowerCase();
    const { entity_id, op, payload } = data;
    
    logDebug('doPost entity:', entity);
    
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
        console.error('❌ Entity inconnue dans doPost:', entityRaw);
        return jsonOut({
          success: false,
          error: 'Entity inconnue: ' + entityRaw,
          server_time: nowIso()
        });
    }
    
    return jsonOut({
      success: true,
      result: result,
      remote_version: nowIso(),
      server_time: nowIso()
    });
    
  } catch (error) {
    return jsonOut({
      success: false,
      error: error.toString(),
      server_time: nowIso()
    });
  }
}

/**
 * ENDPOINT: Pull depuis Sheets vers local
 * GET avec query: ?entity=...&since=... OU ?action=batchPull&since={...}
 * Mode PRO: ?entity=...&full=1&cursor=...&limit=... (pagination)
 * Sécurité: ?key=API_KEY (optionnel, vérifier si configuré)
 */
function doGet(e) {
  try {
    e = e || { parameter: {} };
    const p = e.parameter || {};
    
    // Sécurité: Vérifier API key si configuré
    const apiKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (apiKey && p.key !== apiKey) {
      console.error('❌ [doGet] API key invalide');
      return jsonOut({ success: false, error: 'API key invalide', server_time: nowIso() });
    }
    
    const action = (p.action || '').toString().trim().toLowerCase();
    
    // Ping rapide pour check internet côté Node
    if (action === 'test') {
      return jsonOut({ success: true, server_time: nowIso() });
    }
    
    // Mode batchPull (PRO)
    if (action === 'batchpull') {
      return handleBatchPull(p);
    }
    
    // Mode PRO: Pagination (full=1, cursor, limit) - TOUJOURS utiliser pour products/sales/debts
    const entityRaw = p.entity || '';
    const entity = entityRaw.toString().trim().toLowerCase();
    const full = (p.full === '1' || p.force === '1');
    const since = p.since;
    const limit = Math.min(parseInt(p.limit || '300', 10) || 300, 500); // max 500
    const cursor = parseInt(p.cursor || '2', 10) || 2; // Défaut: ligne 2 (après header)
    
    console.log('📥 [doGet] Requête:', { entity, full, since, cursor, limit });
    
    if (!entity) {
      return jsonOut({
        success: false,
        error: 'Paramètre entity requis',
        server_time: nowIso()
      });
    }
    
    const sinceDate = full ? new Date(0) : (since ? new Date(since) : new Date(0));
    console.log('📅 [doGet] Date since:', sinceDate.toISOString(), '| Full:', full);
    
    let out;
    const startTime = new Date();
    
    switch (entity) {
      case 'products':
      case 'product_units':
        console.log(`📦 [${entity.toUpperCase()}] Récupération produits (mode paginé PRO)...`);
        // TOUJOURS utiliser pagination pour products (évite timeout)
        out = getProductsPage(sinceDate, cursor, limit, p.unit_level || '');
        console.log('✅ [PRODUCTS] Produits récupérés:', out.data?.length || 0, '| Done:', out.done, '| Next cursor:', out.next_cursor);
        break;
      case 'sales':
        console.log('💰 [SALES] Récupération ventes (mode paginé PRO)...');
        console.log('📅 [SALES] Paramètres: sinceDate=', sinceDate, '| cursor=', cursor, '| limit=', limit, '| full=', full);
        // TOUJOURS utiliser pagination pour sales (évite timeout)
        // Passer sinceDate comme Date (pas string) pour getSalesPage
        const salesSinceDate = full ? new Date(0) : sinceDate;
        console.log('📅 [SALES] sinceDate pour getSalesPage:', salesSinceDate.toISOString(), '| getTime():', salesSinceDate.getTime());
        out = getSalesPage(salesSinceDate, cursor, limit);
        console.log('✅ [SALES] Ventes récupérées:', out.data?.length || 0, '| Done:', out.done, '| Next cursor:', out.next_cursor);
        if (out.data && out.data.length === 0) {
          console.log('⚠️ [SALES] Aucune vente retournée - Vérifier que la feuille "Ventes" contient des données');
        }
        break;
      case 'debts':
        console.log('💳 [DEBTS] Récupération dettes (mode paginé PRO)...');
        // TOUJOURS utiliser pagination pour debts (évite timeout)
        out = getDebtsPage(sinceDate, cursor, limit);
        console.log('✅ [DEBTS] Dettes récupérées:', out.data?.length || 0, '| Done:', out.done, '| Next cursor:', out.next_cursor);
        break;
      case 'rates':
        console.log('💱 [RATES] Récupération taux...');
        const ratesResult = getRatesSince(sinceDate);
        out = { data: ratesResult, next_cursor: null, done: true };
        console.log('✅ [RATES] Taux récupérés:', ratesResult.length);
        break;
      case 'users':
        console.log('👥 [USERS] Récupération utilisateurs...');
        const usersResult = getUsersSince(sinceDate);
        out = { data: usersResult, next_cursor: null, done: true };
        console.log('✅ [USERS] Utilisateurs récupérés:', usersResult.length);
        break;
      default:
        console.error('❌ [doGet] Entity inconnue:', entityRaw);
        return jsonOut({
          success: false,
          error: 'Entity inconnue: ' + entityRaw,
          server_time: nowIso()
        });
    }
    
    const duration = new Date() - startTime;
    console.log('⏱️ [doGet] Durée totale:', duration, 'ms');
    console.log('📊 [doGet] Résultat final: count =', out.data?.length || 0);
    
    return jsonOut({
      success: true,
      data: out.data || [],
      count: (out.data || []).length,
      next_cursor: out.next_cursor ?? null,
      done: !!out.done,
      server_time: nowIso()
    });
    
  } catch (error) {
    console.error('❌ Erreur doGet:', error.toString());
    console.error('Stack:', error.stack);
    return jsonOut({
      success: false,
      error: error.toString(),
      server_time: nowIso()
    });
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
  ensureColumn(sheet, 'Unite');
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
  const colUnite = findColumnIndex(sheet, 'Unite');
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
  const colUnite = findColumnIndex(sheet, 'Unite');
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
                          colMark, colPrixUnitaire, colUnite, colVendeur, colModeStock, 
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
  if (colUnite > 0) rowData[colUnite - 1] = payload.unit_level || '';
  if (colVendeur > 0) rowData[colVendeur - 1] = payload.seller_name || '';
  if (colModeStock > 0) rowData[colModeStock - 1] = payload.unit_level || ''; // Garder pour compatibilité
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
  // Ne pas écrire le mot de passe en clair (sécurité)
  // if (colModePasse > 0) rowData[colModePasse - 1] = ''; 
  if (colNumero > 0) rowData[colNumero - 1] = payload.phone || '';
  if (colValide > 0) rowData[colValide - 1] = payload.is_active ? 1 : 0;
  if (colDateCreation > 0) rowData[colDateCreation - 1] = payload.created_at || new Date().toISOString();
  if (colToken > 0) rowData[colToken - 1] = payload.expo_push_token || '';
  if (colMarque > 0) rowData[colMarque - 1] = payload.device_brand || '';
  // CRITIQUE: PRÉSERVER l'URL existante si payload.profile_url est vide
  if (colUrlProfile > 0) {
    const existingUrl = rowIndex > 0 ? (values[rowIndex - 1][colUrlProfile - 1] || '') : '';
    rowData[colUrlProfile - 1] = payload.profile_url || existingUrl || '';
  }
  if (colAdmi > 0) rowData[colAdmi - 1] = payload.is_admin ? 1 : 0;
  // CRITIQUE: PRÉSERVER l'UUID existant si payload.uuid est vide
  if (colUuid > 0) {
    const existingUuid = rowIndex > 0 ? (values[rowIndex - 1][colUuid - 1] || '') : '';
    rowData[colUuid - 1] = searchUuid || existingUuid || '';
  }
  
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
  
  logDebug('📦 getProductsSince - Début');
  logDebug('   Import initial:', isInitialImport);
  logDebug('   Date since:', sinceDate.toISOString());
  logDebug('   Entity type:', entityType);
  
  const sheetNames = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
  const results = [];
  const productsByCode = {}; // Grouper par code produit
  
  for (const sheetName of sheetNames) {
    logDebug('📄 Traitement feuille:', sheetName);
    const sheet = getSheet(sheetName);
    if (!sheet) {
      logDebug('   ⚠️ Feuille non trouvée:', sheetName);
      continue;
    }
    
    ensureTechColumns(sheet);
    const colDateUpdate = findColumnIndex(sheet, 'Date de dernière mise à jour');
    const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
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
    
    logDebug('   Colonnes trouvées:', {
      Code: colCode,
      Nom: colNom,
      Stock: colStockInit,
      PrixAchatUSD: colPrixAchatUSD,
      PrixVenteFC: colPrixVenteFC,
      PrixVenteDetailFC: colPrixVenteDetailFC,
      Mark: colMark,
      AutoStock: colAutoStock,
      PrixVenteUSD: colPrixVenteUSD
    });
    
    if (colCode === -1) {
      logDebug('   ⚠️ Pas de colonne Code produit, feuille ignorée');
      continue; // Pas de colonne Code produit
    }
    
    // Optimisation : utiliser getLastRow() pour éviter de lire toutes les colonnes vides
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    logDebug('   Lignes de données:', lastRow - 1, 'Colonnes:', lastCol);
    
    if (lastRow <= 1) {
      logDebug('   ⚠️ Pas de données (seulement en-tête)');
      continue; // Pas de données (seulement l'en-tête)
    }
    
    // Lire seulement les lignes de données (plus rapide que getDataRange qui lit toutes les colonnes vides)
    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    
    const unitLevel = sheetName === SHEETS.CARTON ? 'CARTON' : 
                     sheetName === SHEETS.MILLIERS ? 'MILLIER' : 'PIECE';
    
    logDebug('   Niveau unité:', unitLevel);
    logDebug('   Nombre de lignes à traiter:', values.length);
    
    let processedCount = 0;
    let skippedCount = 0;
    
    for (let i = 0; i < values.length; i++) {
      const codeValue = colCode > 0 ? values[i][colCode - 1] : '';
      const code = codeValue ? String(codeValue).trim() : '';
      if (!code) {
        skippedCount++;
        continue; // Ignorer les lignes vides
      }
      
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
      
      // PRO: Calculer refDate pour _remote_updated_at (CORRECTION CRITIQUE)
      const refVal = (colUpdatedAt > 0) ? values[i][colUpdatedAt - 1] : 
                     (colDateUpdate > 0 ? values[i][colDateUpdate - 1] : null);
      const refDate = toDate(refVal) || new Date();
      
      // Optimisation: créer l'objet unité avec moins d'opérations
      const stock = toNumber(colStockInit > 0 ? values[i][colStockInit - 1] : 0);
      const prixVenteFC = colPrixVenteDetailFC > 0 ? values[i][colPrixVenteDetailFC - 1] : 
                         (colPrixVenteFC > 0 ? values[i][colPrixVenteFC - 1] : 0);
      
      const unitData = {
        uuid: colUuid > 0 ? values[i][colUuid - 1] || null : null,
        unit_level: unitLevel,
        unit_mark: colMark > 0 ? (values[i][colMark - 1] ? String(values[i][colMark - 1]).trim() : '') : '',
        stock_initial: stock,
        stock_current: stock,
        purchase_price_usd: toNumber(colPrixAchatUSD > 0 ? values[i][colPrixAchatUSD - 1] : 0),
        sale_price_fc: toNumber(prixVenteFC),
        sale_price_usd: toNumber(colPrixVenteUSD > 0 ? values[i][colPrixVenteUSD - 1] : 0),
        auto_stock_factor: toNumber(colAutoStock > 0 ? values[i][colAutoStock - 1] : 0) || 1,
        qty_step: 1,
        last_update: refDate.toISOString(),
        _origin: 'SHEETS',
        _syncedAt: new Date().toISOString(),
        _remote_updated_at: refDate.toISOString()
      };
      
      productsByCode[code].units.push(unitData);
      processedCount++;
      
      // Mettre à jour le nom si vide
      if (!productsByCode[code].name && colNom > 0) {
        const nomValue = values[i][colNom - 1];
        if (nomValue) {
          productsByCode[code].name = String(nomValue).trim();
        }
      }
    }
    
    console.log('   ✅ Feuille', sheetName, 'traitée:', processedCount, 'produits,', skippedCount, 'lignes ignorées');
  }
  
  console.log('📊 Total produits uniques:', Object.keys(productsByCode).length);
  
  // Convertir en format attendu par le client
  const productCount = Object.keys(productsByCode).length;
  let totalUnits = 0;
  for (const code in productsByCode) {
    totalUnits += productsByCode[code].units.length;
  }
  
  console.log('📦 Total unités:', totalUnits);
  console.log('✅ getProductsSince - Terminé');
  
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
    logDebug('📤 Retour de', unitsList.length, 'unités');
    return unitsList;
  } else {
    // Retourner les produits avec leurs unités
    const productsList = Object.values(productsByCode);
    logDebug('📤 Retour de', productsList.length, 'produits');
    return productsList;
  }
}

/**
 * Récupère les ventes modifiées depuis une date
 * Retourne les items de vente groupés par facture
 */
function getSalesSince(sinceDate) {
  const sheet = getSheet(SHEETS.VENTES);
  ensureTechColumns(sheet);
  const colDate = findColumnIndex(sheet, 'Date');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  const isInitialImport = sinceDate.getTime() < new Date('2000-01-01').getTime();
  
  if (colDate === -1) return [];
  
  const results = [];
  const colFacture = findColumnIndex(sheet, 'Numéro de facture');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colClient = findColumnIndex(sheet, 'client');
  const colQte = findColumnIndex(sheet, 'QTE');
  const colMark = findColumnIndex(sheet, 'MARK');
  const colPrixUnitaire = findColumnIndex(sheet, 'Prix unitaire');
  const colUnite = findColumnIndex(sheet, 'Unite');
  const colVendeur = findColumnIndex(sheet, 'Vendeur');
  const colModeStock = findColumnIndex(sheet, 'mode stock');
  const colTelephone = findColumnIndex(sheet, 'Telephone');
  const colUSD = findColumnIndex(sheet, 'USD');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  logDebug('💰 getSalesSince - Début');
  logDebug('   Import initial:', isInitialImport);
  logDebug('   Date since:', sinceDate.toISOString());
  logDebug('   Colonnes trouvées:', {
    Date: colDate,
    Facture: colFacture,
    Code: colCode,
    Client: colClient,
    QTE: colQte,
    MARK: colMark,
    PrixUnitaire: colPrixUnitaire,
    Unite: colUnite,
    Vendeur: colVendeur,
    ModeStock: colModeStock,
    Telephone: colTelephone,
    USD: colUSD
  });
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  logDebug('   Lignes de données:', lastRow - 1, 'Colonnes:', lastCol);
  
  if (lastRow <= 1) {
    logDebug('   ⚠️ Pas de données (seulement en-tête)');
    return [];
  }
  
  // Lire seulement les lignes de données
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  logDebug('   Nombre de lignes à traiter:', values.length);
  
  let processedCount = 0;
  let skippedCount = 0;
  
  for (let i = 0; i < values.length; i++) {
    const invoiceNumber = colFacture > 0 ? values[i][colFacture - 1] : '';
    
    // Ignorer les lignes sans facture
    if (!invoiceNumber || invoiceNumber.toString().trim() === '') {
      skippedCount++;
      continue;
    }
    
    // Utiliser _updated_at si présent, sinon fallback sur Date
    const refVal = (colUpdatedAt > 0) ? values[i][colUpdatedAt - 1] : values[i][colDate - 1];
    const refDate = toDate(refVal);
    
    if (!refDate) {
      skippedCount++;
      continue;
    }
    
    // Vérifier la date si ce n'est pas un import initial
    if (!isInitialImport && refDate < sinceDate) {
      skippedCount++;
      continue;
    }
    
    const dateVente = values[i][colDate - 1];
    
    // Convertir la quantité (gérer les virgules comme séparateur décimal)
    let qtyValue = colQte > 0 ? values[i][colQte - 1] : 0;
    let qty = 0;
    if (qtyValue) {
      // Convertir virgule en point pour parseFloat
      const qtyStr = qtyValue.toString().replace(',', '.');
      qty = parseFloat(qtyStr) || 0;
    }
    
    // Convertir le prix unitaire
    let prixUnitaireValue = colPrixUnitaire > 0 ? values[i][colPrixUnitaire - 1] : 0;
    let unitPriceFC = 0;
    if (prixUnitaireValue) {
      const prixStr = prixUnitaireValue.toString().replace(',', '.');
      unitPriceFC = parseFloat(prixStr) || 0;
    }
    
    // Convertir USD
    let usdValue = colUSD > 0 ? values[i][colUSD - 1] : 0;
    let unitPriceUSD = 0;
    if (usdValue) {
      const usdStr = usdValue.toString().replace(',', '.');
      unitPriceUSD = parseFloat(usdStr) || 0;
    }
    
    const item = {
      uuid: colUuid > 0 ? values[i][colUuid - 1] : null,
      invoice_number: invoiceNumber.toString().trim(),
      sold_at: dateVente instanceof Date ? dateVente.toISOString() : (typeof dateVente === 'string' ? dateVente : new Date(dateVente).toISOString()),
      product_code: colCode > 0 ? (values[i][colCode - 1] ? values[i][colCode - 1].toString().trim() : '') : '',
      product_name: '', // Sera rempli depuis les produits
      client_name: colClient > 0 ? (values[i][colClient - 1] ? values[i][colClient - 1].toString().trim() : '') : '',
      client_phone: colTelephone > 0 ? (values[i][colTelephone - 1] ? values[i][colTelephone - 1].toString().trim() : '') : '',
      qty: qty,
      qty_label: qtyValue ? qtyValue.toString().trim() : '0',
      unit_mark: colMark > 0 ? (values[i][colMark - 1] ? values[i][colMark - 1].toString().trim() : '') : '',
      // Colonne H "Unite" = unité réelle (prioritaire), sinon colonne I "mode stock" (compatibilité)
      unit_level: colUnite > 0 ? (values[i][colUnite - 1] ? values[i][colUnite - 1].toString().trim() : '') : 
                (colModeStock > 0 ? (values[i][colModeStock - 1] ? values[i][colModeStock - 1].toString().trim() : '') : ''),
      unit_price_fc: unitPriceFC,
      subtotal_fc: qty * unitPriceFC,
      unit_price_usd: unitPriceUSD,
      subtotal_usd: qty * unitPriceUSD,
      seller_name: colVendeur > 0 ? (values[i][colVendeur - 1] ? values[i][colVendeur - 1].toString().trim() : '') : '',
      _origin: 'SHEETS',
      _syncedAt: new Date().toISOString(),
      _remote_updated_at: refDate.toISOString()
    };
    
    results.push(item);
    processedCount++;
  }
  
  logDebug('   ✅ Feuille Ventes traitée:', processedCount, 'vente(s),', skippedCount, 'ligne(s) ignorée(s)');
  logDebug('💰 getSalesSince - Terminé,', results.length, 'vente(s) retournée(s)');
  
  return results;
}

/**
 * Récupère les dettes modifiées depuis une date
 */
function getDebtsSince(sinceDate) {
  const sheet = getSheet(SHEETS.DETTES);
  ensureTechColumns(sheet);
  const colDate = findColumnIndex(sheet, 'date');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
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
    // Utiliser _updated_at si présent, sinon fallback sur date
    const refVal = (colUpdatedAt > 0) ? values[i][colUpdatedAt - 1] : values[i][colDate - 1];
    const refDate = toDate(refVal);
    
    if (!refDate) continue;
    
    // Vérifier la date si ce n'est pas un import initial
    if (!isInitialImport && refDate < sinceDate) {
      continue;
    }
    
    const dateDette = values[i][colDate - 1];
    
    const totalFC = toNumber(colPrixAPayer > 0 ? values[i][colPrixAPayer - 1] : 0);
    const paidFC = toNumber(colPrixPaye > 0 ? values[i][colPrixPaye - 1] : 0);
    const remainingFC = toNumber(colReste > 0 ? values[i][colReste - 1] : 0) || (totalFC - paidFC);
    
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
      total_usd: toNumber(colDollars > 0 ? values[i][colDollars - 1] : 0),
      debt_fc_in_usd: toNumber(colDettesFCUSD > 0 ? values[i][colDettesFCUSD - 1] : 0),
      note: colDescription > 0 ? (values[i][colDescription - 1] || '') : '',
      status: status,
      created_at: dateDette instanceof Date ? dateDette.toISOString() : (typeof dateDette === 'string' ? dateDette : new Date(dateDette).toISOString()),
      _origin: 'SHEETS',
      _syncedAt: new Date().toISOString(),
      _remote_updated_at: refDate.toISOString()
    });
  }
  
  return results;
}

/**
 * Récupère une page de produits (pagination PRO)
 * @param {Date} sinceDate - Date depuis laquelle récupérer
 * @param {number} cursor - Ligne de départ (2 = première ligne de données)
 * @param {number} limit - Nombre max de lignes à lire
 * @param {string} unitLevelParam - 'CARTON', 'MILLIER', 'PIECE' (optionnel)
 * @returns {{data: Array, next_cursor: number|null, done: boolean}}
 */
function getProductsPage(sinceDate, cursor, limit, unitLevelParam) {
  const lvl = (unitLevelParam || '').toString().trim().toUpperCase();
  const sheetName =
    lvl === 'CARTON' ? SHEETS.CARTON :
    (lvl === 'MILLIER' || lvl === 'MILLIERS') ? SHEETS.MILLIERS :
    lvl === 'PIECE' ? SHEETS.PIECE :
    SHEETS.CARTON; // défaut si pas fourni
  
  console.log('📄 [getProductsPage] Feuille:', sheetName, '| Cursor:', cursor, '| Limit:', limit, '| Unit level:', lvl);
  
  const sheet = getSheet(sheetName);
  ensureTechColumns(sheet);
  
  const colDateUpdate = findColumnIndex(sheet, 'Date de dernière mise à jour');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colNom = findColumnIndex(sheet, 'Nom du produit');
  const colStockInit = findColumnIndex(sheet, 'Stock initial');
  const colPrixAchatUSD = findColumnIndex(sheet, "Prix d'achat (USD)");
  const colPrixVenteFC = findColumnIndex(sheet, 'Prix de vente (FC)');
  const colPrixVenteDetailFC = findColumnIndex(sheet, 'Prix de vente détail (FC)');
  const colMark = findColumnIndex(sheet, 'Mark');
  const colAutoStock = findColumnIndex(sheet, 'Automatisation Stock');
  const colPrixVenteUSD = findColumnIndex(sheet, 'Prix ventes (USD)');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  if (colCode === -1) {
    console.log('⚠️ [getProductsPage] Pas de colonne Code produit, feuille ignorée');
    return { data: [], next_cursor: null, done: true };
  }
  
  const maxCol = Math.max(
    colDateUpdate, colCode, colNom, colStockInit, colPrixAchatUSD,
    colPrixVenteFC, colPrixVenteDetailFC, colMark, colAutoStock, colPrixVenteUSD, colUuid
  );
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    console.log('⚠️ [getProductsPage] Pas de données (seulement en-tête)');
    return { data: [], next_cursor: null, done: true };
  }
  
  const startRow = Math.max(2, cursor || 2);
  const endRow = Math.min(lastRow, startRow + limit - 1);
  const numRows = endRow - startRow + 1;
  
  console.log('📊 [getProductsPage] Lecture lignes', startRow, 'à', endRow, '(', numRows, 'lignes)');
  
  const rows = sheet.getRange(startRow, 1, numRows, maxCol).getValues();
  
  const unitLevel =
    sheetName === SHEETS.CARTON ? 'CARTON' :
    sheetName === SHEETS.MILLIERS ? 'MILLIER' : 'PIECE';
  
  const data = [];
  const nowIso = new Date().toISOString();
  let processedCount = 0;
  let skippedCount = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const code = (r[colCode - 1] || '').toString().trim();
    
    if (!code) {
      skippedCount++;
      continue;
    }
    
    // since filter (si pas full)
    if (sinceDate.getTime() > 0) {
      const refVal = (colUpdatedAt > 0) ? r[colUpdatedAt - 1] : (colDateUpdate > 0 ? r[colDateUpdate - 1] : null);
      const refDate = toDate(refVal);
      if (refDate && refDate < sinceDate) {
        skippedCount++;
        continue;
      }
    }
    
    const prixVenteFC = (colPrixVenteDetailFC > 0 ? r[colPrixVenteDetailFC - 1] : null);
    const fallbackPrixVenteFC = (colPrixVenteFC > 0 ? r[colPrixVenteFC - 1] : null);
    
    data.push({
      uuid: colUuid > 0 ? (r[colUuid - 1] || null) : null,
      code,
      name: colNom > 0 ? (r[colNom - 1] || '').toString().trim() : '',
      unit_level: unitLevel,
      unit_mark: colMark > 0 ? (r[colMark - 1] || '').toString().trim() : '',
      stock_initial: toNumber(colStockInit > 0 ? r[colStockInit - 1] : 0),
      stock_current: toNumber(colStockInit > 0 ? r[colStockInit - 1] : 0),
      purchase_price_usd: toNumber(colPrixAchatUSD > 0 ? r[colPrixAchatUSD - 1] : 0),
      sale_price_fc: toNumber(prixVenteFC !== null ? prixVenteFC : fallbackPrixVenteFC),
      sale_price_usd: toNumber(colPrixVenteUSD > 0 ? r[colPrixVenteUSD - 1] : 0),
      auto_stock_factor: toNumber(colAutoStock > 0 ? r[colAutoStock - 1] : 1) || 1,
      last_update: (colDateUpdate > 0 && toDate(r[colDateUpdate - 1])) ? toDate(r[colDateUpdate - 1]).toISOString() : nowIso,
      _origin: 'SHEETS',
      _syncedAt: nowIso,
      _remote_updated_at: (colUpdatedAt > 0 && toDate(r[colUpdatedAt - 1])) ? toDate(r[colUpdatedAt - 1]).toISOString() : nowIso
    });
    processedCount++;
  }
  
  const done = endRow >= lastRow;
  const next_cursor = done ? null : (endRow + 1);
  
  console.log('✅ [getProductsPage] Traité:', processedCount, 'produit(s) | Skippé:', skippedCount, '| Done:', done, '| Next cursor:', next_cursor);
  
  return { data, next_cursor, done };
}

/**
 * Récupère une page de ventes (pagination PRO)
 * @param {Date} sinceDate - Date depuis laquelle récupérer
 * @param {number} cursor - Ligne de départ (2 = première ligne de données)
 * @param {number} limit - Nombre max de lignes à lire
 * @returns {{data: Array, next_cursor: number|null, done: boolean}}
 */
function getSalesPage(sinceDate, cursor, limit) {
  console.log('📄 [getSalesPage] Feuille: Ventes | Cursor:', cursor, '| Limit:', limit);
  console.log('📅 [getSalesPage] sinceDate reçu:', sinceDate, '| Type:', typeof sinceDate);
  
  // Convertir sinceDate en Date si c'est une string
  let sinceDateObj = sinceDate;
  if (typeof sinceDate === 'string') {
    sinceDateObj = new Date(sinceDate);
  } else if (!(sinceDate instanceof Date)) {
    sinceDateObj = new Date(sinceDate);
  }
  
  const isFullImport = sinceDateObj.getTime() <= new Date('1970-01-02').getTime();
  console.log('📅 [getSalesPage] sinceDate converti:', sinceDateObj.toISOString(), '| getTime():', sinceDateObj.getTime(), '| Full import:', isFullImport);
  
  const sheet = getSheet(SHEETS.VENTES);
  ensureTechColumns(sheet);
  
  const colDate = findColumnIndex(sheet, 'Date');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  const colFacture = findColumnIndex(sheet, 'Numéro de facture');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colClient = findColumnIndex(sheet, 'client');
  const colQte = findColumnIndex(sheet, 'QTE');
  const colMark = findColumnIndex(sheet, 'MARK');
  const colPrixUnitaire = findColumnIndex(sheet, 'Prix unitaire');
  const colUnite = findColumnIndex(sheet, 'Unite');
  const colVendeur = findColumnIndex(sheet, 'Vendeur');
  const colModeStock = findColumnIndex(sheet, 'mode stock');
  const colTelephone = findColumnIndex(sheet, 'Telephone');
  const colUSD = findColumnIndex(sheet, 'USD');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  console.log('📋 [getSalesPage] Colonnes trouvées: Date=' + colDate + ', Facture=' + colFacture + ', Code=' + colCode + ', Client=' + colClient + ', QTE=' + colQte);
  
  if (colDate === -1 || colFacture === -1) {
    console.log('⚠️ [getSalesPage] Colonnes Date ou Facture manquantes');
    return { data: [], next_cursor: null, done: true };
  }
  
  const maxCol = Math.max(colDate, colFacture, colCode, colClient, colQte, colMark,
                          colPrixUnitaire, colVendeur, colModeStock, colTelephone, colUSD, colUuid);
  
  const lastRow = sheet.getLastRow();
  console.log('📊 [getSalesPage] Dernière ligne dans Sheets:', lastRow);
  
  if (lastRow <= 1) {
    console.log('⚠️ [getSalesPage] Pas de données (seulement en-tête)');
    return { data: [], next_cursor: null, done: true };
  }
  
  const startRow = Math.max(2, cursor || 2);
  const endRow = Math.min(lastRow, startRow + limit - 1);
  const numRows = endRow - startRow + 1;
  
  console.log('📊 [getSalesPage] Lecture lignes', startRow, 'à', endRow, '(', numRows, 'lignes)');
  
  const rows = sheet.getRange(startRow, 1, numRows, maxCol).getValues();
  console.log('📊 [getSalesPage] Lignes lues depuis Sheets:', rows.length);
  
  const data = [];
  const nowIso = new Date().toISOString();
  let processedCount = 0;
  let skippedCount = 0;
  let skippedNoInvoice = 0;
  let skippedNoRefDate = 0;
  let skippedDateFilter = 0;
  let skippedNoDate = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const invoice = (r[colFacture - 1] || '').toString().trim();
    
    if (!invoice) {
      skippedNoInvoice++;
      skippedCount++;
      if (i < 5) {
        console.log('   ⚠️ [getSalesPage] Ligne', startRow + i, 'ignorée: pas de numéro de facture');
      }
      continue;
    }
    
    // Lire la date de vente d'abord
    const d = toDate(r[colDate - 1]);
    
    // Utiliser _updated_at si présent, sinon fallback sur Date de vente
    const refVal = (colUpdatedAt > 0) ? r[colUpdatedAt - 1] : r[colDate - 1];
    let refDate = toDate(refVal);
    
    // IMPORTANT: En mode full import (isFullImport = true), on accepte TOUTES les ventes même sans date
    // Si pas de date de référence mais full import, utiliser la date de la vente ou date actuelle
    if (!refDate) {
      if (isFullImport) {
        // En mode full import, utiliser la date de vente comme date de référence si disponible
        refDate = d || new Date();
      } else {
        skippedNoRefDate++;
        skippedCount++;
        if (i < 5) {
          console.log('   ⚠️ [getSalesPage] Ligne', startRow + i, 'ignorée: pas de date de référence valide (refVal:', refVal, ')');
        }
        continue;
      }
    }
    
    // IMPORTANT: Si sinceDate est 1970 (full import), on accepte TOUTES les ventes
    // sinceDateObj.getTime() === 0 signifie qu'on veut TOUTES les ventes
    if (!isFullImport && sinceDateObj.getTime() > 0 && refDate && refDate < sinceDateObj) {
      skippedDateFilter++;
      skippedCount++;
      if (i < 5) {
        console.log('   ⚠️ [getSalesPage] Ligne', startRow + i, 'ignorée: date trop ancienne (refDate:', refDate.toISOString(), '< sinceDate:', sinceDateObj.toISOString(), ')');
      }
      continue;
    }
    
    // En mode full import, accepter même les ventes sans date (utiliser date actuelle)
    if (!d) {
      if (isFullImport) {
        // En mode full import, utiliser date actuelle si pas de date
        // On continue avec d = new Date() (sera défini plus bas)
      } else {
        skippedNoDate++;
        skippedCount++;
        if (i < 5) {
          console.log('   ⚠️ [getSalesPage] Ligne', startRow + i, 'ignorée: pas de date valide dans colonne Date');
        }
        continue;
      }
    }
    
    // Préserver le format original de la quantité (avec virgule si présent) pour qty_label
    const qtyRaw = colQte > 0 ? r[colQte - 1] : 0;
    const qtyLabel = qtyRaw ? String(qtyRaw).trim() : '0';
    const qty = toNumber(qtyRaw);
    const unitPriceFC = toNumber(colPrixUnitaire > 0 ? r[colPrixUnitaire - 1] : 0);
    const unitPriceUSD = toNumber(colUSD > 0 ? r[colUSD - 1] : 0);
    
    // Utiliser la date de vente ou date actuelle si pas de date (full import)
    const finalSaleDate = d || new Date();
    // Utiliser la date de référence ou date de vente ou date actuelle
    const finalRefDate = refDate || finalSaleDate || new Date();
    
    data.push({
      uuid: colUuid > 0 ? (r[colUuid - 1] || null) : null,
      invoice_number: invoice,
      sold_at: finalSaleDate.toISOString(),
      product_code: colCode > 0 ? (r[colCode - 1] || '').toString().trim() : '',
      product_name: '', // Sera rempli depuis les produits lors de l'application
      client_name: colClient > 0 ? (r[colClient - 1] || '').toString().trim() : '',
      client_phone: colTelephone > 0 ? (r[colTelephone - 1] || '').toString().trim() : '',
      qty: qty,
      qty_label: qtyLabel,
      unit_mark: colMark > 0 ? (r[colMark - 1] || '').toString().trim() : '',
      // Colonne H "Unite" = unité réelle (millier, carton, piece) - PRIORITAIRE
      // Colonne I "mode stock" = fallback pour compatibilité
      // IMPORTANT: Vérifier que la colonne Unite existe et contient une valeur
      unit_level: (() => {
        if (colUnite > 0 && r[colUnite - 1]) {
          const uniteValue = (r[colUnite - 1] || '').toString().trim();
          if (uniteValue) {
            return uniteValue;
          }
        }
        // Fallback sur mode stock si Unite est vide
        if (colModeStock > 0 && r[colModeStock - 1]) {
          const modeStockValue = (r[colModeStock - 1] || '').toString().trim();
          if (modeStockValue) {
            return modeStockValue;
          }
        }
        return ''; // Retourner chaîne vide si aucune unité trouvée
      })(),
      unit_price_fc: unitPriceFC,
      subtotal_fc: qty * unitPriceFC,
      unit_price_usd: unitPriceUSD,
      subtotal_usd: qty * unitPriceUSD,
      seller_name: colVendeur > 0 ? (r[colVendeur - 1] || '').toString().trim() : '',
      _origin: 'SHEETS',
      _syncedAt: nowIso,
      _remote_updated_at: finalRefDate.toISOString()
    });
    processedCount++;
  }
  
  const done = endRow >= lastRow;
  const next_cursor = done ? null : (endRow + 1);
  
  console.log('✅ [getSalesPage] Traité:', processedCount, 'vente(s) | Skippé:', skippedCount, '| Done:', done, '| Next cursor:', next_cursor);
  console.log('📊 [getSalesPage] Détail des lignes ignorées:');
  console.log('   - Sans facture:', skippedNoInvoice);
  console.log('   - Sans date de référence:', skippedNoRefDate);
  console.log('   - Filtrées par date:', skippedDateFilter);
  console.log('   - Sans date valide:', skippedNoDate);
  
  // Log détaillé pour les premières ventes traitées (debug)
  if (processedCount > 0 && data.length > 0) {
    console.log('📋 [getSalesPage] Exemple de ventes traitées (3 premières):');
    for (let i = 0; i < Math.min(3, data.length); i++) {
      const item = data[i];
      console.log(`   [${i + 1}] Facture: ${item.invoice_number || 'N/A'}, Client: ${item.client_name || 'N/A'}, Produit: ${item.product_code || 'N/A'}, Qty: ${item.qty || 0}`);
    }
  } else if (rows.length > 0) {
    // Si on a lu des lignes mais rien n'a été traité, afficher les premières lignes pour debug
    console.log('⚠️ [getSalesPage] Aucune vente traitée sur', rows.length, 'ligne(s) lue(s). Exemple de la première ligne:');
    const firstRow = rows[0];
    console.log('   Facture:', firstRow[colFacture - 1]);
    console.log('   Date:', firstRow[colDate - 1]);
    console.log('   Client:', firstRow[colClient - 1]);
    console.log('   Code produit:', firstRow[colCode - 1]);
    console.log('   _updated_at:', colUpdatedAt > 0 ? firstRow[colUpdatedAt - 1] : 'N/A');
  }
  
  return { data, next_cursor, done };
}

/**
 * Récupère une page de dettes (pagination PRO)
 * @param {Date} sinceDate - Date depuis laquelle récupérer
 * @param {number} cursor - Ligne de départ (2 = première ligne de données)
 * @param {number} limit - Nombre max de lignes à lire
 * @returns {{data: Array, next_cursor: number|null, done: boolean}}
 */
function getDebtsPage(sinceDate, cursor, limit) {
  console.log('📄 [getDebtsPage] Feuille: Dettes | Cursor:', cursor, '| Limit:', limit);
  
  const sheet = getSheet(SHEETS.DETTES);
  ensureTechColumns(sheet);
  
  const colDate = findColumnIndex(sheet, 'date');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
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
  
  if (colDate === -1) {
    console.log('⚠️ [getDebtsPage] Colonne date manquante');
    return { data: [], next_cursor: null, done: true };
  }
  
  const maxCol = Math.max(colDate, colClient, colProduit, colPrixAPayer, colPrixPaye,
                          colReste, colFacture, colDollars, colDescription, colDettesFCUSD, colUuid);
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    console.log('⚠️ [getDebtsPage] Pas de données (seulement en-tête)');
    return { data: [], next_cursor: null, done: true };
  }
  
  const startRow = Math.max(2, cursor || 2);
  const endRow = Math.min(lastRow, startRow + limit - 1);
  const numRows = endRow - startRow + 1;
  
  console.log('📊 [getDebtsPage] Lecture lignes', startRow, 'à', endRow, '(', numRows, 'lignes)');
  
  const rows = sheet.getRange(startRow, 1, numRows, maxCol).getValues();
  
  const data = [];
  let processedCount = 0;
  let skippedCount = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    
    // Utiliser _updated_at si présent, sinon fallback sur date
    const refVal = (colUpdatedAt > 0) ? r[colUpdatedAt - 1] : r[colDate - 1];
    const refDate = toDate(refVal);
    
    if (!refDate) {
      skippedCount++;
      continue;
    }
    
    if (sinceDate.getTime() > 0 && refDate < sinceDate) {
      skippedCount++;
      continue;
    }
    
    const dateDette = toDate(r[colDate - 1]);
    if (!dateDette) {
      skippedCount++;
      continue;
    }
    
    const totalFC = toNumber(colPrixAPayer > 0 ? r[colPrixAPayer - 1] : 0);
    const paidFC = toNumber(colPrixPaye > 0 ? r[colPrixPaye - 1] : 0);
    const remainingFC = toNumber(colReste > 0 ? r[colReste - 1] : 0) || (totalFC - paidFC);
    
    // Déterminer le statut
    let status = 'open';
    if (remainingFC <= 0) {
      status = 'closed';
    } else if (paidFC > 0) {
      status = 'partial';
    }
    
    data.push({
      uuid: colUuid > 0 ? (r[colUuid - 1] || null) : null,
      client_name: colClient > 0 ? (r[colClient - 1] || '').toString().trim() : '',
      product_description: colProduit > 0 ? (r[colProduit - 1] || '').toString().trim() : '',
      total_fc: totalFC,
      paid_fc: paidFC,
      remaining_fc: remainingFC,
      invoice_number: colFacture > 0 ? (r[colFacture - 1] || '').toString().trim() : '',
      total_usd: toNumber(colDollars > 0 ? r[colDollars - 1] : 0),
      debt_fc_in_usd: toNumber(colDettesFCUSD > 0 ? r[colDettesFCUSD - 1] : 0),
      note: colDescription > 0 ? (r[colDescription - 1] || '').toString().trim() : '',
      status: status,
      created_at: dateDette.toISOString(),
      _origin: 'SHEETS',
      _syncedAt: new Date().toISOString(),
      _remote_updated_at: refDate.toISOString()
    });
    processedCount++;
  }
  
  const done = endRow >= lastRow;
  const next_cursor = done ? null : (endRow + 1);
  
  console.log('✅ [getDebtsPage] Traité:', processedCount, 'dette(s) | Skippé:', skippedCount, '| Done:', done, '| Next cursor:', next_cursor);
  
  return { data, next_cursor, done };
}

/**
 * Récupère les taux modifiés depuis une date
 * Retourne le taux le plus récent si plusieurs
 */
function getRatesSince(sinceDate) {
  const sheet = getSheet(SHEETS.TAUX);
  ensureTechColumns(sheet);
  const colDate = findColumnIndex(sheet, 'DATE');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
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
    // Utiliser _updated_at si présent, sinon fallback sur DATE
    const refVal = (colUpdatedAt > 0) ? values[i][colUpdatedAt - 1] : values[i][colDate - 1];
    const refDate = toDate(refVal);
    
    if (!refDate) continue;
    
    // Vérifier la date si ce n'est pas un import initial
    if (!isInitialImport && refDate < sinceDate) {
      continue;
    }
    
    const dateTaux = values[i][colDate - 1];
    
    const rate = toNumber(colTaux > 0 ? values[i][colTaux - 1] : 0) || 2800;
    const dateObj = dateTaux instanceof Date ? dateTaux : new Date(dateTaux);
    
    if (!latestDate || refDate > latestDate) {
      latestDate = refDate;
      latestRate = {
        uuid: colUuid > 0 ? values[i][colUuid - 1] : null,
        rate_fc_per_usd: rate,
        effective_at: dateObj.toISOString(),
        _origin: 'SHEETS',
        _syncedAt: new Date().toISOString(),
        _remote_updated_at: refDate.toISOString()
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
  ensureTechColumns(sheet);
  const colDateCreation = findColumnIndex(sheet, 'date de creation du compter');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  
  // PRO: Calculer les colonnes UNE SEULE FOIS avant la boucle (optimisation performance)
  const colNom = findColumnIndex(sheet, 'Nom');
  const colNumero = findColumnIndex(sheet, 'Numero');
  const colValide = findColumnIndex(sheet, 'Valide');
  const colAdmi = findColumnIndex(sheet, 'admi');
  const colUuid = findColumnIndex(sheet, '_uuid');
  const colToken = findColumnIndex(sheet, 'Token Expo Push');
  const colMarque = findColumnIndex(sheet, 'marque');
  const colUrlProfile = findColumnIndex(sheet, 'Urlprofile');
  
  if (colDateCreation === -1) {
    console.log('[USERS] ❌ Colonne "date de creation du compter" introuvable');
    return [];
  }
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const results = [];
  
  // Logs de débogage
  const sinceDateObj = new Date(sinceDate);
  const isFullImport = sinceDateObj.getTime() <= new Date('1970-01-02').getTime(); // Si date <= 1970, c'est un import complet
  console.log(`[USERS] 🔍 Recherche utilisateurs depuis: ${sinceDate} (${sinceDateObj.toLocaleString('fr-FR')})`);
  console.log(`[USERS] 📊 Mode: ${isFullImport ? 'IMPORT COMPLET (tous les utilisateurs)' : 'SYNC INCRÉMENTALE (depuis date)'}`);
  console.log(`[USERS] 📊 Total lignes dans la feuille: ${values.length}`);
  console.log(`[USERS] 📋 Colonnes trouvées: Nom=${colNom}, Numero=${colNumero}, Valide=${colValide}, Admi=${colAdmi}, UUID=${colUuid}, Token=${colToken}, Marque=${colMarque}, UrlProfile=${colUrlProfile}`);
  
  let skippedNoDate = 0;
  let skippedOldDate = 0;
  let skippedEmptyName = 0;
  let processed = 0;
  let processedWithoutDate = 0;
  
  let uuidBackfilled = 0;
  
  for (let i = 1; i < values.length; i++) {
    // PRIORITÉ: Utiliser la date de création (colonne E) comme date de référence principale
    // Utiliser _updated_at seulement si date de création n'est pas disponible
    const dateCreationVal = values[i][colDateCreation - 1];
    const updatedAtVal = (colUpdatedAt > 0) ? values[i][colUpdatedAt - 1] : null;
    
    // Prioriser la date de création
    const refVal = dateCreationVal || updatedAtVal;
    const refDate = toDate(refVal);
    
    // Si import complet, inclure même les utilisateurs sans date
    // Sinon, ignorer ceux sans date
    if (!refDate) {
      if (isFullImport) {
        // En mode import complet, utiliser la date actuelle comme fallback
        processedWithoutDate++;
        console.log(`[USERS] ⚠️  Ligne ${i} sans date valide mais incluse (import complet)`);
      } else {
        skippedNoDate++;
        continue;
      }
    }
    
    // Si on a une date valide, vérifier si elle est trop ancienne (sauf en mode import complet)
    // Utiliser la date de création comme référence principale pour le filtrage
    if (refDate && !isFullImport) {
      // Comparer les dates (convertir sinceDate en Date si c'est une string)
      const sinceDateObj2 = typeof sinceDate === 'string' ? new Date(sinceDate) : sinceDate;
      // Utiliser la date de création pour la comparaison (pas _updated_at)
      const dateToCompare = refDate; // refDate est déjà basé sur dateCreation en priorité
      if (dateToCompare < sinceDateObj2) {
        skippedOldDate++;
        if (i <= 5) { // Log les 5 premiers pour debug
          const nomValue = colNom > 0 ? values[i][colNom - 1] : '';
          console.log(`[USERS] ⏭️  Ligne ${i} ignorée (date de création trop ancienne): ${nomValue || 'Sans nom'}, dateCreation=${dateToCompare.toISOString()}, sinceDate=${sinceDateObj2.toISOString()}`);
        }
        continue;
      }
    }
    
    const dateCreationRaw = values[i][colDateCreation - 1];
    const nomValue = colNom > 0 ? values[i][colNom - 1] : '';
    const numeroValue = colNumero > 0 ? values[i][colNumero - 1] : '';
    
    // Ignorer les lignes vides
    if (!nomValue || nomValue.toString().trim() === '') {
      skippedEmptyName++;
      continue;
    }
    
    // BACKFILL UUID si manquant
    let userUuid = colUuid > 0 ? String(values[i][colUuid - 1] || '').trim() : '';
    if (!userUuid) {
      // Générer un UUID et l'écrire dans la feuille
      userUuid = Utilities.getUuid();
      if (colUuid > 0) {
        sheet.getRange(i + 1, colUuid).setValue(userUuid);
        uuidBackfilled++;
        console.log(`[USERS] 🔧 UUID généré pour ligne ${i + 1}: ${userUuid} (${nomValue})`);
      }
    }
    
    processed++;
    
    // Utiliser la date de référence ou la date actuelle si pas de date (import complet)
    // S'assurer que finalRefDate est toujours un objet Date valide
    let finalRefDate = refDate;
    if (!finalRefDate || !(finalRefDate instanceof Date) || isNaN(finalRefDate.getTime())) {
      finalRefDate = new Date();
      if (isFullImport) {
        processedWithoutDate++;
      }
    }
    
    // Convertir dateCreation en Date si nécessaire
    let finalCreatedAt = null;
    if (dateCreationRaw) {
      const dateCreatedObj = toDate(dateCreationRaw);
      if (dateCreatedObj && !isNaN(dateCreatedObj.getTime())) {
        finalCreatedAt = dateCreatedObj;
      }
    }
    
    // Si pas de date de création valide, utiliser la date de référence
    if (!finalCreatedAt) {
      finalCreatedAt = finalRefDate;
    }
    
    // Double vérification : s'assurer que finalCreatedAt est un objet Date valide
    if (!(finalCreatedAt instanceof Date) || isNaN(finalCreatedAt.getTime())) {
      finalCreatedAt = new Date();
    }
    
    const userData = {
      uuid: userUuid, // UUID backfillé si nécessaire
      _uuid: userUuid, // Alias pour compatibilité
      username: nomValue ? String(nomValue).trim() : '',
      phone: numeroValue ? String(numeroValue).trim() : '',
      is_active: colValide > 0 ? (String(values[i][colValide - 1]).toLowerCase() === 'oui' || values[i][colValide - 1] == 1 || values[i][colValide - 1] === true) : true,
      is_admin: colAdmi > 0 ? (String(values[i][colAdmi - 1]).toLowerCase() === 'oui' || values[i][colAdmi - 1] == 1 || values[i][colAdmi - 1] === true) : false,
      created_at: (finalCreatedAt instanceof Date && !isNaN(finalCreatedAt.getTime())) ? finalCreatedAt.toISOString() : new Date().toISOString(),
      // Informations device
      device_brand: colMarque > 0 ? (values[i][colMarque - 1] ? String(values[i][colMarque - 1]).trim() : '') : '',
      profile_url: colUrlProfile > 0 ? (values[i][colUrlProfile - 1] ? String(values[i][colUrlProfile - 1]).trim() : '') : '',
      expo_push_token: colToken > 0 ? (values[i][colToken - 1] ? String(values[i][colToken - 1]).trim() : '') : '',
      _origin: 'SHEETS',
      _syncedAt: new Date().toISOString(),
      _remote_updated_at: (finalRefDate && finalRefDate instanceof Date && !isNaN(finalRefDate.getTime())) ? finalRefDate.toISOString() : new Date().toISOString()
    };
    
    if (processed <= 3) { // Log les 3 premiers utilisateurs
      const refDateStr = (refDate && refDate instanceof Date && !isNaN(refDate.getTime())) ? refDate.toISOString() : 'N/A (utilisé date actuelle)';
      console.log(`[USERS] ✅ Utilisateur ${processed}: ${userData.username}, UUID=${userData.uuid || 'N/A'}, phone=${userData.phone}, is_active=${userData.is_active}, is_admin=${userData.is_admin}, refDate=${refDateStr}`);
    }
    
    results.push(userData);
  }
  
  if (uuidBackfilled > 0) {
    console.log(`[USERS] 🔧 ${uuidBackfilled} UUID(s) généré(s) et écrit(s) dans Sheets`);
  }
  
  console.log(`[USERS] 📊 Résumé: ${results.length} utilisateur(s) trouvé(s), ${processedWithoutDate} sans date (inclus), ${skippedNoDate} sans date (ignorés), ${skippedOldDate} date trop ancienne, ${skippedEmptyName} nom vide, ${uuidBackfilled} UUID(s) backfillé(s)`);
  console.log(`[USERS] ✅ Tous les utilisateurs avec nom valide ont été récupérés${isFullImport ? ' (IMPORT COMPLET)' : ''}`);
  
  return results;
}

/**
 * Handle batchPull: récupère plusieurs entités en une seule requête
 * GET ?action=batchPull&since={...}
 */
function handleBatchPull(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sinceMap = safeParseJson(p.since || '{}', {});
    const entities = (p.entities ? p.entities.toString().split(',') : Object.keys(sinceMap))
      .map(x => x.trim().toLowerCase())
      .filter(Boolean);
    
    // PRO: batchPull uniquement pour entités légères (users, rates)
    // products/sales/debts doivent être paginés séparément
    const list = entities.length ? entities : ['users','rates'];
    const data = {};
    const meta = {};
    const serverTime = nowIso();
    
    console.log('📥 [handleBatchPull] Entités:', list.join(', '));
    console.log('   ⚠️ [handleBatchPull] Products/Sales/Debts doivent être paginés séparément (évite timeout)');
    
    for (const entity of list) {
      // Ignorer les grosses entités dans batchPull
      if (['products', 'product_units', 'sales', 'debts'].includes(entity)) {
        console.log(`   ⏭️ [handleBatchPull] ${entity} ignoré (utiliser pagination séparée)`);
        data[entity] = [];
        meta[entity] = { count: 0, max_updated_at: sinceMap[entity] || new Date(0).toISOString() };
        continue;
      }
      
      const sinceStr = sinceMap[entity] || new Date(0).toISOString();
      const sinceDate = new Date(sinceStr);
      let rows = [];
      
      switch (entity) {
        case 'rates':
          rows = getRatesSince(sinceDate);
          break;
        case 'users':
          rows = getUsersSince(sinceDate);
          break;
        default:
          rows = [];
      }
      
      // max_updated_at: on prend la valeur _remote_updated_at si fournie par vos getters
      let maxUpdated = null;
      for (const r of rows) {
        const d = toDate(r._remote_updated_at || r.last_update || r.created_at || r.sold_at || null);
        if (d && (!maxUpdated || d > maxUpdated)) maxUpdated = d;
      }
      
      data[entity] = rows;
      meta[entity] = {
        count: rows.length,
        max_updated_at: maxUpdated ? maxUpdated.toISOString() : sinceStr
      };
      
      console.log(`   ✅ [handleBatchPull] ${entity}: ${rows.length} item(s)`);
    }
    
    return jsonOut({ success: true, server_time: serverTime, data, meta });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Handle batchPush: applique plusieurs opérations en une seule requête
 * POST { action: 'batchPush', device_id: '...', ops: [...] }
 */
function handleBatchPush(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ops = Array.isArray(data.ops) ? data.ops : [];
    const deviceId = (data.device_id || '').toString() || 'UNKNOWN';
    const serverTime = nowIso();
    
    if (!ops.length) {
      return jsonOut({ success: true, server_time: serverTime, applied: [], conflicts: [] });
    }
    
    // 1) Normaliser (sales avec items -> sale_items, products avec units -> product_units)
    const normalized = [];
    for (const op of ops) {
      const entity = (op.entity || '').toString().trim().toLowerCase();
      const payload = op.payload || {};
      
      if (entity === 'sales' && payload.items && Array.isArray(payload.items)) {
        for (const item of payload.items) {
          normalized.push({
            op_id: op.op_id || op.id || Utilities.getUuid(),
            entity: 'sale_items',
            op: op.op || 'upsert',
            payload: {
              ...item,
              invoice_number: payload.invoice_number,
              sold_at: payload.sold_at,
              client_name: payload.client_name,
              client_phone: payload.client_phone,
              seller_name: payload.seller_name,
              uuid: item.uuid || payload.uuid || item._uuid || Utilities.getUuid()
            },
            base_remote_updated_at: op.base_remote_updated_at || null
          });
        }
      } else if (entity === 'products' && payload.units && Array.isArray(payload.units)) {
        for (const u of payload.units) {
          normalized.push({
            op_id: op.op_id || op.id || Utilities.getUuid(),
            entity: 'product_units',
            op: op.op || 'upsert',
            payload: {
              code: payload.code,
              name: payload.name,
              uuid: u.uuid || payload.uuid || Utilities.getUuid(),
              unit_level: u.unit_level,
              unit_mark: u.unit_mark,
              stock_initial: u.stock_initial,
              stock_current: u.stock_current,
              purchase_price_usd: u.purchase_price_usd,
              sale_price_fc: u.sale_price_fc,
              sale_price_usd: u.sale_price_usd,
              auto_stock_factor: u.auto_stock_factor,
              qty_step: u.qty_step,
              last_update: u.last_update || payload.last_update || serverTime
            },
            base_remote_updated_at: op.base_remote_updated_at || null
          });
        }
      } else {
        normalized.push({
          op_id: op.op_id || op.id || Utilities.getUuid(),
          entity,
          op: op.op || 'upsert',
          payload,
          base_remote_updated_at: op.base_remote_updated_at || null
        });
      }
    }
    
    // 2) Router vers feuille cible
    const groups = {};
    function addTo(sheetName, item) {
      if (!groups[sheetName]) groups[sheetName] = [];
      groups[sheetName].push(item);
    }
    
    for (const it of normalized) {
      const entity = it.entity;
      const pl = it.payload || {};
      
      if (entity === 'products' || entity === 'product_units') {
        const lvl = (pl.unit_level || '').toString().toUpperCase();
        const target = lvl === 'CARTON' ? SHEETS.CARTON : (lvl === 'MILLIER' ? SHEETS.MILLIERS : SHEETS.PIECE);
        addTo(target, it);
      } else if (entity === 'sales' || entity === 'sale_items') {
        addTo(SHEETS.VENTES, it);
      } else if (entity === 'debts' || entity === 'debt_payments') {
        addTo(SHEETS.DETTES, it);
      } else if (entity === 'rates') {
        addTo(SHEETS.TAUX, it);
      } else if (entity === 'users') {
        addTo(SHEETS.COMPTER_UTILISATEUR, it);
      } else if (entity === 'price_logs') {
        addTo(SHEETS.STOCK_PRIX, it);
      }
    }
    
    const applied = [];
    const conflicts = [];
    
    // 3) Appliquer par feuille (lecture 1 fois + écritures en blocs)
    for (const sheetName in groups) {
      const sheet = getSheet(sheetName);
      ensureTechColumns(sheet);
      
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      const values = (lastRow > 1)
        ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
        : [];
      
      const colUuid = findColumnIndex(sheet, '_uuid');
      const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
      
      // Index uuid -> index dans values[]
      const uuidMap = new Map();
      if (colUuid > 0) {
        for (let i = 0; i < values.length; i++) {
          const u = values[i][colUuid - 1];
          if (u) uuidMap.set(String(u), i);
        }
      }
      
      // PRO: Appliquer ops en utilisant les handlers existants (sécurisé, remplit tous les champs métier)
      console.log(`   📄 [handleBatchPush] Traitement feuille: ${sheetName} (${groups[sheetName].length} op(s))`);
      
      for (const op of groups[sheetName]) {
        const pl = op.payload || {};
        const opId = op.op_id;
        const uuid = (pl.uuid || pl._uuid || '').toString().trim();
        
        // Vérifier conflit si update
        if (uuid && colUuid > 0) {
          const idx = uuidMap.get(uuid);
          if (idx !== undefined && idx !== null) {
            const remoteUpdated = colUpdatedAt > 0 ? toDate(values[idx][colUpdatedAt - 1]) : null;
            const base = toDate(op.base_remote_updated_at);
            if (base && remoteUpdated && remoteUpdated > base) {
              conflicts.push({
                op_id: opId,
                sheet: sheetName,
                reason: 'REMOTE_NEWER_THAN_BASE',
                uuid,
                remote_updated_at: remoteUpdated.toISOString(),
                base_remote_updated_at: base.toISOString()
              });
              console.log(`   ⚠️ [handleBatchPush] Conflit détecté pour ${opId}: remote plus récent`);
              continue;
            }
          }
        }
        
        // Utiliser les handlers existants (plus lent mais correct et sécurisé)
        try {
          let result;
          const entity = op.entity;
          
          console.log(`   📝 [handleBatchPush] Application ${entity} (op_id: ${opId})`);
          
          switch (entity) {
            case 'product_units':
            case 'products':
              result = handleProductUpsert(pl, entity);
              break;
            case 'sale_items':
              result = handleSaleItemUpsert(pl);
              break;
            case 'debts':
            case 'debt_payments':
              result = handleDebtUpsert(pl);
              break;
            case 'rates':
              result = handleRateUpsert(pl);
              break;
            case 'users':
              result = handleUserUpsert(pl);
              break;
            case 'price_logs':
              result = handlePriceLogUpsert(pl);
              break;
            default:
              console.log(`   ⚠️ [handleBatchPush] Entity non géré: ${entity}`);
              conflicts.push({ op_id: opId, sheet: sheetName, reason: 'UNKNOWN_ENTITY', entity });
              continue;
          }
          
          applied.push({ op_id: opId, sheet: sheetName, uuid: uuid || result?.uuid || null });
          console.log(`   ✅ [handleBatchPush] ${entity} appliqué (op_id: ${opId})`);
        } catch (error) {
          console.error(`   ❌ [handleBatchPush] Erreur ${entity} (op_id: ${opId}):`, error.toString());
          conflicts.push({
            op_id: opId,
            sheet: sheetName,
            reason: 'HANDLER_ERROR',
            uuid,
            error: error.toString()
          });
        }
      }
      
      // Note: Les handlers existants (handleProductUpsert, etc.) gèrent déjà l'écriture dans Sheets
      // Pas besoin de réécrire values[] ici car on utilise les handlers directement
    }
    
    return jsonOut({
      success: true,
      server_time: serverTime,
      remote_version: serverTime,
      applied,
      conflicts
    });
  } finally {
    lock.releaseLock();
  }
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
