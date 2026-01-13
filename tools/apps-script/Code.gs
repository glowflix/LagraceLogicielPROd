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
 * Helper PRO: Trouve la première colonne valide parmi plusieurs noms
 * Corrige le bug: findColumnIndex(...) || findColumnIndex(...) ne marche pas avec -1
 * Raison: -1 est "truthy" en JS, donc le || ne retombe jamais sur le fallback
 */
function firstCol(sheet, names) {
  for (const n of names) {
    const idx = findColumnIndex(sheet, n);
    if (idx > 0) return idx;
  }
  return -1;
}

/**
 * Génère un UUID v4 compatible avec Google Apps Script
 * Format: PM{prefix}{13 chars alphanumériques}
 * Exemple: PMGTKQ4THRIFF (comme les codes existants)
 */
function generateUUID() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'PM'; // Préfixe pour identifier les produits générés automatiquement
  
  // Ajouter un préfixe basé sur le timestamp (2 chars)
  const timestamp = Date.now();
  const timestampChars = timestamp.toString(36).toUpperCase().slice(-2);
  result += timestampChars;
  
  // Ajouter des caractères aléatoires (11 chars pour un total de 15)
  for (let i = 0; i < 11; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

/**
 * Génère un UUID complet pour les nouvelles entrées
 * Format compatible avec les colonnes _uuid de Sheets
 */
function generateFullUUID() {
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const hex = '0123456789abcdef';
  let uuid = '';
  
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4'; // Version 4
    } else if (i === 19) {
      uuid += hex.charAt((Math.random() * 4) | 8); // 8, 9, a, ou b
    } else {
      uuid += hex.charAt(Math.floor(Math.random() * 16));
    }
  }
  
  return uuid;
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
 * Convertit une valeur en Date (gère formats FR dd/mm/yyyy, ISO et Excel serial)
 */
function toDate(v) {
  if (!v) return null;

  // Google Sheets Date object
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  
  // Excel serial number (numéro de série Excel)
  // Les dates Google Sheets sont parfois des nombres comme 45632.5 (jours depuis 1899-12-30)
  if (typeof v === 'number') {
    // Si c'est un grand nombre (> 1000000), c'est probablement des millisecondes JS
    if (v > 1000000000000) {
      const dt = new Date(v);
      return isNaN(dt.getTime()) ? null : dt;
    }
    // Sinon c'est probablement un numéro de série Excel
    // Excel epoch: 1899-12-30 (avec bug du 29 février 1900)
    if (v > 1 && v < 100000) {
      const excelEpoch = new Date(1899, 11, 30); // 30 décembre 1899
      const dt = new Date(excelEpoch.getTime() + v * 86400 * 1000);
      return isNaN(dt.getTime()) ? null : dt;
    }
    // Fallback: millisecondes depuis epoch
    const dt = new Date(v);
    return isNaN(dt.getTime()) ? null : dt;
  }

  const s = String(v).trim();
  if (!s) return null;

  // ISO (2025-11-20T10:44:58.918Z)
  if (s.includes('T') && s.includes('-')) {
    const dtIso = new Date(s);
    return isNaN(dtIso.getTime()) ? null : dtIso;
  }

  // FR: dd/mm/yyyy ou dd-mm-yyyy (à tester AVANT new Date(s))
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    let y = parseInt(m[3], 10);
    if (y < 100) y = 2000 + y;
    const dtFr = new Date(y, mo, d);
    return isNaN(dtFr.getTime()) ? null : dtFr;
  }

  // Fallback
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * ✅ HELPER: Récupère la première valeur définie parmi les clés
 * Utile pour gérer multiple noms de champs de l'app (name, product_name, nom, productName)
 */
function pickFirst(obj, keys, fallback = undefined) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) return obj[k];
  }
  return fallback;
}

/**
 * ✅ HELPER: Normalise un code produit
 * Gère null, undefined, nombre vs chaîne
 */
function normalizeCode(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

/**
 * ✅ HELPER: Normalise le texte pour comparaison (trim, lowercase, espace normaliz)
 * Utile pour matching nom produit avec doublons
 */
function normalizeText(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * ✅ HELPER: Normalise le "unit_level" (CARTON, MILLIERS, PIECE)
 * IMPORTANT: Retourne les clés exactes de SHEETS: CARTON, MILLIERS, PIECE
 * Gère majuscules/minuscules, gère MILLIER → MILLIERS
 */
function normalizeUnitLevel(v) {
  const s = (v || '').toString().trim().toUpperCase();
  if (s === 'MILLIER') return 'MILLIERS';  // ✅ Retourne MILLIERS (pour matcher SHEETS.MILLIERS)
  if (s === 'MILLIERS') return 'MILLIERS';
  if (s === 'PIECE' || s === 'PIECES') return 'PIECE';
  if (s === 'CARTON' || s === 'CARTONS') return 'CARTON';
  return s;
}

/**
 * ✅ PRO: Canonicalise unit_level en acceptant variantes
 * Retourne toujours CARTON, MILLIERS ou PIECE (jamais MILLIER)
 */
function normalizeUnitLevelCanonical(v) {
  const s = (v || '').toString().trim().toUpperCase();
  if (s === 'MILLIER' || s === 'MILLIERS') return 'MILLIERS';
  if (s === 'CARTON' || s === 'CARTONS') return 'CARTON';
  if (s === 'PIECE' || s === 'PIECES') return 'PIECE';
  return s;
}

/**
 * ✅ HELPER: Normalise un "Mark" (unité d'emballage)
 * Gère DZ/dz/dozen → DZ
 * Autres → UPPERCASE
 * Vide → ''
 */
function normalizeMark(v) {
  let m = (v || '').toString().trim();
  if (!m) return '';
  const lower = m.toLowerCase();

  // Normaliser DZ (douzaine)
  if (['dz','dzn','douz','douzaine','douzain','dizaine','dozen'].includes(lower)) return 'DZ';

  // Standard: UPPERCASE
  return m.toUpperCase();
}

// =========================
// STOCK REDUCTION (VENTES)
// =========================

/**
 * ✅ HELPER: Trouve la première colonne valide parmi plusieurs noms
 * Cherche par header text (robuste même si ordre change)
 * Retourne colonne 1-based ou -1 si non trouvé
 */
function findColumnIndexByNames(headerRow, names) {
  for (const name of names) {
    const idx = headerRow.findIndex(h => normalizeText(h) === normalizeText(name));
    if (idx !== -1) return idx + 1; // 1-based
  }
  return -1;
}

/**
 * ✅ HELPER: Récupère feuille ou lance erreur
 */
function getSheetOrThrow(name) {
  const ss = getSpreadsheet(); // ✅ FIX: Utilise getSpreadsheet() au lieu de getActive()
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error("Feuille introuvable: " + name);
  return sh;
}

/**
 * ✅ MAIN: Réduit le stock après une vente
 * 
 * Détecte automatiquement la bonne feuille (CARTON/MILLIER/PIECE)
 * Trouve produit par Code (ou Code + Nom si doublons)
 * Écrit dans colonne "Stock initial"
 * Accepte qty_sold (quantité vendue) ou stock_change (négatif)
 * 
 * Param payload: {
 *   unit_level: "CARTON|MILLIER|PIECE",
 *   product_code: "139" (requis),
 *   product_name: "Golden milk" (optionnel, secours si doublons),
 *   qty_sold: 3 (optionnel, transformé en -3),
 *   stock_change: -3 (optionnel, doit être négatif pour vente),
 *   device_id: "PC-1" (optionnel)
 * }
 * 
 * @return { sheet, row, old_stock, new_stock }
 */
function reduceStockFromSale(payload) {
  // 1) Extract paramètres
  const unitLevel = normalizeUnitLevel(payload.unit_level ?? payload.unite ?? payload.unit ?? payload.mode_stock);
  const code = normalizeCode(payload.product_code ?? payload.code ?? payload["Code produit"]);
  const name = normalizeText(payload.product_name ?? payload.name ?? payload["Nom du produit"]);
  const qtySold = payload.qty_sold !== undefined ? toNumber(payload.qty_sold) : null;

  console.log(`📦 [reduceStockFromSale] START`);
  console.log(`   unit_level: '${payload.unit_level}' → '${unitLevel}'`);
  console.log(`   code: '${code}'`);
  console.log(`   name: '${name}'`);

  let stockChange = null;
  if (payload.stock_change !== undefined && payload.stock_change !== null) {
    stockChange = toNumber(payload.stock_change);
  } else if (qtySold !== null) {
    stockChange = -Math.abs(qtySold); // vente => négatif obligatoirement
  }

  // 2) Validations
  if (!code) throw new Error("Code produit requis (product_code).");
  if (!unitLevel || !SHEETS[unitLevel]) {
    throw new Error("unit_level invalide. Reçu: " + unitLevel + " (attendu clé SHEETS: " + Object.keys(SHEETS).join(', ') + ")");
  }
  if (stockChange === null) {
    throw new Error("qty_sold ou stock_change requis pour réduire le stock.");
  }

  // ✅ FIX: Permettre les ajouts positifs pour AUTO_STOCK (adjustment)
  // Ne forcer négatif QUE si c'est une vente (pas un adjustment)
  const reason = String(payload.reason || '').toLowerCase();
  const isAdjustment = reason === 'adjustment' || reason === 'auto_stock' || reason === 'replenish';
  
  if (!isAdjustment && stockChange > 0) {
    // ⚠️ Sécurité: pour les ventes, forcer négatif
    stockChange = -Math.abs(stockChange);
    console.log(`   ⚠️ stockChange forcé négatif (vente): ${stockChange}`);
  } else if (isAdjustment) {
    console.log(`   ✅ stockChange conservé tel quel (adjustment): ${stockChange}`);
  }

  // 3) Sélectionner feuille
  const sheetName = SHEETS[unitLevel];
  console.log(`   sheetName: '${sheetName}' (from SHEETS['${unitLevel}'])`);
  
  const sheet = getSheetOrThrow(sheetName);

  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) throw new Error("Feuille vide: " + sheetName);

  const header = values[0];

  // 4) Trouver colonnes requises par recherche flexible sur header
  const colCode = findColumnIndexByNames(header, ['Code produit', 'code produit', 'code']);
  const colName = findColumnIndexByNames(header, ['Nom du produit', 'nom du produit', 'nom']);
  const colStock = findColumnIndexByNames(header, ['Stock initial', 'stock initial', 'stock']);
  const colDateMaj = findColumnIndexByNames(header, ['Date de dernière mise à jour', 'date de dernière mise à jour', 'date maj']);
  const colUpdatedAt = findColumnIndexByNames(header, ['_updated_at']);
  const colDeviceId = findColumnIndexByNames(header, ['_device_id']);

  console.log(`   colonnes trouvées: code=${colCode}, name=${colName}, stock=${colStock}, dateMaj=${colDateMaj}, updatedAt=${colUpdatedAt}`);

  if (colCode === -1 || colStock === -1) {
    throw new Error(`Colonnes manquantes dans ${sheetName}. Requis: 'Code produit' et 'Stock initial'. Header: ${header.join(' | ')}`);
  }

  // 5) Chercher ligne par code (et nom si doublons)
  const matches = [];
  for (let r = 2; r <= values.length; r++) {
    const row = values[r - 1];
    const rowCode = normalizeCode(row[colCode - 1]);
    if (rowCode === code) matches.push(r);
  }
  if (matches.length === 0) {
    throw new Error(`Produit non trouvé dans ${sheetName}: code='${code}'. Codes disponibles dans feuille: ${[...new Set(values.slice(1).map(r => normalizeCode(r[colCode-1])))].slice(0, 10).join(', ')}`);
  }

  console.log(`   trouvé ${matches.length} ligne(s) avec code='${code}'`);

  let rowIndex = matches[0];
  if (matches.length > 1 && colName > 0 && name) {
    const byName = matches.find(r => normalizeText(values[r - 1][colName - 1]) === name);
    if (byName) {
      rowIndex = byName;
      console.log(`   utilisation ligne ${rowIndex} (désambiguïsation par nom)`);
    }
  }

  // 6) Mettre à jour stock
  const currentStock = toNumber(values[rowIndex - 1][colStock - 1]);
  const newStock = Math.round((currentStock + stockChange) * 100) / 100;

  console.log(`   mise à jour: stock ${currentStock} + (${stockChange}) = ${newStock} (row ${rowIndex}, col ${colStock})`);

  sheet.getRange(rowIndex, colStock).setValue(newStock);

  // 7) Tech columns (si existent)
  const iso = nowIso();
  if (colDateMaj > 0) sheet.getRange(rowIndex, colDateMaj).setValue(iso);
  if (colUpdatedAt > 0) sheet.getRange(rowIndex, colUpdatedAt).setValue(iso);
  if (colDeviceId > 0 && payload.device_id !== undefined) sheet.getRange(rowIndex, colDeviceId).setValue(String(payload.device_id || ''));

  console.log(`✅ [REDUCE_STOCK] ${sheetName} row=${rowIndex} code=${code} name=${name || '(n/a)'} stock ${currentStock} + (${stockChange}) => ${newStock}`);

  return { sheet: sheetName, row: rowIndex, old_stock: currentStock, new_stock: newStock };
}

// =========================
// IDEMPOTENCY (ANTI-DOUBLON)
// =========================
const IDEMP_TTL_SEC = 6 * 60 * 60; // 6h

/**
 * ✅ Stable hash pour déduplication
 * Calcule une clé déterministe basée sur SHA-1
 */
function stableHash_(str) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1,
    String(str),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + ((b & 0xff).toString(16))).slice(-2)).join('');
}

/**
 * ✅ Déduit request_id depuis le payload
 * Cherche d'abord request_id, puis req_id, op_id, batch_id, idempotency_key
 */
function getRequestId_(data) {
  return (
    data.request_id ||
    data.req_id ||
    data.op_id ||
    data.batch_id ||
    data.idempotency_key ||
    null
  );
}

/**
 * ✅ Vérifie si requête est déjà traitée (dans le cache)
 * Si oui: retourne true (duplicate)
 * Si non: marque dans cache et retourne false (nouvelle)
 */
function isDuplicateRequest_(key) {
  if (!key) return false;
  const cache = CacheService.getScriptCache();
  const existing = cache.get(key);
  if (existing) return true;
  cache.put(key, '1', IDEMP_TTL_SEC);
  return false;
}

/**
 * ✅ UUID déterministe pour Ventes (basé sur invoice + code + unit + mark)
 */
function saleDeterministicUuid_(p) {
  const invoice = normalizeCode(p.invoice_number);
  const code = normalizeCode(p.product_code);
  const unit = normalizeUnitLevel(p.unit_level);
  const mark = normalizeMark(p.unit_mark);

  const base = [invoice, code, unit, mark].join('|');
  return `SALE-${stableHash_(base).slice(0, 24)}`;
}

/**
 * ✅ UUID déterministe pour Dettes (basé sur invoice + client + produit)
 */
function debtDeterministicUuid_(p) {
  const invoice = normalizeCode(p.invoice_number);
  const client = (p.client_name || '').toString().trim().toUpperCase();
  const produit = (p.product_description || p.note || '').toString().trim();

  const base = [invoice, client, produit].join('|');
  return `DEBT-${stableHash_(base).slice(0, 24)}`;
}

/**
 * ✅ HELPER: Calcule le max _updated_at parmi les lignes
 * Nécessaire pour l'incrémental (batch pull)
 */
function computeMaxUpdatedAt(rows, fallbackIso) {
  let max = toDate(fallbackIso) || new Date(0);

  for (const r of (rows || [])) {
    const d = toDate(
      r?._remote_updated_at ||
      r?._updated_at ||
      r?.last_update ||
      r?.updated_at ||
      r?.created_at ||
      r?.sold_at ||
      r?.effective_at ||
      null
    );
    if (d && d > max) max = d;
  }

  return max.toISOString();
}

/**
 * Assure colonnes techniques (_uuid, _updated_at, _device_id)
 */
function ensureTechColumns(sheet) {
  ensureColumn(sheet, '_uuid');
  ensureColumn(sheet, '_unit_uuid');
  ensureColumn(sheet, '_updated_at');
  ensureColumn(sheet, '_device_id');
  ensureColumn(sheet, '_version');
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
    const col = e.range.getColumn();
    if (row <= 1) return; // ignore header
    
    // ✅ PRO: Détecter modifications colonnes clés (B=Nom, F=Mark) et mettre à jour tech columns
    ensureTechColumns(sheet);
    
    const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
    const colVersion = findColumnIndex(sheet, '_version');
    const colUuid = findColumnIndex(sheet, '_uuid');
    
    // Colonnes clés: B (Nom/name) et F (Mark)
    const sheetName = sheet.getName().toLowerCase();
    const isUnitSheet = ['carton', 'milliers', 'piece'].some(s => sheetName.includes(s)) || 
                       sheetName.includes('product') || sheetName.includes('inventory');
    
    if (isUnitSheet && (col === 2 || col === 6)) {
      // col 2 = Nom, col 6 = Mark
      const isNameChange = (col === 2);
      const isMarkChange = (col === 6);
      
      // 1️⃣ Remplir _uuid si manquant
      if (colUuid > 0) {
        const existingUuid = sheet.getRange(row, colUuid).getValue();
        if (!existingUuid || String(existingUuid).trim() === '') {
          const newUuid = Utilities.getUuid();
          sheet.getRange(row, colUuid).setValue(newUuid);
          console.log(`[onEdit] 🆔 UUID généré pour ligne ${row}: ${newUuid}`);
        }
      }
      
      // 2️⃣ Mettre à jour _updated_at
      if (colUpdatedAt > 0) {
        sheet.getRange(row, colUpdatedAt).setValue(nowIso());
      }
      
      // 3️⃣ Incrémenter _version
      if (colVersion > 0) {
        const currentVersion = sheet.getRange(row, colVersion).getValue();
        const newVersion = (typeof currentVersion === 'number' ? currentVersion : 0) + 1;
        sheet.getRange(row, colVersion).setValue(newVersion);
        console.log(`[onEdit] 📝 Ligne ${row} - Version: ${newVersion} (${isNameChange ? 'Nom' : 'Mark'} modifié)`);
      }
    }
    
    // ✅ Toujours mettre à jour _updated_at sur toute modification
    if (colUpdatedAt > 0) {
      sheet.getRange(row, colUpdatedAt).setValue(nowIso());
    }
    
  } catch (err) {
    // ne pas casser l'édition utilisateur
    logDebug('onEdit error:', err);
  }
}

/**
 * ✅ PRO: Backfill UUID pour toutes les lignes sans _uuid
 * Traverse toutes les feuilles produit et génère UUID manquants
 */
function backfillAllUUIDs() {
  const sheets = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
  let totalBackfilled = 0;
  
  for (const sheetName of sheets) {
    const sheet = getSheet(sheetName);
    ensureTechColumns(sheet);
    
    const colUuid = findColumnIndex(sheet, '_uuid');
    if (colUuid <= 0) continue;
    
    const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
    const colVersion = findColumnIndex(sheet, '_version');
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) continue;
    
    const uuidRange = sheet.getRange(2, colUuid, lastRow - 1, 1);
    const uuidValues = uuidRange.getValues();
    
    const updatesToApply = [];
    
    for (let i = 0; i < uuidValues.length; i++) {
      const existingUuid = uuidValues[i][0];
      if (!existingUuid || String(existingUuid).trim() === '') {
        const newUuid = Utilities.getUuid();
        const updates = [newUuid];
        
        // Mettre à jour _updated_at et _version aussi
        if (colUpdatedAt > 0) {
          updates.push(nowIso());
        }
        if (colVersion > 0) {
          updates.push(1);
        }
        
        updatesToApply.push([i + 2, newUuid]);  // row index
        totalBackfilled++;
      }
    }
    
    // Écrire les UUIDs générés
    for (const [rowNum, uuid] of updatesToApply) {
      sheet.getRange(rowNum, colUuid).setValue(uuid);
      if (colUpdatedAt > 0) sheet.getRange(rowNum, colUpdatedAt).setValue(nowIso());
      if (colVersion > 0) sheet.getRange(rowNum, colVersion).setValue(1);
      console.log(`[backfillAllUUIDs] 🆔 Ligne ${rowNum} (${sheetName}): ${uuid}`);
    }
  }
  
  console.log(`[backfillAllUUIDs] ✅ Total UUID générés: ${totalBackfilled}`);
  return totalBackfilled;
}

/**
 * ✅ PRO: Récupère les modifications depuis Sheets (Pull)
 * Stratégie: "Last Write Wins" (LWW) - compare updated_at
 * Retourne les produits modifiés avec leur version et UUID
 */
function getPullChanges(sinceDate) {
  const results = {
    products: [],      // Modifications de name/mark
    units: [],         // Modifications de stock/prix
    conflicts: [],     // Conflits détectés
    meta: {
      total: 0,
      since: sinceDate ? sinceDate.toISOString() : '1970-01-01T00:00:00Z',
      pulledAt: nowIso()
    }
  };
  
  const sheets = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
  const sinceTs = sinceDate ? sinceDate.getTime() : 0;
  
  for (const sheetName of sheets) {
    const sheet = getSheet(sheetName);
    ensureTechColumns(sheet);
    
    const colUuid = findColumnIndex(sheet, '_uuid');
    const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
    const colVersion = findColumnIndex(sheet, '_version');
    const colName = firstCol(sheet, ['Nom du produit', 'Nom']);
    const colMark = firstCol(sheet, ['Mark', 'MARK']);
    const colCode = findColumnIndex(sheet, 'Code produit');
    const colStock = findColumnIndex(sheet, 'Stock initial');
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) continue;
    
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    
    for (let i = 0; i < values.length; i++) {
      const row = i + 2;
      const uuid = colUuid > 0 ? String(values[i][colUuid - 1] || '') : '';
      const updatedAtVal = colUpdatedAt > 0 ? values[i][colUpdatedAt - 1] : null;
      const updatedAt = toDate(updatedAtVal);
      const version = colVersion > 0 ? (values[i][colVersion - 1] || 0) : 0;
      const name = colName > 0 ? values[i][colName - 1] : '';
      const mark = colMark > 0 ? values[i][colMark - 1] : '';
      const code = colCode > 0 ? values[i][colCode - 1] : '';
      const stock = colStock > 0 ? values[i][colStock - 1] : 0;
      
      // Filtrer par date
      if (updatedAt && updatedAt.getTime() > sinceTs) {
        const unitLevel = sheetName === SHEETS.CARTON ? 'CARTON' : 
                         (sheetName === SHEETS.MILLIERS ? 'MILLIER' : 'PIECE');
        
        // Enregistrer comme changement de produit
        results.products.push({
          uuid: uuid || Utilities.getUuid(),
          code,
          name,
          mark,
          unit: unitLevel,
          version,
          updated_at: updatedAt.toISOString(),
          row,
          sheet: sheetName,
          stock  // Inclure aussi pour info
        });
        
        results.meta.total++;
      }
    }
  }
  
  console.log(`[getPullChanges] 📥 ${results.meta.total} changement(s) depuis ${sinceDate?.toISOString()}`);
  return results;
}

/**
 * ✅ PRO: Propage name/mark sur toutes les unités d'un produit via son CODE
 * ⭐ ROBUST: Même si _uuid diffère entre feuilles, le Code est identique partout
 * Remplace propagateNameMarkToAllUnits (basée sur UUID) qui ne marche pas
 */
function propagateNameMarkByCode(code, newName, newMark) {
  if (!code) {
    console.warn('[propagateNameMarkByCode] Code vide');
    return 0;
  }
  
  const codeNormalized = normalizeCode(code);
  const sheets = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
  let countUpdated = 0;
  
  for (const sheetName of sheets) {
    const sheet = getSheet(sheetName);
    if (!sheet) continue;
    ensureTechColumns(sheet);
    
    const colCode = firstCol(sheet, ['Code produit', 'Code']);
    const colName = firstCol(sheet, ['Nom du produit', 'Nom']);
    const colMark = firstCol(sheet, ['Mark', 'MARK']);
    const colUpdatedAt = firstCol(sheet, ['_updated_at', '_date_update']);
    const colVersion = firstCol(sheet, ['_version']);
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1 || colCode <= 0) continue;
    
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    
    for (let i = 0; i < values.length; i++) {
      const rowCode = normalizeCode(String(values[i][colCode - 1] || '').trim());
      
      if (rowCode === codeNormalized) {
        const row = i + 2;
        
        // Mettre à jour name si fourni
        if (newName !== undefined && newName !== null && colName > 0) {
          sheet.getRange(row, colName).setValue(String(newName ?? ''));
          console.log(`[propagateNameMarkByCode] ✏️  ${sheetName} ligne ${row}: Nom → "${newName}"`);
        }
        
        // Mettre à jour mark si fourni
        if (newMark !== undefined && newMark !== null && colMark > 0) {
          sheet.getRange(row, colMark).setValue(normalizeMark(newMark));
          console.log(`[propagateNameMarkByCode] 🏷️  ${sheetName} ligne ${row}: Mark → "${newMark}"`);
        }
        
        // Mettre à jour _updated_at et _version
        if (colUpdatedAt > 0) sheet.getRange(row, colUpdatedAt).setValue(nowIso());
        if (colVersion > 0) {
          const currentVersion = values[i][colVersion - 1] || 0;
          sheet.getRange(row, colVersion).setValue(currentVersion + 1);
        }
        
        countUpdated++;
      }
    }
  }
  
  console.log(`[propagateNameMarkByCode] ✅ ${countUpdated} ligne(s) mise(s) à jour pour Code "${code}"`);
  
  return countUpdated;
}

/**
 * DEPRECATED: Ancienne fonction basée sur UUID
 * Garde pour compatibilité seulement
 * Utiliser propagateNameMarkByCode() à la place (plus robuste)
 */
function propagateNameMarkToAllUnits(uuid, newName, newMark) {
  if (!uuid) {
    console.warn('[propagateNameMarkToAllUnits] DEPRECATED - utiliser propagateNameMarkByCode() à la place');
    return 0;
  }
  
  const sheets = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
  let countUpdated = 0;
  
  for (const sheetName of sheets) {
    const sheet = getSheet(sheetName);
    ensureTechColumns(sheet);
    
    const colUuid = findColumnIndex(sheet, '_uuid');
    const colName = firstCol(sheet, ['Nom du produit', 'Nom']);
    const colMark = firstCol(sheet, ['Mark', 'MARK']);
    const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
    const colVersion = findColumnIndex(sheet, '_version');
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) continue;
    
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    
    for (let i = 0; i < values.length; i++) {
      const rowUuid = colUuid > 0 ? String(values[i][colUuid - 1] || '') : '';
      
      if (rowUuid === uuid) {
        const row = i + 2;
        
        // Mettre à jour name si fourni et différent
        if (newName !== undefined && newName !== null && colName > 0) {
          const currentName = values[i][colName - 1];
          if (String(currentName || '') !== String(newName)) {
            sheet.getRange(row, colName).setValue(newName);
            console.log(`[propagateNameMarkToAllUnits] ✏️  ${sheetName} ligne ${row}: Nom → "${newName}"`);
          }
        }
        
        // Mettre à jour mark si fourni et différent
        if (newMark !== undefined && newMark !== null && colMark > 0) {
          const currentMark = values[i][colMark - 1];
          if (String(currentMark || '') !== String(newMark)) {
            sheet.getRange(row, colMark).setValue(newMark);
            console.log(`[propagateNameMarkToAllUnits] 🏷️  ${sheetName} ligne ${row}: Mark → "${newMark}"`);
          }
        }
        
        // Mettre à jour _updated_at et _version
        if (colUpdatedAt > 0) sheet.getRange(row, colUpdatedAt).setValue(nowIso());
        if (colVersion > 0) {
          const currentVersion = values[i][colVersion - 1] || 0;
          sheet.getRange(row, colVersion).setValue(currentVersion + 1);
        }
        
        countUpdated++;
      }
    }
  }
  
  if (countUpdated > 0) {
    console.log(`[propagateNameMarkToAllUnits] ✅ ${countUpdated} ligne(s) mise(s) à jour pour UUID ${uuid}`);
  }
  
  return countUpdated;
}

/**
 * ✅ PRO: Gère la synchronisation bidirectionnelle avec résolution de conflits
 * Appelé après un Pull pour synchroniser les modifications
 */
function syncWithConflictResolution(pullChanges, localVersion = null) {
  const conflicts = [];
  const applied = [];
  
  // Stratégie LWW (Last Write Wins): comparer timestamps
  for (const change of pullChanges.products) {
    // Si version local > Sheets → conflit
    if (localVersion && localVersion[change.uuid] && localVersion[change.uuid].version > change.version) {
      conflicts.push({
        uuid: change.uuid,
        reason: 'LOCAL_NEWER',
        sheets_version: change.version,
        sheets_updated_at: change.updated_at,
        local_version: localVersion[change.uuid].version,
        local_updated_at: localVersion[change.uuid].updated_at
      });
      console.log(`[syncWithConflictResolution] ⚠️  Conflit: ${change.uuid} (local plus récent)`);
      continue;
    }
    
    // Sinon: appliquer la modification Sheets
    applied.push(change);
    console.log(`[syncWithConflictResolution] ✅ Appliquer: ${change.uuid} (${change.name} / ${change.mark})`);
  }
  
  return {
    applied,
    conflicts,
    totalApplied: applied.length,
    totalConflicts: conflicts.length
  };
}

/**
 * ENDPOINT: Push depuis local vers Sheets
 * POST avec body: { entity, entity_id, op, payload } OU { action: 'batchPush', ops: [...] }
 * Sécurité: { key: 'API_KEY' } (optionnel, vérifier si configuré)
 */
/**
 * ✅ CONCURRENCE: Éviter que 2 pushes écrivent en même temps
 * Utilise LockService pour synchroniser l'accès aux feuilles
 */
function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);  // Attendre max 30s
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  return withScriptLock_(() => {
    console.log(`📨 [doPost] APPELÉE`);
    try {
      const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
      const data = safeParseJson(body, {});
      
      console.log(`📨 [doPost] Body reçu (first 300 chars): ${body.substring(0, 300)}`);
      console.log(`📨 [doPost] action='${data.action}', ops=${Array.isArray(data.ops) ? data.ops.length : 0}`);
      console.log(`📨 [doPost] Données reçues: ${JSON.stringify(data).substring(0, 300)}...`);
      
      // Sécurité: Vérifier API key si configuré
      const apiKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
      if (apiKey && data.key !== apiKey) {
        return jsonOut({ success: false, error: 'API key invalide', server_time: nowIso() });
      }
      
      const action = (data.action || '').toString().trim().toLowerCase();
      
      // ✅ IDEMPOTENCY: Si le client renvoie la même requête, on répond OK sans réécrire
      const rid = getRequestId_(data);
      const idemKey = rid ? `POST:${action}:${rid}` : null;
      
      if (idemKey && isDuplicateRequest_(idemKey)) {
        console.log(`🛡️ [doPost] DUPLICATE request ignored: ${idemKey}`);
        return jsonOut({
          success: true,
          deduped: true,
          request_id: rid,
          server_time: nowIso()
        });
      }
      
      console.log(`📨 [doPost] Action détectée: '${action}'`);
      
      // ✅ PRO: Push avec propagation name/mark sur toutes unités
      if (action === 'propush') {
        console.log(`📨 [doPost] → Branche PROPUSH`);
        return doProPush(data);
      }
      
      // Mode batchPush (PRO)
      if (action === 'batchpush') {
        console.log(`📨 [doPost] → Branche BATCHPUSH`);
        return handleBatchPush(data);
      }
      
      console.log(`📨 [doPost] → Branche COMPATIBILITÉ ANCIENNE (entity-based)`);
      
      // Compatibilité ancienne: { entity, entity_id, op, payload }
      const entityRaw = data.entity || '';
      const entity = entityRaw.toString().trim().toLowerCase();
      const { entity_id, op, payload } = data;
      
      logDebug('doPost entity:', entity);
      console.log(`📨 [doPost] entity='${entity}', op='${op}', payload=${typeof payload}`);
      
      let result;
      
      switch (entity) {
        case 'products':
        case 'product_units':
          // Vérifier si c'est une opération update_stock
          // CRITIQUE: Vérifier stock_absolute (nouveau mode) OU stock_change (ancien mode pour compatibilité)
          if (op === 'update_stock' && (payload.stock_absolute !== undefined || payload.stock_change !== undefined)) {
            result = handleStockUpdate(payload);
          } else {
            result = handleProductUpsert(payload, entity);
          }
          break;
        case 'stock_moves':
          // ✅ NOUVEAU: Router les stock_moves vers handleStockUpdate
          result = handleStockUpdate(payload);
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
  });
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
    
    // ✅ PRO: Pull amélioré avec détection name/mark
    if (action === 'propull') {
      return doProPull(p);
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
    
    logDebug('📥 [doGet] Requête:', { entity, full, since, cursor, limit });
    
    if (!entity) {
      return jsonOut({
        success: false,
        error: 'Paramètre entity requis',
        server_time: nowIso()
      });
    }
    
    const sinceDate = full ? new Date(0) : (since ? new Date(since) : new Date(0));
    logDebug('📅 [doGet] Date since:', sinceDate.toISOString(), '| Full:', full);
    
    let out;
    const startTime = new Date();
    
    switch (entity) {
      case 'products':
      case 'product_units':
        logDebug(`📦 [${entity.toUpperCase()}] Récupération produits (mode paginé PRO)...`);
        // ⚠️ NOTE: getProductsPage() retourne des UNITS (shape=unit avec unit_level, unit_mark, sale_price_fc)
        // Pas des PRODUCTS regroupés (shape=product avec units:[])
        // Raison: Pagination => impossible regrouper par code dans une page
        // Solution: Le client traite toujours comme product_units, même si entity='products'
        // TOUJOURS utiliser pagination pour products (évite timeout)
        out = getProductsPage(sinceDate, cursor, limit, p.unit_level || '');
        logDebug('✅ [PRODUCTS] Produits récupérés:', out.data?.length || 0, '| Done:', out.done, '| Next cursor:', out.next_cursor);
        break;
      case 'sales':
        logDebug('💰 [SALES] Récupération ventes (mode paginé PRO)...');
        logDebug('📅 [SALES] Paramètres: sinceDate=', sinceDate, '| cursor=', cursor, '| limit=', limit, '| full=', full);
        // TOUJOURS utiliser pagination pour sales (évite timeout)
        // Passer sinceDate comme Date (pas string) pour getSalesPage
        const salesSinceDate = full ? new Date(0) : sinceDate;
        logDebug('📅 [SALES] sinceDate pour getSalesPage:', salesSinceDate.toISOString(), '| getTime():', salesSinceDate.getTime());
        out = getSalesPage(salesSinceDate, cursor, limit);
        logDebug('✅ [SALES] Ventes récupérées:', out.data?.length || 0, '| Done:', out.done, '| Next cursor:', out.next_cursor);
        if (out.data && out.data.length === 0) {
          logDebug('⚠️ [SALES] Aucune vente retournée - Vérifier que la feuille "Ventes" contient des données');
        }
        break;
      case 'debts':
        logDebug('💳 [DEBTS] Récupération dettes (mode paginé PRO)...');
        // TOUJOURS utiliser pagination pour debts (évite timeout)
        out = getDebtsPage(sinceDate, cursor, limit);
        logDebug('✅ [DEBTS] Dettes récupérées:', out.data?.length || 0, '| Done:', out.done, '| Next cursor:', out.next_cursor);
        break;
      case 'rates':
        logDebug('💱 [RATES] Récupération taux...');
        const ratesResult = getRatesSince(sinceDate);
        out = { data: ratesResult, next_cursor: null, done: true };
        logDebug('✅ [RATES] Taux récupérés:', ratesResult.length);
        break;
      case 'users':
        logDebug('👥 [USERS] Récupération utilisateurs...');
        const usersResult = getUsersSince(sinceDate);
        out = { data: usersResult, next_cursor: null, done: true };
        logDebug('✅ [USERS] Utilisateurs récupérés:', usersResult.length);
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
    logDebug('⏱️ [doGet] Durée totale:', duration, 'ms');
    logDebug('📊 [doGet] Résultat final: count =', out.data?.length || 0);
    
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
 * ✅ ENDPOINT PRO: Pull amélioré avec détection des modifications name/mark
 * GET ?action=proPull&since={ISO date}&includeConflicts=1
 * Retourne les changements de produit avec stratégie LWW (Last Write Wins)
 */
function doProPull(p) {
  try {
    const sinceStr = (p.since || new Date(0).toISOString()).toString();
    const sinceDate = toDate(sinceStr) || new Date(0);
    const includeConflicts = p.includeConflicts === '1' || p.includeConflicts === true;
    
    console.log(`[doProPull] 📥 Début pull PRO depuis: ${sinceDate.toISOString()}`);
    
    // Récupérer les modifications
    const pullChanges = getPullChanges(sinceDate);
    
    // Appliquer la résolution de conflits
    const syncResult = syncWithConflictResolution(pullChanges, {});
    
    return jsonOut({
      success: true,
      data: {
        products: syncResult.applied,
        conflicts: includeConflicts ? syncResult.conflicts : [],
        meta: {
          ...pullChanges.meta,
          applied: syncResult.totalApplied,
          conflicts: syncResult.totalConflicts
        }
      },
      server_time: nowIso()
    });
    
  } catch (error) {
    console.error('[doProPull] ❌ Erreur:', error.toString());
    return jsonOut({
      success: false,
      error: error.toString(),
      server_time: nowIso()
    });
  }
}

/**
 * ✅ ENDPOINT PRO: Push amélioré avec propagation name/mark sur toutes unités
 * POST { action: 'proPush', updates: [{uuid, name, mark, unit, ...}, ...] }
 * Propage name/mark sur TOUS les UUIDs identiques dans toutes les feuilles
 */
function doProPush(data) {
  try {
    const updates = Array.isArray(data.updates) ? data.updates : [];
    console.log(`[doProPush] 📤 Début push PRO avec ${updates.length} mise(s) à jour`);
    
    if (updates.length === 0) {
      return jsonOut({
        success: true,
        applied: [],
        propagated: [],
        server_time: nowIso()
      });
    }
    
    const applied = [];
    const propagated = [];
    
    for (const update of updates) {
      const { uuid, name, mark, unit, ...payload } = update;
      
      // Extraire le code pour la propagation (par Code au lieu d'UUID)
      const code = update.code || update.product_code || update.Code_produit;
      
      if (!uuid && !code) {
        console.warn('[doProPush] ⚠️  UUID et Code manquants dans update');
        continue;
      }
      
      // Si name ou mark changent → propager sur toutes les unités (par Code, plus robuste)
      if (name || mark) {
        const countPropagated = code ? propagateNameMarkByCode(code, name, mark) : 0;
        propagated.push({
          uuid,
          code,
          name,
          mark,
          countPropagated
        });
        console.log(`[doProPush] ✅ Propagé name/mark pour Code "${code}" (${countPropagated} unité(s))`);
      }
      
      applied.push({
        uuid,
        status: 'applied',
        nameChanged: !!name,
        markChanged: !!mark
      });
    }
    
    return jsonOut({
      success: true,
      applied,
      propagated,
      server_time: nowIso()
    });
    
  } catch (error) {
    console.error('[doProPush] ❌ Erreur:', error.toString());
    return jsonOut({
      success: false,
      error: error.toString(),
      server_time: nowIso()
    });
  }
}

/**
 * Gère l'upsert d'un produit/unité dans les feuilles Stock (Carton/Milliers/Piece)
 * ✅ AMÉLIORÉ PRO v2:
 *  - Accepte PLUSIEURS noms de champs (name, product_name, nom, etc.)
 *  - Normalise Mark (DZ vs dz vs dozen → DZ)
 *  - ✅ TOUJOURS match par code+mark normalisés (même pour CARTON)
 *  - ✅ Écrit _updated_at (onEdit ne s'exécute pas pour scripts)
 *  - ✅ Génère UUID auto si absent
 */
function handleProductUpsert(payload, entityType) {
  // VÉRIFICATION: payload ne doit pas être undefined ou null (objet vide {} est OK)
  if (payload === undefined || payload === null) {
    console.log(`❌ [handleProductUpsert] ERREUR: payload est undefined ou null`);
    throw new Error('[handleProductUpsert] payload manquant');
  }
  
  // payload peut être un objet vide {} - c'est acceptable
  
  // ✅ Accepter plusieurs noms de champs venant de l'app
  const code = pickFirst(payload, ['code', 'product_code', 'Code produit']);
  const name = pickFirst(payload, ['name', 'product_name', 'nom', 'productName', 'Nom du produit']);
  const unit_level = pickFirst(payload, ['unit_level', 'unite', 'unit', 'Unite', 'mode_stock']);
  const unit_mark_raw = pickFirst(payload, ['unit_mark', 'mark', 'MARK', 'Mark']);

  console.log(`📦 [handleProductUpsert] Extraction champs:`);
  console.log(`   code='${code}' (from ${code ? 'payload' : 'VIDE'})`);
  console.log(`   name='${name}' (from ${name ? 'payload' : 'VIDE'})`);
  console.log(`   unit_level='${unit_level}'`);
  console.log(`   pickFirst pour name: Cherche dans ['name', 'product_name', 'nom', 'productName', 'Nom du produit']`);

  const stock_initial = pickFirst(payload, ['stock_initial', 'stockInit']);
  const stock_current = pickFirst(payload, ['stock_current', 'stock', 'stockCurrent']);

  const purchase_price_usd = pickFirst(payload, ['purchase_price_usd', 'buy_usd', "Prix d'achat (USD)"]);
  const sale_price_fc = pickFirst(payload, ['sale_price_fc', 'price_fc', 'Prix de vente (FC)', 'Prix de vente détail (FC)']);
  const sale_price_usd = pickFirst(payload, ['sale_price_usd', 'price_usd', 'Prix ventes (USD)']);

  const auto_stock_factor = pickFirst(payload, ['auto_stock_factor', 'automation_stock', 'Automatisation Stock']);
  const last_update = pickFirst(payload, ['last_update', 'updated_at', 'Date de dernière mise à jour']);
  const uuid = pickFirst(payload, ['uuid', '_uuid']);
  const unit_uuid = pickFirst(payload, ['unit_uuid', '_unit_uuid']); // ✅ NEW: Extract unit UUID

  console.log(`📦 [handleProductUpsert] Début upsert:`);
  console.log(`   code='${code}', name='${name}', unit_level='${unit_level}', unit_mark='${unit_mark_raw}'`);
  console.log(`   uuid='${uuid || 'absent'}', type=${typeof payload}`);
  console.log(`   🔍 Payload details: ${JSON.stringify(payload).substring(0, 200)}...`);

  // ✅ Normaliser code + unit_level + mark
  const codeNormalized = normalizeCode(code);
  const unitLevelFinal = normalizeUnitLevel(unit_level);
  const markNormalized = normalizeMark(unit_mark_raw);

  if (!codeNormalized) throw new Error('[handleProductUpsert] code produit vide');
  if (!['CARTON','MILLIERS','PIECE'].includes(unitLevelFinal)) {
    throw new Error('[handleProductUpsert] unit_level invalide: ' + unitLevelFinal);
  }

  // Détermine la feuille selon unit_level (canonique = MILLIERS)
  const sheetName =
    unitLevelFinal === 'CARTON' ? SHEETS.CARTON :
    unitLevelFinal === 'MILLIERS' ? SHEETS.MILLIERS :
    SHEETS.PIECE;

  console.log(`   📄 Feuille cible: ${sheetName}`);

  const sheet = getSheet(sheetName);

  // S'assurer que les colonnes existent
  ensureColumn(sheet, 'Code produit');
  ensureColumn(sheet, 'Nom du produit');
  ensureColumn(sheet, 'Stock initial');
  ensureColumn(sheet, "Prix d'achat (USD)");
  ensureColumn(sheet, 'Prix de vente (FC)');
  ensureColumn(sheet, 'Prix de vente détail (FC)');
  ensureColumn(sheet, 'Mark');
  ensureColumn(sheet, 'Date de dernière mise à jour');
  ensureColumn(sheet, 'Automatisation Stock');
  ensureColumn(sheet, 'Prix ventes (USD)');
  ensureTechColumns(sheet); // ✅ tech columns

  const colCode = findColumnIndex(sheet, 'Code produit');
  const colNom = findColumnIndex(sheet, 'Nom du produit');
  const colStockInit = findColumnIndex(sheet, 'Stock initial');
  const colPrixAchatUSD = findColumnIndex(sheet, "Prix d'achat (USD)");
  const colPrixVenteFC = findColumnIndex(sheet, 'Prix de vente (FC)');
  const colPrixVenteDetailFC = findColumnIndex(sheet, 'Prix de vente détail (FC)');
  const colMark = findColumnIndex(sheet, 'Mark');
  const colDateUpdate = findColumnIndex(sheet, 'Date de dernière mise à jour');
  const colAutoStock = findColumnIndex(sheet, 'Automatisation Stock');
  const colPrixVenteUSD = findColumnIndex(sheet, 'Prix ventes (USD)');
  const colUuid = findColumnIndex(sheet, '_uuid');
  const colUnitUuid = findColumnIndex(sheet, '_unit_uuid'); // ✅ NEW: Unit UUID
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at'); // ✅ tech
  const colDeviceId = findColumnIndex(sheet, '_device_id'); // ✅ tech

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  // ✅ RECHERCHE COHÉRENTE: UUID (priorité) sinon (code + mark normalisé)
  let rowIndex = -1;
  let existingUuid = '';

  for (let i = 0; i < values.length; i++) {
    const rowCode = normalizeCode(values[i][colCode - 1]);
    const rowUuid = colUuid > 0 ? normalizeCode(values[i][colUuid - 1]) : '';
    const rowMark = colMark > 0 ? normalizeMark(values[i][colMark - 1]) : '';

    // PRIORITÉ 1: UUID si fourni
    if (uuid && rowUuid && rowUuid === uuid) {
      rowIndex = i + 2;
      existingUuid = rowUuid;
      console.log(`   ✅ Produit trouvé par UUID à la ligne ${rowIndex}`);
      break;
    }

    // PRIORITÉ 2: code SEUL dans la feuille courante
    // ⚠️ IMPORTANT: L'unité est déjà implicite (chaque feuille = une unité)
    // Code ne change JAMAIS une fois créé
    // Mark est MODIFIABLE donc n'est pas critère de recherche (sauf si fourni AND unit_mark aussi fourni)
    if (rowCode === codeNormalized) {
      // Si mark est fourni ET plusieurs lignes pour le même code, affiner la recherche
      if (markNormalized && markNormalized !== '') {
        if (rowMark === markNormalized) {
          rowIndex = i + 2;
          existingUuid = rowUuid;
          console.log(`   ✅ Produit trouvé par Code+Mark à la ligne ${rowIndex}`);
          break;
        }
      } else {
        // Pas de mark fourni, prendre la première ligne avec ce code
        rowIndex = i + 2;
        existingUuid = rowUuid;
        console.log(`   ✅ Produit trouvé par Code à la ligne ${rowIndex}`);
        break;
      }
    }
  }

  const now = nowIso();
  
  // ✅ Générer un UUID automatiquement si absent
  let finalUuid = uuid || existingUuid;
  if (!finalUuid) {
    finalUuid = generateFullUUID();
    console.log(`   🆔 UUID généré automatiquement: ${finalUuid}`);
  }

  // Préparer les valeurs de la ligne
  const rowData = [];
  const maxCol = Math.max(colCode, colNom, colStockInit, colPrixAchatUSD, 
                          colPrixVenteFC, colPrixVenteDetailFC, colMark, 
                          colDateUpdate, colAutoStock, colPrixVenteUSD, colUuid, colUpdatedAt, colDeviceId);

  // Initialiser avec valeurs existantes si update
  if (rowIndex > 0) {
    for (let i = 0; i < maxCol; i++) {
      rowData[i] = (values[rowIndex - 2][i] ?? '');
    }
  } else {
    for (let i = 0; i < maxCol; i++) {
      rowData[i] = '';
    }
  }

  // ✅ Écriture SAFE: ne pas écraser avec undefined
  if (colCode > 0) rowData[colCode - 1] = codeNormalized;
  
  // ✅ TOUJOURS écrire le nom quand fourni ET non-vide
  // ⚠️ Si nom vide/undefined: NE PAS écraser le nom existant (keep update mode)
  if (colNom > 0 && name !== undefined && name !== null && String(name).trim() !== '') {
    rowData[colNom - 1] = String(name).trim();
    console.log(`   ✅ Nom ÉCRIT: '${String(name).trim()}'`);
  } else if (rowIndex <= 0) {
    // CREATE mode: Si pas de nom, laisser vide
    if (colNom > 0) rowData[colNom - 1] = '';
    console.log(`   ⚠️ Nom non écrit (CREATE mode, pas de nom): name='${name}'`);
  } else {
    console.log(`   ⚠️ Nom NOT écrit (UPDATE mode, garder l'existant): name='${name}'`);
  }
  // UPDATE mode: Si nom vide → ne pas toucher au nom existant (déjà en rowData)

  // ✅ TOUJOURS écrire le mark quand fourni (même s'il est vide)
  if (colMark > 0 && unit_mark_raw !== undefined) rowData[colMark - 1] = markNormalized;

  // Stock: utiliser stock_current en priorité, sinon stock_initial
  if (colStockInit > 0) {
    const stockValue = (stock_current !== undefined) ? stock_current : stock_initial;
    if (stockValue !== undefined) rowData[colStockInit - 1] = toNumber(stockValue);
  }

  if (colPrixAchatUSD > 0 && purchase_price_usd !== undefined) rowData[colPrixAchatUSD - 1] = toNumber(purchase_price_usd);

  // Prix de vente FC selon la feuille
  if (sale_price_fc !== undefined) {
    if (sheetName === SHEETS.PIECE && colPrixVenteDetailFC > 0) {
      rowData[colPrixVenteDetailFC - 1] = toNumber(sale_price_fc);
    } else if (colPrixVenteFC > 0) {
      rowData[colPrixVenteFC - 1] = toNumber(sale_price_fc);
    }
  }

  if (colAutoStock > 0 && auto_stock_factor !== undefined) rowData[colAutoStock - 1] = toNumber(auto_stock_factor) || 1;
  if (colPrixVenteUSD > 0 && sale_price_usd !== undefined) rowData[colPrixVenteUSD - 1] = toNumber(sale_price_usd);

  // ✅ TECH columns
  if (colUuid > 0) rowData[colUuid - 1] = finalUuid;
  if (colUnitUuid > 0 && unit_uuid !== undefined && unit_uuid !== null) rowData[colUnitUuid - 1] = String(unit_uuid || ''); // ✅ NEW: Write unit UUID
  if (colUpdatedAt > 0) rowData[colUpdatedAt - 1] = now; // ✅ IMPORTANT (onEdit ne s'exécute pas pour scripts)
  if (colDeviceId > 0 && payload.device_id !== undefined) rowData[colDeviceId - 1] = String(payload.device_id || '');
  if (colDateUpdate > 0) rowData[colDateUpdate - 1] = last_update || now;

  if (rowIndex > 0) {
    console.log(`   📝 Mise à jour ligne ${rowIndex}`);
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    console.log(`   ➕ Nouvelle ligne`);
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
  }

  console.log(`   ✅ Upsert terminé: ligne ${rowIndex}, feuille ${sheetName}, uuid=${finalUuid}`);

  return { row: rowIndex, sheet: sheetName, uuid: finalUuid };
}

/**
 * Gère la mise à jour du stock (opération update_stock)
 * ✅ AMÉLIORÉ PRO v2:
 * - CARTON: match par code uniquement (ignoré mark)
 * - Autres: match par code+mark NORMALISÉS
 * - UUID: priorité maximale si fourni
 * - ✅ Écrit _updated_at (onEdit ne s'exécute pas pour scripts)
 * - Mark normalisé (dz → DZ)
 */
/**
 * ✅ UPDATE STOCK - Version simplifiée et robuste
 * 
 * Règles:
 * - Match par Code produit (colonne A) - OBLIGATOIRE
 * - Si plusieurs lignes, utilise Nom pour départager
 * - Écrit toujours dans colonne C (Stock initial)
 * - stock_change DOIT être négatif pour une vente (ex: -3 pour vente de 3)
 * 
 * @param {object} payload - Payload avec product_code, stock_change, unit_level, etc.
 * @param {string} sheetName - (optionnel) Nom de la feuille. Si absent, calculé depuis unit_level
 * @returns {object} {sheet, row, old_stock, new_stock}
 */
function handleStockUpdate(payload, sheetName) {
  console.log(`📦 [handleStockUpdate] START - payload keys: ${Object.keys(payload).join(', ')}`);
  
  try {
    // ✅ Si stock_absolute fourni, convertir en stock_change
    let payloadToUse = { ...payload };
    
    if (payload.stock_absolute !== undefined && payload.stock_absolute !== null) {
      console.log(`📦 [handleStockUpdate] Mode stock_absolute: ${payload.stock_absolute}`);
      
      const unitLevel = normalizeUnitLevel(payload.unit_level || '');
      const sheetToUse = sheetName || SHEETS[unitLevel];
      const sheet = getSheetOrThrow(sheetToUse);
      const values = sheet.getDataRange().getValues();
      const header = values[0];
      
      const colCode = findColumnIndexByNames(header, ['Code produit', 'code produit', 'code']);
      const colStock = findColumnIndexByNames(header, ['Stock initial', 'stock initial', 'stock']);
      
      if (colCode > 0 && colStock > 0) {
        const code = normalizeCode(payload.product_code);
        for (let r = 2; r <= values.length; r++) {
          if (normalizeCode(values[r-1][colCode-1]) === code) {
            const currentStock = toNumber(values[r-1][colStock-1]);
            const delta = payload.stock_absolute - currentStock;
            payloadToUse.stock_change = delta;
            console.log(`📦 [handleStockUpdate] Conversion: current=${currentStock}, target=${payload.stock_absolute}, delta=${delta}`);
            break;
          }
        }
      }
    }
    
    // ✅ Utiliser reduceStockFromSale (robuste, cherche colonnes par header)
    const result = reduceStockFromSale(payloadToUse);
    
    console.log(`✅ [handleStockUpdate] SUCCESS: ${result.sheet} row=${result.row} ${result.old_stock} → ${result.new_stock}`);
    return result;
    
  } catch (error) {
    console.error(`❌ [handleStockUpdate] ERREUR: ${error.message}`);
    throw error;
  }
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
 * ✅ FIX DOUBLONS: Amélioration de la détection + rejet des lignes vides
 */
function handleSaleItemUpsert(payload) {
  const sheet = getSheet(SHEETS.VENTES);
  
  // ✅ ANTI-DOUBLON: Rejeter les lignes vides (qty=0 ou pas de product_code)
  const qtyCheck = toNumber(payload.qty);
  const productCodeCheck = normalizeCode(payload.product_code);
  const invoiceCheck = normalizeCode(payload.invoice_number);
  
  if (qtyCheck <= 0 || !productCodeCheck || !invoiceCheck) {
    console.log(`⏭️ [handleSaleItemUpsert] Ligne ignorée (vide): invoice='${invoiceCheck}', code='${productCodeCheck}', qty=${qtyCheck}`);
    return { skipped: true, reason: 'empty_line', invoice_number: invoiceCheck };
  }
  
  // ✅ Tech columns
  ensureTechColumns(sheet);
  
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
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');  // ✅ tech
  const colDeviceId = findColumnIndex(sheet, '_device_id');   // ✅ tech
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Recherche par UUID ou clé composite (AMÉLIORÉ)
  let rowIndex = -1;
  let searchUuid = (payload.uuid || '').toString().trim();
  
  // ✅ UUID déterministe: si uuid manque, le générer de façon stable
  if (!searchUuid) {
    searchUuid = saleDeterministicUuid_(payload);
    console.log(`🆔 [handleSaleItemUpsert] UUID déterministe généré: ${searchUuid}`);
  }
  
  const searchFacture = normalizeCode(payload.invoice_number);
  const searchCode = normalizeCode(payload.product_code);
  const searchQte = toNumber(payload.qty);
  const searchPrix = toNumber(payload.unit_price_fc);
  const searchUnitLevel = normalizeUnitLevel(payload.unit_level);
  const searchMark = normalizeMark(payload.unit_mark);
  
  for (let i = 1; i < values.length; i++) {
    const rowUuid = colUuid > 0 ? (values[i][colUuid - 1] || '').toString().trim() : '';
    const rowFacture = colFacture > 0 ? normalizeCode(values[i][colFacture - 1]) : '';
    const rowCode = colCode > 0 ? normalizeCode(values[i][colCode - 1]) : '';
    const rowQte = colQte > 0 ? values[i][colQte - 1] : null;
    const rowPrix = colPrixUnitaire > 0 ? values[i][colPrixUnitaire - 1] : null;
    const rowUnite = colUnite > 0 ? normalizeUnitLevel(values[i][colUnite - 1]) : '';
    const rowMode  = colModeStock > 0 ? normalizeUnitLevel(values[i][colModeStock - 1]) : '';
    const rowUnitFinal = rowUnite || rowMode; // ✅ Fallback robuste: Unite OU mode stock
    const rowMark = colMark > 0 ? normalizeMark(values[i][colMark - 1]) : '';
    
    // Match par UUID (prioritaire) - si les deux ont un UUID non vide
    if (searchUuid && rowUuid && searchUuid === rowUuid) {
      rowIndex = i + 1;
      console.log(`✅ [handleSaleItemUpsert] Match UUID: ${searchUuid} → row ${rowIndex}`);
      break;
    }
    
    // Match par clé composite AMÉLIORÉ: facture + code + unit_level (avec fallback) + mark
    // (on ignore qty et prix car ils peuvent varier légèrement)
    const rowQteN = toNumber(rowQte);
    const rowPrixN = toNumber(rowPrix);
    
    // ✅ FIX: Match plus souple - même facture + même produit + même unité = même ligne
    if (rowFacture === searchFacture && 
        rowCode === searchCode &&
        rowUnitFinal === searchUnitLevel &&
        rowMark === searchMark) {
      // Match trouvé - vérifier si c'est vraiment la même ligne (qty proche)
      if (Math.abs(rowQteN - searchQte) < 0.01 && Math.abs(rowPrixN - searchPrix) < 0.01) {
        rowIndex = i + 1;
        console.log(`✅ [handleSaleItemUpsert] Match exact: ${searchFacture}/${searchCode}/${searchUnitLevel} → row ${rowIndex}`);
        break;
      }
      // ✅ FIX DOUBLON: Si même facture/code/unité mais qty différente, 
      // c'est quand même la même ligne (update au lieu de doublon)
      if (rowQteN > 0 && searchQte > 0) {
        rowIndex = i + 1;
        console.log(`⚠️ [handleSaleItemUpsert] Match partiel (update qty): ${searchFacture}/${searchCode} qty ${rowQteN}→${searchQte} → row ${rowIndex}`);
        break;
      }
    }
  }
  
  const maxCol = Math.max(colDate, colFacture, colCode, colClient, colQte, 
                          colMark, colPrixUnitaire, colUnite, colVendeur, colModeStock, 
                          colTelephone, colUSD, colUuid, colUpdatedAt, colDeviceId);  // ✅ tech
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colDate > 0) rowData[colDate - 1] = payload.sold_at || new Date().toISOString();
  if (colFacture > 0) rowData[colFacture - 1] = normalizeCode(payload.invoice_number || '');
  if (colCode > 0) rowData[colCode - 1] = normalizeCode(payload.product_code || '');
  if (colClient > 0) rowData[colClient - 1] = payload.client_name || '';
  if (colQte > 0) rowData[colQte - 1] = payload.qty || 0;
  if (colMark > 0) rowData[colMark - 1] = normalizeMark(payload.unit_mark || '');
  if (colPrixUnitaire > 0) rowData[colPrixUnitaire - 1] = payload.unit_price_fc || 0;
  if (colUnite > 0) rowData[colUnite - 1] = normalizeUnitLevel(payload.unit_level || '');
  if (colVendeur > 0) rowData[colVendeur - 1] = payload.seller_name || '';
  if (colModeStock > 0) rowData[colModeStock - 1] = normalizeUnitLevel(payload.unit_level || '');
  if (colTelephone > 0) rowData[colTelephone - 1] = payload.client_phone || '';
  if (colUSD > 0) rowData[colUSD - 1] = payload.unit_price_usd || payload.subtotal_usd || 0;
  if (colUuid > 0) rowData[colUuid - 1] = searchUuid;
  
  // ✅ Tech columns
  if (colUpdatedAt > 0) rowData[colUpdatedAt - 1] = nowIso();
  if (colDeviceId > 0 && payload.device_id !== undefined) rowData[colDeviceId - 1] = String(payload.device_id || '');
  
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
  }
  
  return { row: rowIndex };
}

/**
 * ✅ NOUVEAU: Met à jour le stock SEULEMENT dans les feuilles de produit
 * (Carton/Milliers/Piece) sans créer de ligne de vente
 * Utilisé UNIQUEMENT pour les STOCK_MOVE avec reason='sale_deleted'
 */
function updateProductStockOnly(payload) {
  console.log(`📊 [updateProductStockOnly] Mise à jour stock uniquement`);
  console.log(`   Produit: ${payload.product_code}`);
  console.log(`   Unité: ${payload.unit_level}`);
  
  const unitLevel = normalizeUnitLevel(payload.unit_level || 'CARTON');
  const sheetName = SHEETS[unitLevel];
  
  if (!sheetName) {
    throw new Error(`Unité inconnue: ${unitLevel}`);
  }
  
  const sheet = getSheet(sheetName);
  if (!sheet) {
    throw new Error(`Feuille non trouvée: ${sheetName}`);
  }
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colStock = findColumnIndex(sheet, 'Stock initial');
  
  if (colCode <= 0 || colStock <= 0) {
    throw new Error(`Colonnes requises manquantes (Code produit ou Stock initial)`);
  }
  
  const productCodeNormalized = normalizeCode(payload.product_code);
  let rowIndex = -1;
  let currentStock = 0;
  
  // Trouver la ligne du produit
  for (let i = 1; i < values.length; i++) {
    const rowCode = normalizeCode(values[i][colCode - 1]);
    if (rowCode === productCodeNormalized) {
      rowIndex = i + 1;
      currentStock = toNumber(values[i][colStock - 1]);
      break;
    }
  }
  
  if (rowIndex <= 0) {
    throw new Error(`Produit non trouvé dans feuille ${sheetName}: ${payload.product_code}`);
  }
  
  // Calculer le nouveau stock
  let newStock = currentStock;
  if (payload.stock_absolute !== undefined && payload.stock_absolute !== null) {
    // Mode ABSOLU: remplacer directement
    newStock = toNumber(payload.stock_absolute);
  } else if (payload.stock_change !== undefined && payload.stock_change !== null) {
    // Mode DELTA: ajouter la différence
    newStock = currentStock + toNumber(payload.stock_change);
  }
  
  console.log(`   Ancien stock: ${currentStock} → Nouveau stock: ${newStock}`);
  
  // Écrire le nouveau stock
  sheet.getRange(rowIndex, colStock).setValue(newStock);
  
  // Mettre à jour le _updated_at si la colonne existe
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  if (colUpdatedAt > 0) {
    sheet.getRange(rowIndex, colUpdatedAt).setValue(nowIso());
  }
  
  return {
    sheet: sheetName,
    row: rowIndex,
    product_code: payload.product_code,
    old_stock: currentStock,
    new_stock: newStock
  };
}

/**
 * ✅ NOUVEAU: Gère la suppression d'une vente (SALE_DELETED)
 * - Trouve la vente par invoice_number
 * - Supprime TOUTES les lignes avec ce numéro de facture
 * - Logs détaillés pour tracking
 */
function handleSaleDeleted(payload) {
  const sheet = getSheet(SHEETS.VENTES);
  
  const invoiceNumber = (payload.invoice_number || '').toString().trim();
  console.log(`🗑️ [handleSaleDeleted] Suppression de la facture: "${invoiceNumber}"`);
  
  if (!invoiceNumber) {
    console.error(`❌ [handleSaleDeleted] Invoice number manquant ou vide`);
    return { deleted: 0, reason: 'missing_invoice_number' };
  }
  
  // Chercher les colonnes
  const colFacture = findColumnIndex(sheet, 'Numéro de facture');
  if (colFacture <= 0) {
    console.error(`❌ [handleSaleDeleted] Colonne 'Numéro de facture' non trouvée`);
    return { deleted: 0, reason: 'column_not_found' };
  }
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Trouver les lignes à supprimer (en sens inverse pour éviter décalages d'index)
  const rowsToDelete = [];
  const invoiceNormalized = normalizeCode(invoiceNumber);
  
  for (let i = 1; i < values.length; i++) {
    const rowFacture = colFacture > 0 ? normalizeCode(values[i][colFacture - 1]) : '';
    if (rowFacture === invoiceNormalized) {
      rowsToDelete.push(i + 1); // +1 car getRange utilise 1-based indexing
      console.log(`   📍 Ligne ${i + 1} à supprimer: facture="${rowFacture}"`);
    }
  }
  
  console.log(`📊 [handleSaleDeleted] Total lignes trouvées: ${rowsToDelete.length}`);
  
  // Supprimer les lignes en ordre décroissant (pour ne pas décaler les indices)
  if (rowsToDelete.length > 0) {
    rowsToDelete.sort((a, b) => b - a);
    for (const rowIndex of rowsToDelete) {
      try {
        sheet.deleteRow(rowIndex);
        console.log(`   ✅ Ligne ${rowIndex} supprimée`);
      } catch (e) {
        console.error(`   ❌ Erreur suppression ligne ${rowIndex}: ${e.toString()}`);
      }
    }
  }
  
  console.log(`✅ [handleSaleDeleted] Facture "${invoiceNumber}" supprimée (${rowsToDelete.length} ligne(s))`);
  
  return { 
    deleted: rowsToDelete.length,
    invoice_number: invoiceNumber,
    rows: rowsToDelete
  };
}

/**
 * ✅ PRO: Gère la suppression d'un produit (PRODUCT_DELETED)
 * - Trouve le produit par code dans Carton, Milliers, Piece
 * - Supprime TOUTES les lignes avec ce code dans toutes les feuilles
 * - Logs détaillés pour tracking
 */
function handleProductDeleted(payload) {
  const productCode = (payload.code || payload.product_code || '').toString().trim();
  console.log(`🗑️ [handleProductDeleted] Suppression du produit: "${productCode}"`);
  
  if (!productCode) {
    console.error(`❌ [handleProductDeleted] Code produit manquant ou vide`);
    return { deleted: 0, reason: 'missing_product_code' };
  }
  
  const sheets = ['Carton', 'Milliers', 'Piece'];
  let totalDeleted = 0;
  const deletedFromSheets = {};
  
  for (const sheetName of sheets) {
    try {
      const sheet = getSheet(sheetName);
      if (!sheet) {
        console.log(`   ⚠️ Feuille '${sheetName}' non trouvée, ignorée`);
        continue;
      }
      
      // Chercher la colonne "Code produit"
      const colCode = findColumnIndex(sheet, 'Code produit');
      if (colCode <= 0) {
        console.log(`   ⚠️ Colonne 'Code produit' non trouvée dans '${sheetName}'`);
        continue;
      }
      
      const dataRange = sheet.getDataRange();
      const values = dataRange.getValues();
      
      // Trouver les lignes à supprimer
      const rowsToDelete = [];
      const codeNormalized = normalizeCode(productCode);
      
      for (let i = 1; i < values.length; i++) {
        const rowCode = colCode > 0 ? normalizeCode(values[i][colCode - 1]) : '';
        if (rowCode === codeNormalized) {
          rowsToDelete.push(i + 1); // +1 car getRange utilise 1-based indexing
          console.log(`   📍 [${sheetName}] Ligne ${i + 1} à supprimer: code="${rowCode}"`);
        }
      }
      
      // Supprimer les lignes en ordre décroissant (pour ne pas décaler les indices)
      if (rowsToDelete.length > 0) {
        rowsToDelete.sort((a, b) => b - a);
        for (const rowIndex of rowsToDelete) {
          try {
            sheet.deleteRow(rowIndex);
            console.log(`   ✅ [${sheetName}] Ligne ${rowIndex} supprimée`);
          } catch (e) {
            console.error(`   ❌ [${sheetName}] Erreur suppression ligne ${rowIndex}: ${e.toString()}`);
          }
        }
        totalDeleted += rowsToDelete.length;
        deletedFromSheets[sheetName] = rowsToDelete.length;
      }
    } catch (e) {
      console.error(`   ❌ Erreur traitement feuille '${sheetName}': ${e.toString()}`);
    }
  }
  
  console.log(`✅ [handleProductDeleted] Produit "${productCode}" supprimé (${totalDeleted} ligne(s) total)`);
  
  return { 
    deleted: totalDeleted,
    product_code: productCode,
    sheets: deletedFromSheets
  };
}

/**
 * Gère l'upsert d'une dette
 */
function handleDebtUpsert(payload) {
  const sheet = getSheet(SHEETS.DETTES);

  // ✅ Guard: ne jamais écrire une dette vide
  const guardInvoice = (payload.invoice_number || '').toString().trim();
  const guardClient = (payload.client_name || '').toString().trim();
  const guardTotalFc = toNumber(payload.total_fc);
  const guardTotalUsd = toNumber(payload.total_usd);
  if (!guardInvoice || !guardClient || (guardTotalFc <= 0 && guardTotalUsd <= 0)) {
    return { skipped: true, reason: 'empty_debt', invoice_number: guardInvoice, client_name: guardClient };
  }
  
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
  
  // ✅ Tech columns
  ensureTechColumns(sheet);
  
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
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');  // ✅ tech
  const colDeviceId = findColumnIndex(sheet, '_device_id');   // ✅ tech
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // Recherche par UUID ou clé composite (améliorée)
  let rowIndex = -1;
  let searchUuid = (payload.uuid || '').toString().trim();
  const searchFacture = normalizeCode(payload.invoice_number);
  const searchClient = (payload.client_name || '').toString().trim().toUpperCase();
  const searchProduit = (payload.product_description || payload.note || '').toString().trim();

  for (let i = 1; i < values.length; i++) {
    const rowUuid = colUuid > 0 ? String(values[i][colUuid - 1] || '').trim() : '';
    if (searchUuid && rowUuid === searchUuid) {
      rowIndex = i + 1;
      break;
    }

    // Composite: facture + client + produit (évite écraser plusieurs lignes même facture)
    const rowFacture = normalizeCode(colFacture > 0 ? values[i][colFacture - 1] : '');
    const rowClient = (colClient > 0 ? String(values[i][colClient - 1] || '').trim().toUpperCase() : '');
    const rowProduit = colProduit > 0 ? String(values[i][colProduit - 1] || '').trim() : '';

    if (!searchUuid && searchFacture && searchClient) {
      if (rowFacture === searchFacture && rowClient === searchClient) {
        // si produit est fourni, il doit matcher
        if (!searchProduit || rowProduit === searchProduit) {
          rowIndex = i + 1;
          break;
        }
      }
    }
  }

  // ✅ Important: si UUID fourni mais pas trouvé, tenter match composite (facture + client + produit)
  // Cela évite d'ajouter un doublon quand la ligne existante a un _uuid différent.
  if (rowIndex < 0 && searchUuid && searchFacture && searchClient) {
    for (let i = 1; i < values.length; i++) {
      const rowFacture = normalizeCode(colFacture > 0 ? values[i][colFacture - 1] : '');
      const rowClient = (colClient > 0 ? String(values[i][colClient - 1] || '').trim().toUpperCase() : '');
      const rowProduit = colProduit > 0 ? String(values[i][colProduit - 1] || '').trim() : '';

      if (rowFacture === searchFacture && rowClient === searchClient) {
        if (!searchProduit || rowProduit === searchProduit) {
          rowIndex = i + 1;
          break;
        }
      }
    }
  }

  // ✅ UUID déterministe: si uuid manque, le générer de façon stable
  let finalUuid = searchUuid;
  if (!finalUuid) {
    finalUuid = debtDeterministicUuid_(payload);
    console.log(`🆔 [handleDebtUpsert] UUID déterministe généré: ${finalUuid}`);
  }
  
  const maxCol = Math.max(colClient, colProduit, colArgent, colPrixAPayer, 
                          colPrixPaye, colReste, colDate, colFacture, 
                          colDollars, colDescription, colDettesFCUSD, colUuid, 
                          colUpdatedAt, colDeviceId);  // ✅ tech
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colClient > 0) rowData[colClient - 1] = (payload.client_name || '').toString().trim();
  if (colProduit > 0) rowData[colProduit - 1] = (payload.product_description || '').toString().trim();
  if (colArgent > 0) rowData[colArgent - 1] = payload.total_fc || 0;
  if (colPrixAPayer > 0) rowData[colPrixAPayer - 1] = payload.total_fc || 0;
  if (colPrixPaye > 0) rowData[colPrixPaye - 1] = payload.paid_fc || 0;
  if (colReste > 0) rowData[colReste - 1] = payload.remaining_fc || 0;
  if (colDate > 0) rowData[colDate - 1] = payload.created_at || new Date().toISOString();
  if (colFacture > 0) rowData[colFacture - 1] = normalizeCode(payload.invoice_number || '');
  if (colDollars > 0) rowData[colDollars - 1] = payload.total_usd || 0;
  if (colDescription > 0) rowData[colDescription - 1] = (payload.product_description || payload.note || '').toString().trim();
  if (colDettesFCUSD > 0) rowData[colDettesFCUSD - 1] = payload.debt_fc_in_usd || 0;
  if (colUuid > 0) rowData[colUuid - 1] = finalUuid;
  
  // ✅ Tech columns
  if (colUpdatedAt > 0) rowData[colUpdatedAt - 1] = nowIso();
  if (colDeviceId > 0 && payload.device_id !== undefined) rowData[colDeviceId - 1] = String(payload.device_id || '');
  
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
  
  // ✅ Tech columns
  ensureTechColumns(sheet);
  
  const colTaux = findColumnIndex(sheet, 'Taux');
  const colUSD = findColumnIndex(sheet, 'USD');
  const colFC = findColumnIndex(sheet, 'Fc');
  const colDate = findColumnIndex(sheet, 'DATE');
  const colUuid = findColumnIndex(sheet, '_uuid');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');  // ✅ tech
  const colDeviceId = findColumnIndex(sheet, '_device_id');   // ✅ tech
  
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
  const maxCol = Math.max(colTaux, colUSD, colFC, colDate, colUuid, 
                          colUpdatedAt, colDeviceId);  // ✅ tech
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colTaux > 0) rowData[colTaux - 1] = rate;
  if (colUSD > 0) rowData[colUSD - 1] = 100; // Standard: 100 USD
  if (colFC > 0) rowData[colFC - 1] = rate * 100; // 100 USD en FC
  if (colDate > 0) rowData[colDate - 1] = searchDate || new Date().toISOString();
  if (colUuid > 0) rowData[colUuid - 1] = searchUuid || '';
  
  // ✅ Tech columns
  if (colUpdatedAt > 0) rowData[colUpdatedAt - 1] = nowIso();
  if (colDeviceId > 0 && payload.device_id !== undefined) rowData[colDeviceId - 1] = String(payload.device_id || '');
  
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
 * ✅ PRO: Support complet des colonnes Vendeur, Gerent Stock, Produits
 */
function handleUserUpsert(payload) {
  const sheet = getSheet(SHEETS.COMPTER_UTILISATEUR);
  
  // Colonnes de base
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
  
  // ✅ Nouvelles colonnes de rôles
  ensureColumn(sheet, 'Vendeur');
  ensureColumn(sheet, 'Gerent Stock');
  ensureColumn(sheet, 'Porudits est Vender');  // = can_manage_products
  
  // ✅ Tech columns
  ensureTechColumns(sheet);
  
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
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');  // ✅ tech
  const colDeviceId = findColumnIndex(sheet, '_device_id');   // ✅ tech
  
  // ✅ Nouvelles colonnes
  const colVendeur = findColumnIndex(sheet, 'Vendeur');
  const colGerentStock = findColumnIndex(sheet, 'Gerent Stock');
  const colProduits = findColumnIndex(sheet, 'Porudits est Vender');
  
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
                          colDateCreation, colToken, colMarque, colUrlProfile, colAdmi, colUuid,
                          colUpdatedAt, colDeviceId,
                          colVendeur, colGerentStock, colProduits);  // ✅ Nouvelles colonnes incluses
  const rowData = [];
  for (let i = 0; i < maxCol; i++) {
    rowData[i] = '';
  }
  
  if (colNom > 0) rowData[colNom - 1] = payload.username || '';
  // Ne pas écrire le mot de passe en clair (sécurité)
  // if (colModePasse > 0) rowData[colModePasse - 1] = ''; 
  if (colNumero > 0) rowData[colNumero - 1] = payload.phone || '';
  
  // ✅ Valide = is_active, afficher "Oui" ou "Non" pour lisibilité
  if (colValide > 0) {
    const isActive = payload.is_active === 1 || payload.is_active === true || payload.is_active === '1' || payload.is_active === 'oui';
    rowData[colValide - 1] = isActive ? 'Oui' : 'Non';
  }
  
  if (colDateCreation > 0) rowData[colDateCreation - 1] = payload.created_at || new Date().toISOString();
  if (colToken > 0) rowData[colToken - 1] = payload.expo_push_token || '';
  if (colMarque > 0) rowData[colMarque - 1] = payload.device_brand || '';
  
  // CRITIQUE: PRÉSERVER l'URL existante si payload.profile_url est vide
  if (colUrlProfile > 0) {
    const existingUrl = rowIndex > 0 ? (values[rowIndex - 1][colUrlProfile - 1] || '') : '';
    rowData[colUrlProfile - 1] = payload.profile_url || existingUrl || '';
  }
  
  // ✅ Admin = is_admin, afficher "OUI" ou "" pour compatibilité
  if (colAdmi > 0) {
    const isAdmin = payload.is_admin === 1 || payload.is_admin === true || payload.is_admin === '1' || payload.is_admin === 'oui';
    rowData[colAdmi - 1] = isAdmin ? 'OUI' : '';
  }
  
  // CRITIQUE: PRÉSERVER l'UUID existant si payload.uuid est vide
  if (colUuid > 0) {
    const existingUuid = rowIndex > 0 ? (values[rowIndex - 1][colUuid - 1] || '') : '';
    rowData[colUuid - 1] = searchUuid || existingUuid || Utilities.getUuid();
  }
  
  // ✅ Nouvelles colonnes de rôles - afficher "oui" ou "" pour compatibilité
  if (colVendeur > 0) {
    const isVendeur = payload.is_vendeur === 1 || payload.is_vendeur === true || payload.is_vendeur === '1' || payload.is_vendeur === 'oui';
    rowData[colVendeur - 1] = isVendeur ? 'oui' : '';
  }
  
  if (colGerentStock > 0) {
    const isGerentStock = payload.is_gerant_stock === 1 || payload.is_gerant_stock === true || payload.is_gerant_stock === '1' || payload.is_gerant_stock === 'oui';
    rowData[colGerentStock - 1] = isGerentStock ? 'oui' : '';
  }
  
  if (colProduits > 0) {
    const canManageProducts = payload.can_manage_products === 1 || payload.can_manage_products === true || payload.can_manage_products === '1' || payload.can_manage_products === 'oui';
    rowData[colProduits - 1] = canManageProducts ? 'oui' : '';
  }
  
  // ✅ Tech columns
  if (colUpdatedAt > 0) rowData[colUpdatedAt - 1] = nowIso();
  if (colDeviceId > 0 && payload.device_id !== undefined) rowData[colDeviceId - 1] = String(payload.device_id || '');
  
  if (rowIndex > 0) {
    // ✅ Mise à jour de la ligne existante
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    console.log(`✅ [handleUserUpsert] Utilisateur mis à jour: ${payload.username} (ligne ${rowIndex})`);
  } else {
    // ✅ Création d'une nouvelle ligne
    sheet.appendRow(rowData);
    rowIndex = sheet.getLastRow();
    console.log(`✅ [handleUserUpsert] Utilisateur créé: ${payload.username} (ligne ${rowIndex})`);
  }
  
  return { row: rowIndex, uuid: rowData[colUuid - 1] || '' };
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
  
  // ✅ Tech columns
  ensureTechColumns(sheet);
  
  const colDate = findColumnIndex(sheet, 'Date');
  const colPrix = findColumnIndex(sheet, 'Prix');
  const colNumeroProduit = findColumnIndex(sheet, 'Numero du produit');
  const colTotal = findColumnIndex(sheet, 'Total');
  const colFacture = findColumnIndex(sheet, 'Numero de facture');
  const colUuid = findColumnIndex(sheet, '_uuid');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');  // ✅ tech
  const colDeviceId = findColumnIndex(sheet, '_device_id');   // ✅ tech
  
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
  
  const maxCol = Math.max(colDate, colPrix, colNumeroProduit, colTotal, colFacture, colUuid,
                          colUpdatedAt, colDeviceId);  // ✅ tech
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
  
  // ✅ Tech columns
  if (colUpdatedAt > 0) rowData[colUpdatedAt - 1] = nowIso();
  if (colDeviceId > 0 && payload.device_id !== undefined) rowData[colDeviceId - 1] = String(payload.device_id || '');
  
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
  const modifiedProductCodes = new Set(); // Tracer les produits modifiés
  
  // ===== PASS 1: Identifier les produits modifiés =====
  for (const sheetName of sheetNames) {
    logDebug('📄 [PASS1] Traitement feuille:', sheetName);
    const sheet = getSheet(sheetName);
    if (!sheet) {
      logDebug('   ⚠️ Feuille non trouvée:', sheetName);
      continue;
    }
    
    ensureTechColumns(sheet);
    const colDateUpdate = findColumnIndex(sheet, 'Date de dernière mise à jour');
    const colCode = findColumnIndex(sheet, 'Code produit');
    const colNom = findColumnIndex(sheet, 'Nom du produit');
    const colUuid = findColumnIndex(sheet, '_uuid');
    
    if (colCode === -1) {
      logDebug('   ⚠️ Pas de colonne Code produit, feuille ignorée');
      continue; // Pas de colonne Code produit
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      logDebug('   ⚠️ Pas de données (seulement en-tête)');
      continue;
    }
    
    const lastCol = sheet.getLastColumn();
    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    
    let modifiedCount = 0;
    for (let i = 0; i < values.length; i++) {
      const codeValue = colCode > 0 ? values[i][colCode - 1] : '';
      const code = codeValue ? String(codeValue).trim() : '';
      if (!code) continue;
      
      // En import initial, tous les produits sont "modifiés"
      if (isInitialImport) {
        modifiedProductCodes.add(code);
        modifiedCount++;
        continue;
      }
      
      // En sync incrémentale, vérifier la date
      let dateUpdate = null;
      if (colDateUpdate > 0) {
        const dateValue = values[i][colDateUpdate - 1];
        if (dateValue) {
          if (dateValue instanceof Date) {
            dateUpdate = dateValue;
          } else if (typeof dateValue === 'string' && dateValue.length > 0) {
            try {
              const parsedDate = new Date(dateValue);
              if (!isNaN(parsedDate.getTime())) {
                dateUpdate = parsedDate;
              }
            } catch (e) {}
          } else if (typeof dateValue === 'number') {
            dateUpdate = new Date(dateValue);
          }
        }
      }
      
      // Ajouter si date >= sinceDate (modifié depuis la dernière sync)
      if (dateUpdate && dateUpdate >= sinceDate) {
        modifiedProductCodes.add(code);
        modifiedCount++;
        logDebug('   ✅ Code', code, 'marqué comme modifié (date:', dateUpdate.toISOString(), ')');
      }
    }
    
    console.log('   [PASS1]', sheetName, ':', modifiedCount, 'produit(s) marqué(s) comme modifié(s)');
  }
  
  console.log('📊 [PASS1] Total produits modifiés marqués:', modifiedProductCodes.size);
  
  // ===== PASS 2: Récupérer TOUS les units de TOUS les produits modifiés =====
  for (const sheetName of sheetNames) {
    logDebug('📄 [PASS2] Traitement feuille:', sheetName);
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
    
    if (colCode === -1) {
      logDebug('   ⚠️ Pas de colonne Code produit, feuille ignorée');
      continue;
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      logDebug('   ⚠️ Pas de données (seulement en-tête)');
      continue;
    }
    
    const lastCol = sheet.getLastColumn();
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
        continue;
      }
      
      // ✅ CRITICAL FIX: Si ce produit n'a PAS été marqué comme modifié, le SKIP
      // Mais ATTENTION: Certains autres units du même produit PEUVENT avoir changé!
      // Solution: Ne skip QUE si le produit n'est pas dans modifiedProductCodes
      if (!isInitialImport && !modifiedProductCodes.has(code)) {
        skippedCount++;
        logDebug('   ⏭️  Code', code, '(' + unitLevel + ') pas modifié, SKIP');
        continue; // ← SKIP seulement si PAS marqué comme modifié
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
      
      // ✅ CORRECTION PRO: Valider unit_mark
      // Ne JAMAIS accepter les valeurs de unit_level (CARTON, MILLIER, PIECE) comme unit_mark
      let markValue = colMark > 0 ? (values[i][colMark - 1] ? String(values[i][colMark - 1]).trim() : '') : '';
      const unitLevelValues = ['CARTON', 'MILLIER', 'PIECE', 'DETAIL'];
      if (unitLevelValues.includes(markValue.toUpperCase())) {
        // C'est une erreur de fusion - unit_mark contient un unit_level
        // Vider le mark pour qu'il soit rempli correctement
        logDebug('   ⚠️ Correction: unit_mark contenait "' + markValue + '" (value de unit_level), vidé');
        markValue = '';
      }
      
      const unitData = {
        uuid: colUuid > 0 ? values[i][colUuid - 1] || null : null,
        unit_level: unitLevel,
        unit_mark: markValue,
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
 * Récupère une page de produits-units (pagination PRO)
 * ⚠️ IMPORTANT: Retourne des UNITS (shape flat), pas des PRODUCTS regroupés!
 * - Shape retourné: [{code, name, unit_level, unit_mark, sale_price_fc, ...}]
 * - Pas de regroupement par code (impossible avec pagination)
 * - Raison: Chaque ligne Sheets = une combinaison (code + unit_level)
 * 
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
  
  logDebug('📄 [getProductsPage] Feuille:', sheetName, '| Cursor:', cursor, '| Limit:', limit, '| Unit level:', lvl);
  
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
    colDateUpdate, colUpdatedAt, colCode, colNom, colStockInit, colPrixAchatUSD,
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
  
  logDebug('📊 [getProductsPage] Lecture lignes', startRow, 'à', endRow, '(', numRows, 'lignes)');
  
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
  
  logDebug('✅ [getProductsPage] Traité:', processedCount, 'produit(s) | Skippé:', skippedCount, '| Done:', done, '| Next cursor:', next_cursor);
  
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
  let sinceDateObj;
  if (!sinceDate) {
    // Si aucune date fournie, utiliser epoch (import complet)
    sinceDateObj = new Date(0);
  } else if (typeof sinceDate === 'string') {
    sinceDateObj = new Date(sinceDate);
  } else if (sinceDate instanceof Date) {
    sinceDateObj = sinceDate;
  } else {
    sinceDateObj = new Date(sinceDate);
  }
  
  // Vérifier que la date est valide
  if (isNaN(sinceDateObj.getTime())) {
    console.warn('📅 [getSalesPage] Date invalide reçue, utilisation epoch:', sinceDate);
    sinceDateObj = new Date(0);
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
  
  const maxCol = Math.max(colDate, colUpdatedAt, colFacture, colCode, colClient, colQte, colMark,
                          colPrixUnitaire, colUnite, colVendeur, colModeStock, colTelephone, colUSD, colUuid);
  
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
  let skippedDuplicateUuid = 0;
  
  // DEDUPLICATION: Track UUIDs seen in this page to prevent duplicates
  const uuidsSeenInThisPage = new Set();
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const invoice = (r[colFacture - 1] || '').toString().trim();
    const pageUuid = colUuid > 0 ? (r[colUuid - 1] || '').toString().trim() : '';
    
    if (!invoice) {
      skippedNoInvoice++;
      skippedCount++;
      if (i < 5) {
        console.log('   ⚠️ [getSalesPage] Ligne', startRow + i, 'ignorée: pas de numéro de facture');
      }
      continue;
    }
    
    // CRITICAL: Detect duplicate UUIDs within the same page response
    // This prevents the same row from being returned twice due to Google Sheets API quirks
    if (pageUuid && uuidsSeenInThisPage.has(pageUuid)) {
      skippedDuplicateUuid++;
      skippedCount++;
      console.log('   ⚠️ [getSalesPage] Ligne', startRow + i, 'ignorée: UUID dupliqué dans la même page (UUID:', pageUuid, ')');
      continue;
    }
    
    // Add UUID to the seen set if it exists
    if (pageUuid) {
      uuidsSeenInThisPage.add(pageUuid);
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
  console.log('   - UUID dupliquées dans la page:', skippedDuplicateUuid);
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
 * ⚡ Backfill des colonnes techniques sur Dettes
 * Remplit _uuid et _updated_at pour les dettes existantes (EXÉCUTER UNE FOIS)
 */
function backfillDettesTechColumns() {
  const sheet = getSheet(SHEETS.DETTES);
  ensureTechColumns(sheet);

  const colUuid = findColumnIndex(sheet, '_uuid');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  const colDate = findColumnIndex(sheet, 'date');

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    console.log('[backfillDettesTechColumns] Rien à faire (0 ligne)');
    return 0;
  }

  const numRows = lastRow - 1;

  const uuidRange = sheet.getRange(2, colUuid, numRows, 1);
  const updatedAtRange = sheet.getRange(2, colUpdatedAt, numRows, 1);

  const uuids = uuidRange.getValues();
  const upd = updatedAtRange.getValues();

  let changed = 0;
  for (let i = 0; i < numRows; i++) {
    const row = i + 2;

    // UUID
    if (!uuids[i][0] || String(uuids[i][0]).trim() === '') {
      uuids[i][0] = Utilities.getUuid();
      changed++;
    }

    // UPDATED_AT
    if (!upd[i][0] || String(upd[i][0]).trim() === '') {
      const dateVal = (colDate > 0) ? sheet.getRange(row, colDate).getValue() : null;
      const d = toDate(dateVal) || new Date();
      upd[i][0] = d.toISOString();
      changed++;
    }
  }

  uuidRange.setValues(uuids);
  updatedAtRange.setValues(upd);

  console.log('[backfillDettesTechColumns] ✅ Terminé. Modifs:', changed);
  return changed;
}

/**
 * 🧹 Nettoyage Dettes: supprime lignes vides + doublons
 * - Vide = pas de facture OU pas de client OU montants (FC et USD) à 0
 * - Doublon = même (facture + client + produit). Conserve la ligne la plus récente (_updated_at)
 *
 * À exécuter UNE FOIS dans l'éditeur Apps Script si la feuille contient déjà des doublons/vides.
 */
function cleanupDettesDuplicatesAndEmpty() {
  const sheet = getSheet(SHEETS.DETTES);
  if (!sheet) {
    console.error('[cleanupDettesDuplicatesAndEmpty] Feuille Dettes introuvable');
    return { deleted: 0, duplicates: 0, empty: 0 };
  }

  ensureTechColumns(sheet);

  const colClient = findColumnIndex(sheet, 'Client');
  const colProduit = findColumnIndex(sheet, 'Produit');
  const colFacture = findColumnIndex(sheet, 'numero de facture');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  const colTotalFc = findColumnIndex(sheet, 'prix a payer');
  const colTotalUsd = findColumnIndex(sheet, 'Dollars');

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    console.log('[cleanupDettesDuplicatesAndEmpty] Rien à faire (0 ligne)');
    return { deleted: 0, duplicates: 0, empty: 0 };
  }

  const values = sheet.getDataRange().getValues();

  const bestByKey = new Map(); // key -> { rowIndex, updatedAt }
  const rowsToDelete = new Set();

  let emptyCount = 0;
  let dupCount = 0;

  for (let i = 1; i < values.length; i++) {
    const rowIndex = i + 1;

    const invoice = colFacture > 0 ? String(values[i][colFacture - 1] || '').trim() : '';
    const client = colClient > 0 ? String(values[i][colClient - 1] || '').trim() : '';
    const produit = colProduit > 0 ? String(values[i][colProduit - 1] || '').trim() : '';
    const totalFc = colTotalFc > 0 ? toNumber(values[i][colTotalFc - 1]) : 0;
    const totalUsd = colTotalUsd > 0 ? toNumber(values[i][colTotalUsd - 1]) : 0;

    if (!invoice || !client || (totalFc <= 0 && totalUsd <= 0)) {
      rowsToDelete.add(rowIndex);
      emptyCount++;
      continue;
    }

    const updatedAt = colUpdatedAt > 0 ? toDate(values[i][colUpdatedAt - 1]) : null;
    const updatedMs = updatedAt ? updatedAt.getTime() : 0;
    const key = `${invoice}||${client}||${produit}`;

    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, { rowIndex, updatedMs });
      continue;
    }

    // Doublon: garder le plus récent
    dupCount++;
    if (updatedMs >= prev.updatedMs) {
      rowsToDelete.add(prev.rowIndex);
      bestByKey.set(key, { rowIndex, updatedMs });
    } else {
      rowsToDelete.add(rowIndex);
    }
  }

  // Supprimer du bas vers le haut pour ne pas décaler les indices
  const sorted = Array.from(rowsToDelete).sort((a, b) => b - a);
  for (const r of sorted) {
    sheet.deleteRow(r);
  }

  const deleted = sorted.length;
  console.log('[cleanupDettesDuplicatesAndEmpty] ✅ Terminé. Supprimées:', deleted, '| Vides:', emptyCount, '| Doublons:', dupCount);
  return { deleted, duplicates: dupCount, empty: emptyCount };
}

/**
 * Récupère une page de dettes (pagination PRO)
 * @param {Date} sinceDate - Date depuis laquelle récupérer
 * @param {number} cursor - Ligne de départ (2 = première ligne de données)
 * @param {number} limit - Nombre max de lignes à lire
 * @returns {{data: Array, next_cursor: number|null, done: boolean}}
 */
function getDebtsPage(sinceDate, cursor, limit) {
  console.log('📄 [getDebtsPage] DÉBUT - Feuille: Dettes | Cursor:', cursor, '| Limit:', limit);
  
  const sheet = getSheet(SHEETS.DETTES);
  
  // DIAGNOSTIC: Vérifier si la feuille est trouvée
  if (!sheet) {
    console.error('❌ [getDebtsPage] FEUILLE "Dettes" NON TROUVÉE!');
    const ss = getSpreadsheet();
    const allSheets = ss.getSheets();
    console.log('📋 Feuilles disponibles dans le Spreadsheet:');
    for (let i = 0; i < allSheets.length; i++) {
      console.log(`   [${i}] "${allSheets[i].getName()}"`);
    }
    return { data: [], next_cursor: null, done: true };
  }
  
  console.log('✅ [getDebtsPage] Feuille "Dettes" trouvée avec', sheet.getLastRow(), 'lignes');
  
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
  const colDescription = findColumnIndex(sheet, 'objet') || findColumnIndex(sheet, 'objet\\Description') || findColumnIndex(sheet, 'Description');
  const colDettesFCUSD = findColumnIndex(sheet, 'Dettes Fc en usd');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  console.log('🔍 [getDebtsPage] Colonnes trouvées:');
  console.log('   colDate:', colDate, '| colUpdatedAt:', colUpdatedAt);
  console.log('   colClient:', colClient, '| colProduit:', colProduit);
  console.log('   colPrixAPayer:', colPrixAPayer, '| colPrixPaye:', colPrixPaye);
  console.log('   colReste:', colReste, '| colFacture:', colFacture);
  console.log('   colDollars:', colDollars, '| colDescription:', colDescription);
  console.log('   colDettesFCUSD:', colDettesFCUSD, '| colUuid:', colUuid);
  
  if (colDate === -1) {
    console.log('❌ [getDebtsPage] ERREUR: Colonne "date" manquante!');
    return { data: [], next_cursor: null, done: true };
  }
  
  const maxCol = Math.max(colDate, colClient, colProduit, colPrixAPayer, colPrixPaye,
                          colReste, colFacture, colDollars, colDescription, colDettesFCUSD, colUuid);
  
  const lastRow = sheet.getLastRow();
  console.log('📋 [getDebtsPage] Total lignes dans la feuille:', lastRow);
  
  if (lastRow <= 1) {
    console.log('⚠️ [getDebtsPage] Pas de données (seulement en-tête)');
    return { data: [], next_cursor: null, done: true };
  }
  
  const startRow = Math.max(2, cursor || 2);
  const endRow = Math.min(lastRow, startRow + limit - 1);
  const numRows = endRow - startRow + 1;
  
  console.log('📊 [getDebtsPage] Lecture lignes', startRow, 'à', endRow, '(', numRows, 'lignes)');
  console.log('📅 [getDebtsPage] sinceDate:', sinceDate, '(time:', sinceDate.getTime(), ')');
  
  const rows = sheet.getRange(startRow, 1, numRows, maxCol).getValues();
  
  const data = [];
  let processedCount = 0;
  let skippedCount = 0;
  let skippedByDate = 0;
  let skippedEmptyClient = 0;
  let skippedEmptyDebt = 0;
  
  // Log premier row pour diagnostic
  if (rows.length > 0) {
    const firstRow = rows[0];
    console.log('🔍 [getDebtsPage] DIAGNOSTIC première ligne:');
    console.log('   colDate:', colDate, '→ valeur:', colDate > 0 ? firstRow[colDate - 1] : 'N/A', '| type:', colDate > 0 ? typeof firstRow[colDate - 1] : 'N/A');
    console.log('   colUpdatedAt:', colUpdatedAt, '→ valeur:', colUpdatedAt > 0 ? firstRow[colUpdatedAt - 1] : 'N/A', '| type:', colUpdatedAt > 0 ? typeof firstRow[colUpdatedAt - 1] : 'N/A');
    console.log('   colClient:', colClient, '→ valeur:', colClient > 0 ? firstRow[colClient - 1] : 'N/A');
    console.log('   colFacture:', colFacture, '→ valeur:', colFacture > 0 ? firstRow[colFacture - 1] : 'N/A');
  }
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    
    // ✅ Skip lignes vides: client ou facture manquants, ou montants à 0
    const clientName = colClient > 0 ? (r[colClient - 1] || '').toString().trim() : '';
    const invoiceNumber = colFacture > 0 ? (r[colFacture - 1] || '').toString().trim() : '';
    const totalFC0 = toNumber(colPrixAPayer > 0 ? r[colPrixAPayer - 1] : 0);
    const totalUSD0 = toNumber(colDollars > 0 ? r[colDollars - 1] : 0);
    if (!clientName) {
      skippedEmptyClient++;
      continue;
    }
    if (!invoiceNumber || (totalFC0 <= 0 && totalUSD0 <= 0)) {
      skippedEmptyDebt++;
      continue;
    }
    
    // Utiliser _updated_at si présent, sinon fallback sur date
    const refVal = (colUpdatedAt > 0) ? r[colUpdatedAt - 1] : r[colDate - 1];
    let refDate = toDate(refVal);
    
    // Si refDate est null, utiliser la date actuelle comme fallback
    if (!refDate) {
      console.log(`   ⚠️ Ligne ${startRow + i}: refDate invalide (refVal="${refVal}", type=${typeof refVal}), utilisation date courante`);
      refDate = new Date(); // Fallback: considérer comme récent
    }
    
    if (sinceDate.getTime() > 0 && refDate < sinceDate) {
      skippedByDate++;
      skippedCount++;
      continue;
    }
    
    // Pour dateDette, utiliser refDate comme fallback
    let dateDette = toDate(r[colDate - 1]);
    if (!dateDette) {
      dateDette = refDate; // Fallback sur refDate
    }
    
    const totalFC = totalFC0;
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
      invoice_number: invoiceNumber,
      total_usd: totalUSD0,
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
  
  console.log('✅ [getDebtsPage] RÉSUMÉ:');
  console.log('   Traité:', processedCount, 'dette(s)');
  console.log('   Skippé total:', skippedCount, '(dont', skippedByDate, 'par filtre date,', skippedEmptyClient, 'sans client,', skippedEmptyDebt, 'dette(s) vide(s))');
  console.log('   Done:', done, '| Next cursor:', next_cursor);
  console.log('   Retourné:', data.length, 'dettes');
  
  return { data, next_cursor, done };
}

/**
 * ✅ PRO: Récupère TOUS les taux depuis une date (pas seulement le dernier)
 * Retourne tous les taux pour historisation complète dans la base locale
 * Le client choisira le dernier taux comme taux courant
 * 
 * ✅ FIX: Gère les taux AVEC ou SANS UUID
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
  const colUsd = findColumnIndex(sheet, 'USD');
  const colFc = findColumnIndex(sheet, 'Fc');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  console.log(`💱 [getRatesSince] Colonnes: Taux=${colTaux}, DATE=${colDate}, USD=${colUsd}, Fc=${colFc}, _uuid=${colUuid}`);
  console.log(`💱 [getRatesSince] sinceDate=${sinceDate.toISOString()}, isInitialImport=${isInitialImport}, rows=${values.length - 1}`);
  
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    
    // Récupérer le taux - priorité: colonne Taux
    let rate = 0;
    if (colTaux > 0 && row[colTaux - 1]) {
      rate = toNumber(row[colTaux - 1]);
    }
    
    // Ignorer les lignes sans taux valide
    if (!rate || rate <= 0) {
      continue;
    }
    
    // Récupérer la date du taux
    let dateTaux = colDate > 0 ? row[colDate - 1] : null;
    let dateObj = null;
    
    if (dateTaux) {
      if (dateTaux instanceof Date) {
        dateObj = dateTaux;
      } else if (typeof dateTaux === 'string') {
        // Gérer formats: DD/MM/YYYY, DD/MM/YYYY HH:mm:ss, YYYY-MM-DD, ISO
        if (dateTaux.includes('/')) {
          const parts = dateTaux.split(' ');
          const datePart = parts[0].split('/');
          if (datePart.length === 3) {
            const day = parseInt(datePart[0], 10);
            const month = parseInt(datePart[1], 10) - 1;
            const year = parseInt(datePart[2], 10);
            dateObj = new Date(year, month, day);
          }
        } else {
          dateObj = new Date(dateTaux);
        }
      }
    }
    
    // Si pas de date valide, utiliser maintenant
    if (!dateObj || isNaN(dateObj.getTime())) {
      dateObj = new Date();
    }
    
    // Utiliser _updated_at pour le filtrage si disponible
    const refVal = (colUpdatedAt > 0 && row[colUpdatedAt - 1]) ? row[colUpdatedAt - 1] : dateObj;
    const refDate = toDate(refVal) || dateObj;
    
    // Vérifier la date si ce n'est pas un import initial
    if (!isInitialImport && refDate < sinceDate) {
      continue;
    }
    
    // UUID - peut être vide, c'est OK
    const uuid = colUuid > 0 ? (row[colUuid - 1] || '').toString().trim() : '';
    
    // Récupérer USD et Fc pour référence
    const usd = colUsd > 0 ? toNumber(row[colUsd - 1]) || 100 : 100;
    const fc = colFc > 0 ? toNumber(row[colFc - 1]) : rate * usd;
    
    results.push({
      Taux: rate,
      USD: usd,
      Fc: fc,
      DATE: dateObj.toISOString(),
      uuid: uuid || null,
      _uuid: uuid || null,
      rate_fc_per_usd: rate,
      effective_at: dateObj.toISOString(),
      _origin: 'SHEETS',
      _syncedAt: new Date().toISOString(),
      _remote_updated_at: refDate ? refDate.toISOString() : dateObj.toISOString()
    });
  }
  
  console.log(`💱 [getRatesSince] ↓${results.length} taux retournés`);
  
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
  const colModePasse = findColumnIndex(sheet, 'Mode passe');
  const colNumero = findColumnIndex(sheet, 'Numero');
  const colValide = findColumnIndex(sheet, 'Valide');
  const colAdmi = findColumnIndex(sheet, 'admi');
  const colUuid = findColumnIndex(sheet, '_uuid');
  const colToken = findColumnIndex(sheet, 'Token Expo Push');
  const colMarque = findColumnIndex(sheet, 'marque');
  const colUrlProfile = findColumnIndex(sheet, 'Urlprofile');
  
  // ✅ Nouvelles colonnes de rôles
  const colVendeur = findColumnIndex(sheet, 'Vendeur');
  const colGerentStock = findColumnIndex(sheet, 'Gerent Stock');
  const colProduits = findColumnIndex(sheet, 'Porudits est Vender');
  
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
  console.log(`[USERS] 📋 Colonnes trouvées: Nom=${colNom}, Mode passe=${colModePasse}, Numero=${colNumero}, Valide=${colValide}, Admi=${colAdmi}, UUID=${colUuid}, Token=${colToken}, Marque=${colMarque}, UrlProfile=${colUrlProfile}, Vendeur=${colVendeur}, GerentStock=${colGerentStock}, Produits=${colProduits}`);
  
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
    // CRITIQUE: Récupérer le mot de passe depuis la colonne "Mode passe"
    const passwordValue = colModePasse > 0 ? (values[i][colModePasse - 1] ? String(values[i][colModePasse - 1]).trim() : '') : '';
    
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
    
    // ✅ Helper pour parser les valeurs boolean depuis Sheets (oui, OUI, 1, true, etc.)
    const parseBool = (col) => {
      if (col <= 0) return false;
      const val = values[i][col - 1];
      const valStr = String(val || '').toLowerCase().trim();
      return valStr === 'oui' || valStr === 'yes' || valStr === 'true' || val == 1 || val === true;
    };
    
    const userData = {
      uuid: userUuid, // UUID backfillé si nécessaire
      _uuid: userUuid, // Alias pour compatibilité
      username: nomValue ? String(nomValue).trim() : '',
      phone: numeroValue ? String(numeroValue).trim() : '',
      // CRITIQUE: Récupérer le mot de passe depuis la colonne "Mode passe"
      password: passwordValue || 'changeme123', // Fallback sur mot de passe par défaut si vide
      // Colonne "Valide": "Oui" ou "oui" ou 1 ou true = actif, sinon inactif
      is_active: colValide > 0 ? (() => {
        const valideValue = values[i][colValide - 1];
        const valideStr = String(valideValue).toLowerCase().trim();
        return valideStr === 'oui' || valideStr === 'yes' || valideValue == 1 || valideValue === true;
      })() : true,
      is_admin: colAdmi > 0 ? (String(values[i][colAdmi - 1]).toLowerCase() === 'oui' || values[i][colAdmi - 1] == 1 || values[i][colAdmi - 1] === true) : false,
      // ✅ Nouvelles colonnes de rôles
      is_vendeur: parseBool(colVendeur),
      is_gerant_stock: parseBool(colGerentStock),
      can_manage_products: parseBool(colProduits),
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
      console.log(`[USERS] ✅ Utilisateur ${processed}: ${userData.username}, UUID=${userData.uuid || 'N/A'}, phone=${userData.phone}, password=${userData.password ? '*** (présent)' : 'N/A (vide)'}, is_active=${userData.is_active}, is_admin=${userData.is_admin}, is_vendeur=${userData.is_vendeur}, is_gerant_stock=${userData.is_gerant_stock}, can_manage_products=${userData.can_manage_products}, refDate=${refDateStr}`);
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
  lock.waitLock(20000);

  try {
    const sinceMap = safeParseJson(p.since || '{}', {});
    const entities = (p.entities ? p.entities.toString().split(',') : Object.keys(sinceMap))
      .map(x => x.trim().toLowerCase())
      .filter(Boolean);

    // Par défaut, batchPull = entités légères
    const list = entities.length ? entities : ['users', 'rates'];

    const data = {};
    const meta = {};
    const serverTime = nowIso();

    console.log('📥 [handleBatchPull] Entités:', list.join(', '));
    console.log('⚠️ [handleBatchPull] Products/Sales/Debts doivent idéalement être paginés (évite timeout)');

    for (const entity of list) {
      // Par défaut: since par entité
      const sinceStr = sinceMap[entity] || new Date(0).toISOString();
      const sinceDate = toDate(sinceStr) || new Date(0);

      // Règle PRO: grosses entités => pagination séparée
      if (['products', 'product_units', 'sales', 'debts'].includes(entity)) {
        data[entity] = [];
        meta[entity] = {
          count: 0,
          max_updated_at: sinceStr,
          note: 'Utiliser pagination: ?entity=' + entity + '&full=1&cursor=2&limit=300' + (entity.includes('product') ? '&unit_level=CARTON|MILLIER|PIECE' : ''),
        };
        continue;
      }

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

      const maxUpdatedAt = computeMaxUpdatedAt(rows, sinceStr);

      data[entity] = rows;
      meta[entity] = {
        count: rows.length,
        max_updated_at: maxUpdatedAt
      };
    }

    return jsonOut({
      success: true,
      data,
      meta,
      server_time: serverTime
    });

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
    // ✅ FIX: Vérifier que data est défini
    if (!data || typeof data !== 'object') {
      console.error('❌ [handleBatchPush] data est undefined ou pas un objet:', data);
      return jsonOut({ 
        success: false, 
        error: 'data is undefined or invalid',
        applied: [], 
        conflicts: [], 
        failed: [],
        stats: { received: 0, applied: 0, conflicts: 0, failed: 0, skipped: 0 },
        server_time: nowIso()
      });
    }
    
    const ops = Array.isArray(data.ops) ? data.ops : [];
    const deviceId = (data.device_id || '').toString() || 'UNKNOWN';
    const serverTime = nowIso();
    
    console.log(`📨 [handleBatchPush] Reçu ${ops.length} opération(s)`);
    if (ops.length > 0) {
      console.log(`📨 [handleBatchPush] Première opération: ${JSON.stringify(ops[0]).substring(0, 250)}...`);
    }
    
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
        // ✅ PRO: Utiliser canonicalisation stricte (CARTON, MILLIERS, PIECE)
        const lvl = normalizeUnitLevelCanonical(pl.unit_level);
        const target = lvl === 'CARTON' ? SHEETS.CARTON : 
                      (lvl === 'MILLIERS' ? SHEETS.MILLIERS : SHEETS.PIECE);
        addTo(target, it);
      } else if (entity === 'stock_moves') {
        // ✅ PRO: Même canonicalisation pour stock_moves
        const lvl = normalizeUnitLevelCanonical(pl.unit_level);
        const target = lvl === 'CARTON' ? SHEETS.CARTON : 
                      (lvl === 'MILLIERS' ? SHEETS.MILLIERS : SHEETS.PIECE);
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
      } else {
        // ✅ CRITIQUE: Ne jamais drop une entité silencieusement
        addTo('__UNROUTABLE__', it);
      }
    }
    
    const applied = [];
    const conflicts = [];
    const failed = [];
    const skipped = [];
    
    // 3) Appliquer par feuille (lecture 1 fois + écritures en blocs)
    for (const sheetName in groups) {
      // ✅ PRO: Traiter les UNROUTABLE separément
      if (sheetName === '__UNROUTABLE__') {
        for (const op of groups[sheetName]) {
          conflicts.push({
            op_id: op.op_id,
            sheet: sheetName,
            reason: 'UNROUTABLE_ENTITY',
            entity: op.entity
          });
        }
        continue;
      }
      
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
        
        console.log(`   📦 [handleBatchPush] op_id=${opId}, payload=${JSON.stringify(pl).substring(0, 150)}...`);
        
        // ✅ CRITICAL: Désactiver complètement le test de conflit
        // Raison: L'idempotence est gérée par op_id dans la DB, pas par _updated_at
        // Si on teste _updated_at, on crée des retry infinies car:
        // - Retry 1: rejette pour conflit (remote > base)
        // - Retry 2: accepte et écrit dans Sheets
        // - Retry 3: rejette à nouveau (remote est maintenant le timestamp de retry 2)
        // Solution PRO: Utiliser op_id pour dédupliquer au lieu de _updated_at
        
        // NOTE: Si on réactive le conflit test, utiliser SEULEMENT pour product_units
        // et ignorer pour stock_moves (qui sont idempotentes)
        // if (!isStockMove && uuid && colUuid > 0) {
        //   [conflit test code]
        // }
        
        // Utiliser les handlers existants (plus lent mais correct et sécurisé)
        let entity = '(unknown)'; // ✅ Défini avant le try pour le catch
        try {
          let result;
          entity = op.entity;
          
          console.log(`   📝 [handleBatchPush] Application ${entity} (op_id: ${opId})`);
          
          switch (entity) {
            case 'product_units':
            case 'products':
              // ✅ PRO: Vérifier si c'est une opération de suppression
              if (op.op === 'delete') {
                console.log(`   🗑️ [handleBatchPush] Traitement PRODUCT_DELETED`);
                console.log(`   Payload: ${JSON.stringify(pl).substring(0, 200)}...`);
                result = handleProductDeleted(pl);
              }
              // Vérifier si c'est une opération update_stock
              // CRITIQUE: Vérifier stock_absolute (nouveau mode) OU stock_change (ancien mode pour compatibilité)
              else if (op.op === 'update_stock' && (pl.stock_absolute !== undefined || pl.stock_change !== undefined)) {
                // ✅ PRO: Utiliser canonicalisation pour unit_level
                const unitLevelNormalized = normalizeUnitLevelCanonical(pl.unit_level);
                // CRITIQUE: Normaliser product_code en chaîne pour correspondre à Sheets
                const productCodeNormalized = String(pl.product_code || '').trim();
                // Créer un payload normalisé pour handleStockUpdate
                const normalizedPayload = {
                  ...pl,
                  product_code: productCodeNormalized, // CRITIQUE: Toujours chaîne pour correspondre à Sheets
                  unit_level: unitLevelNormalized || (pl.unit_level || '')
                };
                console.log(`   🔧 [handleBatchPush] Payload normalisé pour update_stock:`);
                console.log(`      product_code: '${pl.product_code}' → '${productCodeNormalized}'`);
                console.log(`      unit_level: '${pl.unit_level}' → '${unitLevelNormalized}'`);
                result = handleStockUpdate(normalizedPayload);
              } else {
                console.log(`   📦 [handleBatchPush] APPEL handleProductUpsert pour ${entity}`);
                console.log(`      Payload keys: ${Object.keys(pl).join(', ')}`);
                console.log(`      code='${pl.code || pl.product_code}', name='${pl.name}', unit_level='${pl.unit_level}'`);
                try {
                  result = handleProductUpsert(pl, entity);
                  console.log(`   ✅ [handleBatchPush] handleProductUpsert SUCCÈS: ${JSON.stringify(result).substring(0, 300)}`);
                } catch (prodError) {
                  console.error(`   ❌ [handleBatchPush] handleProductUpsert ERREUR: ${prodError.toString()}`);
                  throw prodError;
                }
              }
              break;
            case 'stock_moves':
              // ✅ PRO: Gérer les mouvements de stock avec stock_absolute OU delta
              // Format: { product_code, unit_level, unit_mark, stock_absolute?, delta?, reason?, ... }
              console.log(`   📦 [handleBatchPush] TRAITEMENT stock_moves - op_id: ${opId}`);
              console.log(`      Payload brut: ${JSON.stringify(pl).substring(0, 200)}...`);
              console.log(`      Reason: ${pl.reason || 'N/A'}`);
              
              {
                const unitLevelNormalized = normalizeUnitLevelCanonical(pl.unit_level);
                const productCodeNormalized = String(pl.product_code || '').trim();
                
                const payloadForStockUpdate = {
                  product_code: productCodeNormalized,
                  unit_level: unitLevelNormalized,
                  unit_mark: pl.unit_mark || '',
                  uuid: pl.uuid || pl.product_uuid || '',
                  device_id: pl.device_id || deviceId || 'AUTO_STOCK',
                  reason: pl.reason || ''  // ✅ Préserver le reason
                };
                
                // ✅ PRO: Priorité à stock_absolute (valeur finale absolue)
                if (pl.stock_absolute !== undefined && pl.stock_absolute !== null) {
                  const stockAbs = typeof pl.stock_absolute === 'number' ? pl.stock_absolute : (parseFloat(pl.stock_absolute) || 0);
                  payloadForStockUpdate.stock_absolute = Math.round(stockAbs * 100) / 100;
                  console.log(`   📊 [handleBatchPush] Stock ABSOLU à écrire:`);
                  console.log(`      product_code: '${productCodeNormalized}'`);
                  console.log(`      unit_level: '${unitLevelNormalized}'`);
                  console.log(`      stock_absolute: ${payloadForStockUpdate.stock_absolute}`);
                } else {
                  // Fallback: utiliser delta (changement relatif)
                  const delta = typeof pl.delta === 'number' ? pl.delta : (parseFloat(pl.delta) || 0);
                  payloadForStockUpdate.stock_change = delta;
                  console.log(`   📊 [handleBatchPush] Stock DELTA à appliquer:`);
                  console.log(`      product_code: '${productCodeNormalized}'`);
                  console.log(`      unit_level: '${unitLevelNormalized}'`);
                  console.log(`      delta: ${delta}`);
                }
                
                // ✅ NOUVEAU: Si reason='sale_deleted', mettre à jour SEULEMENT le stock des feuilles de produit
                // Ne pas créer de ligne de vente!
                if (pl.reason === 'sale_deleted') {
                  console.log(`   🗑️ [handleBatchPush] STOCK_MOVE from sale_deleted - MAJ stock only`);
                  try {
                    result = updateProductStockOnly(payloadForStockUpdate);
                    console.log(`   ✅ [handleBatchPush] updateProductStockOnly a retourné:`, JSON.stringify(result));
                  } catch (stockError) {
                    console.error(`   ❌ [handleBatchPush] updateProductStockOnly a ÉCHOUÉ:`, stockError.toString());
                    throw stockError;
                  }
                } else {
                  // Mode normal: handleStockUpdate qui crée aussi une ligne de vente si nécessaire
                  console.log(`   📞 [handleBatchPush] Appel handleStockUpdate avec payload: ${JSON.stringify(payloadForStockUpdate).substring(0, 300)}...`);
                  try {
                    result = handleStockUpdate(payloadForStockUpdate);
                    console.log(`   ✅ [handleBatchPush] handleStockUpdate a retourné:`, JSON.stringify(result));
                  } catch (stockError) {
                    console.error(`   ❌ [handleBatchPush] handleStockUpdate a ÉCHOUÉ:`, stockError.toString());
                    throw stockError;
                  }
                }
              }
              break;
            case 'sale_items':
              result = handleSaleItemUpsert(pl);
              break;
            case 'sales':
              // ✅ NOUVEAU: Traiter les opérations SALE_DELETED
              // Entity 'sales' avec op_type 'SALE_DELETED' = suppression de vente
              console.log(`🗑️ [handleBatchPush] Traitement SALE_DELETED`);
              console.log(`   Payload: ${JSON.stringify(pl).substring(0, 200)}...`);
              result = handleSaleDeleted(pl);
              break;
            case 'debts':
              result = handleDebtUpsert(pl);
              break;
            case 'debt_payments':
              result = handleDebtPaymentUpsert(pl);
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
          failed.push({
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
    
    // ✅ PRO: Ne jamais mentir sur success si des erreurs existent
    const success = failed.length === 0;

    // 🔍 DEBUG: Log le format exact de réponse avant retour
    const responseObj = {
      success,
      server_time: serverTime,
      remote_version: serverTime,
      applied,
      conflicts,
      failed,
      skipped,
      stats: {
        received: ops.length,
        applied: applied.length,
        conflicts: conflicts.length,
        failed: failed.length,
        skipped: skipped.length
      }
    };
    
    // 🔴 CRITICAL DEBUG: Afficher le format EXACT de la réponse
    console.log('\n🔹🔹🔹 [handleBatchPush] RESPONSE FORMAT CHECK 🔹🔹🔹');
    console.log('✅ success:', responseObj.success);
    console.log('📊 stats:', JSON.stringify(responseObj.stats));
    console.log('📋 applied.length:', responseObj.applied.length);
    console.log('⚠️ conflicts.length:', responseObj.conflicts.length);
    console.log('❌ failed.length:', responseObj.failed.length);
    console.log('⏭️ skipped.length:', responseObj.skipped.length);
    console.log('🔹 FULL RESPONSE:', JSON.stringify(responseObj, null, 2).substring(0, 1000) + '...');
    console.log('🔹🔹🔹 END RESPONSE FORMAT CHECK 🔹🔹🔹\n');

    return jsonOut(responseObj);
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

/**
 * ✅ PRO: Menu d'administration pour les opérations de maintenance
 * Ajoute un menu personnalisé "LaGrace Admin" dans Sheets
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('LaGrace Admin')
    .addItem('🆔 Backfill All UUIDs', 'menuBackfillUUIDs')
    .addItem('📥 Pull Changes (PRO)', 'menuPullChanges')
    .addItem('🔄 Sync Status', 'menuSyncStatus')
    .addSeparator()
    .addItem('📋 Show Tech Columns', 'menuShowTechColumns')
    .addItem('✅ Validate Schema', 'menuValidateSchema')
    .addSeparator()
    .addItem('🧹 Cleanup Ventes Duplicates', 'cleanupVentesDuplicates')
    .addToUi();
}

/**
 * Menu action: Backfill tous les UUIDs manquants
 */
function menuBackfillUUIDs() {
  const ui = SpreadsheetApp.getUi();
  try {
    const count = backfillAllUUIDs();
    ui.alert(`✅ Succès! ${count} UUID(s) généré(s)`);
  } catch (error) {
    ui.alert(`❌ Erreur: ${error.toString()}`);
  }
}

/**
 * Menu action: Afficher les changements depuis une date
 */
function menuPullChanges() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = ui.prompt('Depuis quand? (ISO format, ex: 2025-01-01T00:00:00Z, ou tapez "today"):');
    if (result.getSelectedButton() === ui.Button.OK) {
      let sinceStr = result.getResponseText();
      if (sinceStr.toLowerCase() === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        sinceStr = today.toISOString();
      }
      const sinceDate = toDate(sinceStr) || new Date(0);
      const changes = getPullChanges(sinceDate);
      
      const message = `📥 Pull Changes\n\n` +
                     `Total changements: ${changes.meta.total}\n` +
                     `Depuis: ${sinceDate.toISOString()}\n` +
                     `À: ${changes.meta.pulledAt}\n\n` +
                     `Produits modifiés:\n${changes.products.map(p => `- ${p.code} (${p.unit}): ${p.name}/${p.mark}`).join('\n')}`;
      ui.alert(message);
    }
  } catch (error) {
    ui.alert(`❌ Erreur: ${error.toString()}`);
  }
}

/**
 * Menu action: Afficher l'état de la synchronisation
 */
function menuSyncStatus() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheets = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
    let summary = '🔄 Sync Status\n\n';
    
    for (const sheetName of sheets) {
      const sheet = getSheet(sheetName);
      const lastRow = sheet.getLastRow();
      const colUuid = findColumnIndex(sheet, '_uuid');
      const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
      
      let uuidCount = 0;
      let withUpdateAt = 0;
      
      if (lastRow > 1 && colUuid > 0) {
        const values = sheet.getRange(2, colUuid, lastRow - 1, 1).getValues();
        uuidCount = values.filter(v => v[0]).length;
      }
      
      if (lastRow > 1 && colUpdatedAt > 0) {
        const values = sheet.getRange(2, colUpdatedAt, lastRow - 1, 1).getValues();
        withUpdateAt = values.filter(v => v[0]).length;
      }
      
      summary += `\n${sheetName}:\n` +
                `  Total lignes: ${lastRow - 1}\n` +
                `  Avec _uuid: ${uuidCount}/${lastRow - 1}\n` +
                `  Avec _updated_at: ${withUpdateAt}/${lastRow - 1}\n`;
    }
    
    ui.alert(summary);
  } catch (error) {
    ui.alert(`❌ Erreur: ${error.toString()}`);
  }
}

/**
 * Menu action: Afficher les colonnes techniques
 */
function menuShowTechColumns() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheets = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
    let info = '📋 Tech Columns\n\n';
    
    for (const sheetName of sheets) {
      const sheet = getSheet(sheetName);
      const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const techCols = header.filter((h, i) => String(h || '').startsWith('_')).map((h, i) => {
        const colIndex = header.indexOf(h) + 1;
        return `  ${h} (col ${colIndex})`;
      });
      
      info += `\n${sheetName}:\n${techCols.length ? techCols.join('\n') : '  (aucune colonne tech)'}\n`;
    }
    
    ui.alert(info);
  } catch (error) {
    ui.alert(`❌ Erreur: ${error.toString()}`);
  }
}

/**
 * Menu action: Valider le schéma
 */
function menuValidateSchema() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheets = [SHEETS.CARTON, SHEETS.MILLIERS, SHEETS.PIECE];
    let validation = '✅ Validation Schema\n\n';
    
    for (const sheetName of sheets) {
      const sheet = getSheet(sheetName);
      const requiredCols = ['_uuid', '_updated_at', '_version'];
      const missing = requiredCols.filter(col => findColumnIndex(sheet, col) < 0);
      
      if (missing.length > 0) {
        validation += `⚠️ ${sheetName}: Colonnes manquantes: ${missing.join(', ')}\n`;
      } else {
        validation += `✅ ${sheetName}: OK\n`;
      }
    }
    
    ui.alert(validation);
  } catch (error) {
    ui.alert(`❌ Erreur: ${error.toString()}`);
  }
}
/**
 * ✅ CLEANUP: Supprimer les doublons et lignes vides dans la feuille Ventes
 * - Supprime les lignes avec QTE = 0 ou vide
 * - Supprime les lignes sans Code produit
 * - Garde la ligne la plus récente en cas de doublon (même invoice + code + unit)
 */
function cleanupVentesDuplicates() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('⚠️ Nettoyage Ventes', 
    'Cette action va:\n' +
    '1. Supprimer les lignes avec QTE = 0\n' +
    '2. Supprimer les lignes sans Code produit\n' +
    '3. Supprimer les doublons (garder la plus récente)\n\n' +
    'Continuer?',
    ui.ButtonSet.YES_NO);
  
  if (response !== ui.Button.YES) {
    ui.alert('Annulé');
    return;
  }
  
  const sheet = getSheet(SHEETS.VENTES);
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  if (values.length <= 1) {
    ui.alert('Feuille vide ou seulement l\'en-tête');
    return;
  }
  
  const colFacture = findColumnIndex(sheet, 'Numéro de facture');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colQte = findColumnIndex(sheet, 'QTE');
  const colUnite = findColumnIndex(sheet, 'Unite');
  const colMark = findColumnIndex(sheet, 'MARK');
  const colUpdatedAt = findColumnIndex(sheet, '_updated_at');
  
  let deletedEmpty = 0;
  let deletedDuplicates = 0;
  const seen = new Map(); // clé composite → {row, updatedAt}
  const rowsToDelete = [];
  
  // Première passe: identifier les lignes à supprimer
  for (let i = 1; i < values.length; i++) {
    const rowIndex = i + 1; // 1-based
    const qty = toNumber(values[i][colQte - 1]);
    const code = normalizeCode(values[i][colCode - 1]);
    const invoice = normalizeCode(values[i][colFacture - 1]);
    
    // 1. Lignes vides (qty=0 ou pas de code/invoice)
    if (qty <= 0 || !code || !invoice) {
      rowsToDelete.push({ row: rowIndex, reason: 'empty' });
      deletedEmpty++;
      continue;
    }
    
    // 2. Doublons: clé composite = invoice + code + unit + mark
    const unit = colUnite > 0 ? normalizeUnitLevel(values[i][colUnite - 1]) : '';
    const mark = colMark > 0 ? normalizeMark(values[i][colMark - 1]) : '';
    const key = `${invoice}|${code}|${unit}|${mark}`;
    const updatedAt = colUpdatedAt > 0 ? values[i][colUpdatedAt - 1] : '';
    const updatedDate = toDate(updatedAt) || new Date(0);
    
    if (seen.has(key)) {
      const prev = seen.get(key);
      // Garder la plus récente
      if (updatedDate > prev.updatedDate) {
        // Supprimer l'ancienne
        rowsToDelete.push({ row: prev.row, reason: 'duplicate' });
        seen.set(key, { row: rowIndex, updatedDate });
      } else {
        // Supprimer la nouvelle (moins récente)
        rowsToDelete.push({ row: rowIndex, reason: 'duplicate' });
      }
      deletedDuplicates++;
    } else {
      seen.set(key, { row: rowIndex, updatedDate });
    }
  }
  
  // Trier par ligne décroissante pour supprimer de bas en haut
  rowsToDelete.sort((a, b) => b.row - a.row);
  
  // Supprimer
  for (const item of rowsToDelete) {
    sheet.deleteRow(item.row);
  }
  
  ui.alert(`✅ Nettoyage terminé\n\n` +
    `- Lignes vides supprimées: ${deletedEmpty}\n` +
    `- Doublons supprimés: ${deletedDuplicates}\n` +
    `- Total lignes supprimées: ${rowsToDelete.length}`);
}

// ===================================
// 🧪 TEST FUNCTIONS
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
 * TEST: Vérifier les PRODUCTS upserts (pourquoi génèrent-elles des conflits?)
 */
function testBatchProducts() {
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  🧪 TEST BATCH PUSH - PRODUCTS UPSERT             ║');
  console.log('╚════════════════════════════════════════════════════╝');
  
  // Obtenir un produit existant pour le tester
  const sheet = getSheet('Carton');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colName = findColumnIndex(sheet, 'Nom du produit');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  if (colCode < 0) {
    console.log('❌ Colonne Code produit non trouvée');
    return;
  }
  
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    console.log('❌ Aucun produit dans la feuille');
    return;
  }
  
  // Utiliser le 2e produit (index 1)
  const testCode = String(values[1][colCode - 1] || '').trim();
  const testName = colName > 0 ? String(values[1][colName - 1] || '').trim() : 'Test Product';
  const testUuid = colUuid > 0 ? String(values[1][colUuid - 1] || '').trim() : '';
  
  if (!testCode) {
    console.log('❌ Pas de code produit dans la première ligne');
    return;
  }
  
  console.log('📤 TEST PRODUCT UPSERT:');
  console.log('   code: ' + testCode);
  console.log('   name: ' + testName);
  console.log('   uuid: ' + testUuid);
  
  const testData = {
    device_id: 'TEST-PC',
    ops: [
      {
        op_id: 'test-op-prod-' + Date.now(),
        entity: 'products',
        op: 'upsert',
        payload: {
          code: testCode,
          name: testName + ' (modified)',
          unit_level: 'CARTON',
          unit_mark: '',
          stock_initial: 999,
          purchase_price_usd: 10.5,
          sale_price_fc: 25000,
          sale_price_usd: 8.5,
          uuid: testUuid,
          base_remote_updated_at: new Date(0).toISOString()  // Very old date to avoid conflicts
        }
      }
    ]
  };
  
  console.log('\n📨 Envoi handleBatchPush...');
  handleBatchPush(testData);
  
  console.log('\n✅ TEST TERMINÉ');
}

/**
 * TEST: Vérifier les PRODUCTS MULTIPLES (le vrai problème?)
 */
function testBatchProductsMultiple() {
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  🧪 TEST BATCH PUSH - MULTIPLE PRODUCTS           ║');
  console.log('╚════════════════════════════════════════════════════╝');
  
  // Obtenir les 5 premiers produits
  const sheet = getSheet('Carton');
  const colCode = findColumnIndex(sheet, 'Code produit');
  const colName = findColumnIndex(sheet, 'Nom du produit');
  const colUuid = findColumnIndex(sheet, '_uuid');
  
  const values = sheet.getDataRange().getValues();
  const ops = [];
  
  for (let i = 1; i < Math.min(6, values.length); i++) {  // 5 products
    const testCode = String(values[i][colCode - 1] || '').trim();
    if (!testCode) continue;
    
    const testName = colName > 0 ? String(values[i][colName - 1] || '').trim() : 'Test';
    const testUuid = colUuid > 0 ? String(values[i][colUuid - 1] || '').trim() : '';
    
    ops.push({
      op_id: 'test-multi-' + Date.now() + '-' + i,
      entity: 'products',
      op: 'upsert',
      payload: {
        code: testCode,
        name: testName + ' (batch test)',
        unit_level: 'CARTON',
        unit_mark: '',
        uuid: testUuid,
        base_remote_updated_at: new Date(0).toISOString()
      }
    });
  }
  
  console.log('📤 TEST ' + ops.length + ' PRODUCTS EN BATCH:');
  for (let i = 0; i < ops.length; i++) {
    console.log(`   [${i+1}] code=${ops[i].payload.code}`);
  }
  
  const testData = {
    device_id: 'TEST-PC',
    ops: ops
  };
  
  console.log('\n📨 Envoi handleBatchPush avec ' + ops.length + ' ops...');
  handleBatchPush(testData);
  
  console.log('\n✅ TEST TERMINÉ');
}