import { syncRepo } from '../../db/repositories/sync.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { sheetsClient } from './sheets.client.js';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { ratesRepo } from '../../db/repositories/rates.repo.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { syncLogger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';
import { getDb } from '../../db/sqlite.js';
import bcrypt from 'bcrypt';

// Intervalle de synchronisation (augmenté pour réduire la charge)
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS) || 10000; // 10 secondes par défaut

let syncInterval = null;
let isSyncing = false;
let syncRunning = false; // Mutex global pour empêcher les overlaps
let _started = false; // Flag pour la boucle "après fin"
let _loopTimeout = null; // Timeout de la boucle
let isOnline = true; // État de connexion Internet
let _salesSyncRunning = false; // Mutex pour la synchronisation des ventes
let _salesLoopTimeout = null; // Timeout de la boucle de synchronisation des ventes
let _pushSyncRunning = false; // Mutex pour le push des opérations pending
let _lastPushTime = 0; // Dernier push réussi
let _productsSyncRunning = false; // Mutex pour la synchronisation dédiée des produits
let _productsLoopTimeout = null; // Timeout de la boucle de synchronisation des produits

/**
 * ✅ HELPER ISO STRICT: Normalise TOUJOURS les dates en ISO 8601
 * Évite les bugs Date object → string locale non parsable
 */
function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * ✅ HELPER: Calcule "since" avec marge de sécurité (60s)
 * Évite les race conditions: "j'ai mis à jour juste avant le pull"
 */
function sinceIsoWithSkew(lastIso, skewMs = 60_000) {
  const iso = toIso(lastIso);
  if (!iso) return new Date(0).toISOString();
  const d = new Date(iso);
  return new Date(d.getTime() - skewMs).toISOString();
}

/**
 * Normalise l'unité depuis Sheets vers le format SQLite
 * Sheets peut avoir: "millier", "carton", "piece" (ou variations)
 * SQLite attend: "MILLIER", "CARTON", "PIECE" ou 1, 2, 3
 */
function normalizeUnitFromSheets(unitValue) {
  if (!unitValue || typeof unitValue !== 'string') return null;
  
  const trimmed = unitValue.trim();
  if (!trimmed) return null;
  
  const normalized = trimmed.toLowerCase();
  
  // Mapping des valeurs possibles depuis Sheets (ordre important : millier avant carton pour éviter les faux positifs)
  // Gérer "milliers" (pluriel) et "millier" (singulier)
  if (normalized === 'millier' || normalized === 'milliers' || normalized.includes('millier')) {
    return 'MILLIER';
  }
  // Gérer "carton" et "cartons"
  if (normalized === 'carton' || normalized === 'cartons' || normalized.includes('carton')) {
    return 'CARTON';
  }
  // Gérer "piece", "pièce", "pieces", "pièces"
  if (normalized === 'piece' || normalized === 'pièce' || normalized === 'pieces' || normalized === 'pièces' || normalized.includes('piece') || normalized.includes('pièce')) {
    return 'PIECE';
  }
  
  // Si c'est déjà en majuscules, le retourner tel quel
  const upper = trimmed.toUpperCase();
  if (upper === 'MILLIER' || upper === 'MILLIERS' || upper === 'CARTON' || upper === 'CARTONS' || upper === 'PIECE' || upper === 'PIECES' || upper === 'PIÈCE' || upper === 'PIÈCES') {
    // Normaliser les pluriels en singulier
    if (upper === 'MILLIERS') return 'MILLIER';
    if (upper === 'CARTONS') return 'CARTON';
    if (upper === 'PIECES' || upper === 'PIÈCES') return 'PIECE';
    return upper;
  }
  
  // Valeur non reconnue, retourner null pour forcer la recherche dans le produit
  return null;
}

/**
 * Worker de synchronisation qui tourne en arrière-plan
 */
export class SyncWorker {
  /**
   * ✅ HELPER: Parse robuste du payload (handle à la fois payload et payload_json)
   * Les opérations peuvent avoir:
   * - op.payload (object)
   * - op.payload_json (string JSON ou object)
   * Cette fonction gère les deux cas
   */
  parseOpPayload(op) {
    // Cas 1: payload est déjà un objet
    if (op.payload && typeof op.payload === 'object') {
      return op.payload;
    }

    // Cas 2: payload_json est une string JSON (besoin de parser)
    if (op.payload_json && typeof op.payload_json === 'string') {
      try {
        return JSON.parse(op.payload_json);
      } catch (e) {
        syncLogger.warn(`⚠️ [parseOpPayload] JSON parse error pour op_id=${op.op_id}: ${e.message}`);
        return {};
      }
    }

    // Cas 3: payload_json est déjà un objet
    if (op.payload_json && typeof op.payload_json === 'object') {
      return op.payload_json;
    }

    // Fallback: vide
    return {};
  }

  /**
   * Démarre le worker avec import initial intelligent
   * VERSION OPTIMISÉE: Logs minimaux au démarrage
   */
  async start() {
    if (syncInterval) return;

    // Log de démarrage condensé
    syncLogger.info(`🚀 [SYNC] Démarrage (intervalle: ${SYNC_INTERVAL_MS/1000}s) | URL: ${process.env.GOOGLE_SHEETS_WEBAPP_URL ? '✓' : '✗'}`);

    this.setupConnectionDetection();

    const initialImportDone = syncRepo.isInitialImportDone();
    const isDatabaseEmpty = !productsRepo.hasProducts();
    
    if (isDatabaseEmpty) {
      syncLogger.warn('[BOOTSTRAP] DB vide → full pull activé');
      await this.checkConnection();
      if (isOnline) {
        this.pullUpdates(true).catch(err => syncLogger.error(`[BOOTSTRAP] Erreur: ${err.message}`));
      }
    } else if (!initialImportDone) {
      syncLogger.info('[SYNC] Mode incrémental (flag=0)');
      if (isOnline) await this.runSyncSafe();
    } else {
      syncLogger.info('[SYNC] Mode normal');
      if (isOnline) await this.runSyncSafe();
    }

    _started = true;
    
    // Boucle principale (sans logs répétitifs)
    const loop = async () => {
      if (!_started) return;
      
      setImmediate(async () => {
        const t0 = Date.now();
        if (isOnline) {
          process.nextTick(async () => {
            await this.runSyncSafe().catch(err => syncLogger.error(`[AUTO-SYNC] ${err.message}`));
          });
        }
        
        const elapsed = Date.now() - t0;
        const wait = Math.max(2000, SYNC_INTERVAL_MS - elapsed);
        if (_started) _loopTimeout = setTimeout(loop, wait);
      });
    };
    
    setTimeout(loop, 5000);
    this.startSalesSyncLoop();
    this.startProductsSyncLoop();
    this.startPushSyncLoop();
  }
  
  /**
   * Boucle de push des opérations pending vers Google Sheets
   * VERSION OPTIMISÉE: Logs minimaux, fonctionnement silencieux
   */
  async startPushSyncLoop() {
    const PUSH_SYNC_INTERVAL_MS = 15000;
    
    syncLogger.info(`📤 [PUSH] Boucle démarrée (${PUSH_SYNC_INTERVAL_MS/1000}s)`);
    
    const pushLoop = async () => {
      if (!_started) return;
      if (_pushSyncRunning) {
        setTimeout(pushLoop, PUSH_SYNC_INTERVAL_MS);
        return;
      }
      
      try {
        // Vérifier les deux systèmes d'outbox
        const stats = outboxRepo.getStats();
        const legacyPending = syncRepo.getPending(1); // Juste pour vérifier s'il y en a
        
        if (stats.totalPending === 0 && stats.stockMovesPending === 0 && legacyPending.length === 0) {
          setTimeout(pushLoop, PUSH_SYNC_INTERVAL_MS);
          return;
        }
        
        // Log résumé uniquement si il y a des opérations
        if (stats.totalPending > 0 || stats.stockMovesPending > 0) {
          syncLogger.info(`📤 [PUSH] ${stats.totalPending} ops + ${stats.stockMovesPending} stock`);
        }
        if (legacyPending.length > 0) {
          syncLogger.info(`📤 [PUSH-LEGACY] ${legacyPending.length}+ ops (update_stock, etc.)`);
        }
      } catch (e) {
        syncLogger.error(`[PUSH] Stats error: ${e.message}`);
      }
      
      _pushSyncRunning = true;
      const t0 = Date.now();
      
      try {
        // ✅ Pusher les deux systèmes d'outbox
        await this.pushPendingOperations(); // sync_operations (PRODUCT_PATCH, SALE, etc.)
        await this.pushPending();           // sync_outbox (update_stock, upsert, append)
      } catch (error) {
        syncLogger.error(`[PUSH] ${error.message}`);
      } finally {
        _pushSyncRunning = false;
        const wait = Math.max(5000, PUSH_SYNC_INTERVAL_MS - (Date.now() - t0));
        if (_started) setTimeout(pushLoop, wait);
      }
    };
    
    setTimeout(pushLoop, 10000);
  }

  /**
   * Boucle dédiée produits - VERSION OPTIMISÉE (silencieuse)
   */
  async startProductsSyncLoop() {
    const PRODUCTS_SYNC_INTERVAL_MS = 10000;

    syncLogger.info(`📦 [PRODUCTS] Boucle démarrée (${PRODUCTS_SYNC_INTERVAL_MS/1000}s)`);

    const productsLoop = async () => {
      if (!_started) return;

      if (_productsSyncRunning) {
        _productsLoopTimeout = setTimeout(productsLoop, PRODUCTS_SYNC_INTERVAL_MS);
        return;
      }

      _productsSyncRunning = true;
      const t0 = Date.now();

      try {
        await this.syncProductsFromSheets();
      } catch (e) {
        syncLogger.warn(`[PRODUCTS] ${e.message}`);
      } finally {
        _productsSyncRunning = false;
        const wait = Math.max(2000, PRODUCTS_SYNC_INTERVAL_MS - (Date.now() - t0));
        if (_started) _productsLoopTimeout = setTimeout(productsLoop, wait);
      }
    };

    setTimeout(productsLoop, 2000);
  }
  
  /**
   * Push les opérations pending vers Google Sheets
   * VERSION OPTIMISÉE: Logs résumés uniquement
   */
  async pushPendingOperations() {
    const t0 = Date.now();
    try {
      const stats = outboxRepo.getStats();
      
      if (stats.totalPending === 0 && stats.stockMovesPending === 0) return;
      
      let pushedCount = 0;
      
      // 1. Push des patches produits
      const productPatches = outboxRepo.getPendingOperations('PRODUCT_PATCH', 50);
      if (productPatches.length > 0) {
        await this.pushProductPatches(productPatches);
        pushedCount += productPatches.length;
      }
      
      // 2. Push des patches unités
      const unitPatches = outboxRepo.getPendingOperations('UNIT_PATCH', 50);
      if (unitPatches.length > 0) {
        await this.pushUnitPatches(unitPatches);
        pushedCount += unitPatches.length;
      }
      
      // 3. Push des mouvements de stock
      const stockMoves = outboxRepo.getPendingOperations('STOCK_MOVE', 50);
      if (stockMoves.length > 0) {
        await this.pushStockMoves(stockMoves);
        pushedCount += stockMoves.length;
      }
      
      // 4. Push des dettes
      const debts = outboxRepo.getPendingOperations('DEBT', 50);
      if (debts.length > 0) {
        await this.pushDebts(debts);
        pushedCount += debts.length;
      }
      
      // 5. Push des ventes (SALE) vers Sheets
      const sales = outboxRepo.getPendingOperations('SALE', 50);
      if (sales.length > 0) {
        await this.pushSales(sales);
        pushedCount += sales.length;
      }
      
      outboxRepo.retryErrorOperations();
      _lastPushTime = Date.now();
      
      // Log résumé unique
      const ms = Date.now() - t0;
      if (pushedCount > 0) {
        syncLogger.info(`📤 [PUSH] ↑${pushedCount} ops (${ms}ms)`);
        
        // Pull silencieux après push
        setTimeout(async () => {
          try {
            await this.syncProductsFromSheets();
          } catch (e) {
            syncLogger.verbose(`[PUSH] Pull post-push: ${e.message}`);
          }
        }, 2000);
      }
      
    } catch (error) {
      syncLogger.error(`[PUSH] ${error.message}`);
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        isOnline = false;
      }
    }
  }
  
  /**
   * Push les patches produits vers Sheets
   * VERSION OPTIMISÉE: Logs minimaux, logique préservée
   */
  async pushProductPatches(patches) {
    if (!patches || patches.length === 0) return;
    
    const t0 = Date.now();
    const sheetsUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    
    if (!sheetsUrl) {
      syncLogger.error(`[PRODUCT-PATCH] URL non configurée`);
      return;
    }
    
    const ackedOpIds = [];
    const parentToChildOps = new Map();
    const ackedChildOps = new Set();
    let totalOpsCreated = 0;
    let productsNotFound = 0;
    
    // Préparer les opérations (sans logs par item)
    const ops = patches.flatMap((op) => {
      let payloadData = {};
      
      // Parser le payload JSON
      if (op.payload_json) {
        if (typeof op.payload_json === 'string') {
          try { payloadData = JSON.parse(op.payload_json); } catch (e) { payloadData = {}; }
        } else if (typeof op.payload_json === 'object') {
          payloadData = op.payload_json;
        }
      }

      let uuid = payloadData.uuid || op.entity_uuid || '';
      let units = [];
      let fullProduct = null;
      
      // Charger le produit complet
      try {
        fullProduct = productsRepo.findByCode(op.entity_code) ||
                      (productsRepo.findById && productsRepo.findById(Number(op.entity_code))) ||
                      (productsRepo.findByUUID && productsRepo.findByUUID(op.entity_uuid));
        
        if (fullProduct) {
          uuid = fullProduct.uuid || uuid;
          if (fullProduct.units && fullProduct.units.length > 0) {
            units = fullProduct.units.map((u) => ({
              id: u.id, uuid: u.uuid,
              unit_level: u.unit_level || 'CARTON',
              unit_mark: u.unit_mark || ''
            }));
          }
        } else {
          productsNotFound++;
        }
      } catch (e) {
        syncLogger.verbose(`[PRODUCT-PATCH] Load error: ${e.message}`);
      }

      // Fallback
      if (units.length === 0) {
        units = [{ unit_level: payloadData.unit_level || 'CARTON', unit_mark: payloadData.unit_mark || '' }];
      }

      // Nom final (fallback à DB si vide)
      let finalName = (payloadData.name !== undefined && payloadData.name !== null)
        ? String(payloadData.name).trim() : '';
      if (finalName === '' && fullProduct?.name) {
        finalName = String(fullProduct.name).trim();
      }

      const productCode = payloadData.code || fullProduct?.code || op.entity_code;
      
      // Fan-out: une op par unité
      return units.map((unit) => {
        const perUnitOpId = `${op.op_id}:${unit.unit_level}:${unit.unit_mark || ''}`;
        totalOpsCreated++;
        
        return {
          op_id: perUnitOpId,
          entity: 'products',
          op: 'upsert',
          payload: {
            ...payloadData,
            code: productCode,
            name: finalName,
            is_active: payloadData.is_active !== undefined ? payloadData.is_active : 1,
            unit_level: unit.unit_level,
            unit_mark: unit.unit_mark,
            unit_uuid: unit.uuid,
            uuid: uuid,
            parent_op_id: op.op_id
          }
        };
      });
    });

    // Map parent → children
    for (const op of ops) {
      const parentOpId = op.payload.parent_op_id;
      if (parentOpId) {
        if (!parentToChildOps.has(parentOpId)) parentToChildOps.set(parentOpId, []);
        parentToChildOps.get(parentOpId).push(op.op_id);
      }
    }

    if (ops.length === 0) {
      syncLogger.warn(`[PRODUCT-PATCH] 0 ops créées`);
      return;
    }

    // Batch push
    const batchSize = 50;
    let totalSent = 0, totalAcked = 0;
    
    for (let i = 0; i < ops.length; i += batchSize) {
      const batch = ops.slice(i, i + batchSize);

      try {
        const result = await sheetsClient.pushBatch(batch, { timeout: 30000 });
        totalSent += batch.length;
        const ackedCount = result.acked_count || (result.success ? batch.length : 0);
        totalAcked += ackedCount;

        if (result.success) {
          for (const op of batch) ackedChildOps.add(op.op_id);
          
          for (const [parentId, childIds] of parentToChildOps) {
            if (childIds.every(childId => ackedChildOps.has(childId)) && !ackedOpIds.includes(parentId)) {
              ackedOpIds.push(parentId);
            }
          }
        } else {
          const parentIdsToError = new Set();
          for (const op of batch) {
            const parentId = op.payload?.parent_op_id || op.op_id.split(':')[0];
            if (parentId && !parentIdsToError.has(parentId)) {
              try { outboxRepo.markAsError(parentId, result.error || 'Batch failed'); parentIdsToError.add(parentId); } catch (e) {}
            }
          }
        }
      } catch (err) {
        syncLogger.error(`[PRODUCT-PATCH] Batch error: ${err.message}`);
        const parentIdsToError = new Set();
        for (const op of batch) {
          const parentId = op.payload?.parent_op_id || op.op_id.split(':')[0];
          if (parentId && !parentIdsToError.has(parentId)) {
            try { outboxRepo.markAsError(parentId, err.message); parentIdsToError.add(parentId); } catch (e) {}
          }
        }
      }
    }

    // Finaliser
    if (ackedOpIds.length > 0) {
      try { outboxRepo.markAsAcked(ackedOpIds); } catch (e) { syncLogger.error(`[PRODUCT-PATCH] Ack error: ${e.message}`); }
    }

    const ms = Date.now() - t0;
    // Log résumé unique
    syncLogger.info(`📤 [PRODUCT-PATCH] ↑${totalAcked}/${totalSent} ops (${ms}ms)${productsNotFound > 0 ? ` [${productsNotFound} not found]` : ''}`);
    syncLogger.incrementPushed('products', totalAcked);
  }
  
  /**
   * Push les patches unités vers Sheets - VERSION OPTIMISÉE
   */
  async pushUnitPatches(patches) {
    if (!patches || patches.length === 0) return;
    
    const ackedOpIds = [];
    const ops = patches.map(op => {
      const payload = this.parseOpPayload(op);
      return {
        op_id: op.op_id,
        entity: 'product_units',
        op: 'upsert',
        payload: {
          code: payload.product_code || op.entity_code,
          name: payload.name || '',
          unit_level: payload.unit_level,
          unit_mark: payload.unit_mark || '',
          sale_price_usd: payload.sale_price_usd || 0,
          sale_price_fc: payload.sale_price_fc || 0,
          purchase_price_usd: payload.purchase_price_usd || 0,
          stock_initial: payload.stock_initial || payload.stock_current || 0,
          stock_current: payload.stock_current || payload.stock_initial || 0,
          auto_stock_factor: payload.auto_stock_factor || 1,
          qty_step: payload.qty_step || 1,
          uuid: payload.product_uuid,
          last_update: new Date().toISOString()
        }
      };
    });
    
    try {
      const result = await sheetsClient.pushBatch(ops);
      
      if (result.success) {
        for (const applied of (result.applied || [])) {
          if (applied.op_id) ackedOpIds.push(applied.op_id);
        }
        for (const conflict of (result.conflicts || [])) {
          if (conflict.op_id) outboxRepo.markAsError(conflict.op_id, conflict.reason || 'Conflit');
        }
        syncLogger.info(`📤 [UNIT-PATCH] ↑${ackedOpIds.length}/${patches.length}`);
        syncLogger.incrementPushed('units', ackedOpIds.length);
      } else {
        for (const op of patches) outboxRepo.markAsError(op.op_id, result.error || 'Erreur');
        syncLogger.warn(`[UNIT-PATCH] ${result.error}`);
        syncLogger.incrementErrors('units', patches.length);
      }
    } catch (error) {
      for (const op of patches) outboxRepo.markAsError(op.op_id, error.message);
      syncLogger.error(`[UNIT-PATCH] ${error.message}`);
      syncLogger.incrementErrors('units', patches.length);
    }
    
    if (ackedOpIds.length > 0) outboxRepo.markAsAcked(ackedOpIds);
  }
  
  /**
   * Push les mouvements de stock vers Sheets - VERSION OPTIMISÉE
   */
  async pushStockMoves(moves) {
    const ackedOpIds = [];
    const ackedMoveIds = [];
    
    if (!moves || moves.length === 0) return;

    // Regrouper par unité
    const movesByUnit = {};
    for (const op of moves) {
      const payload = this.parseOpPayload(op);
      const key = `${payload.product_code}-${payload.unit_level}-${payload.unit_mark || ''}`;
      if (!movesByUnit[key]) {
        movesByUnit[key] = { product_code: payload.product_code, unit_level: payload.unit_level, unit_mark: payload.unit_mark || '', moves: [] };
      }
      movesByUnit[key].moves.push({ op, payload });
    }
    
    // Créer les opérations
    const ops = [];
    for (const key in movesByUnit) {
      const unitMoves = movesByUnit[key];
      const totalDelta = unitMoves.moves.reduce((sum, m) => sum + m.payload.delta, 0);
      ops.push({
        op_id: unitMoves.moves[0].op.op_id,
        entity: 'stock_moves',
        op: 'delta_apply',
        payload: {
          product_code: unitMoves.product_code,
          unit_level: unitMoves.unit_level,
          unit_mark: unitMoves.unit_mark || '',
          delta: totalDelta,
          move_ids: unitMoves.moves.map(m => m.payload.move_id),
          op_ids: unitMoves.moves.map(m => m.op.op_id)
        }
      });
    }
    
    if (ops.length === 0) return;
    
    try {
      const result = await sheetsClient.pushBatch(ops, { timeout: 9000 });
      
      if (result.success || result.applied) {
        const allAckIds = [];
        for (const op of ops) {
          allAckIds.push(...(op.payload.op_ids || [op.op_id]));
          if (op.payload.move_ids) ackedMoveIds.push(...op.payload.move_ids);
        }
        const uniqueAckIds = [...new Set(allAckIds)];
        ackedOpIds.push(...uniqueAckIds);
        syncLogger.info(`📤 [STOCK] ↑${uniqueAckIds.length} ops`);
        syncLogger.incrementPushed('stock', uniqueAckIds.length);
      } else {
        for (const op of ops) {
          for (const id of (op.payload.op_ids || [op.op_id])) {
            outboxRepo.markAsError(id, result.error || 'Erreur');
          }
        }
        syncLogger.warn(`[STOCK] ${result.error}`);
        syncLogger.incrementErrors('stock', ops.length);
        return;
      }
    } catch (error) {
      for (const op of ops) {
        for (const id of (op.payload.op_ids || [op.op_id])) {
          outboxRepo.markAsError(id, error.message);
        }
      }
      syncLogger.error(`[STOCK] ${error.message}`);
      syncLogger.incrementErrors('stock', ops.length);
      return;
    }
    
    if (ackedOpIds.length > 0) outboxRepo.markAsAcked(ackedOpIds);
    if (ackedMoveIds.length > 0) outboxRepo.markStockMovesSynced(ackedMoveIds);
  }

  /**
   * Push les dettes vers Google Sheets - VERSION OPTIMISÉE
   */
  async pushDebts(debtOps) {
    if (!debtOps || debtOps.length === 0) return;

    const ackedOpIds = [];
    
    try {
      const normalizeNumber = (val) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return Math.round(val * 100) / 100;
        const num = parseFloat(String(val).replace(',', '.'));
        return isNaN(num) ? 0 : Math.round(num * 100) / 100;
      };

      const ops = [];
      for (const op of debtOps) {
        const payload = this.parseOpPayload(op);

        const uuid = String(payload.uuid || payload._uuid || op.entity_uuid || '').trim();
        const invoiceNumber = String(payload.invoice_number || payload.entity_code || op.entity_code || '').trim();
        const clientName = String(payload.client_name || '').trim();

        const totalFc = normalizeNumber(payload.total_fc);
        const totalUsd = normalizeNumber(payload.total_usd);

        if (!uuid || !invoiceNumber || !clientName || (totalFc <= 0 && totalUsd <= 0)) {
          outboxRepo.markAsError(op.op_id, 'Dette vide (uuid/invoice/client/montant manquant)');
          continue;
        }

        ops.push({
          op_id: op.op_id,
          entity: 'debts',
          op: 'upsert',
          payload: {
            // Champs attendus par Apps Script (handleDebtUpsert)
            uuid,
            invoice_number: invoiceNumber,
            client_name: clientName,
            client_phone: payload.client_phone || null,
            product_description: payload.product_description || payload.note || '',
            total_fc: totalFc,
            paid_fc: normalizeNumber(payload.paid_fc),
            remaining_fc: normalizeNumber(payload.remaining_fc),
            total_usd: totalUsd,
            paid_usd: normalizeNumber(payload.paid_usd),
            remaining_usd: normalizeNumber(payload.remaining_usd),
            debt_fc_in_usd: normalizeNumber(payload.debt_fc_in_usd || payload['Dettes Fc en usd'] || totalFc),
            created_at: payload.created_at || payload.date || new Date().toISOString(),
            device_id: payload.device_id || payload._device_id || op.device_id || ''
          }
        });
      }

      if (ops.length === 0) return;
      
      const result = await sheetsClient.pushBatch(ops, { timeout: 15000 });
      
      if (result.success || result.applied) {
        const pushedOpIds = ops.map(o => o.op_id);
        ackedOpIds.push(...pushedOpIds);
        syncLogger.info(`📤 [DEBT] ↑${pushedOpIds.length}`);
        syncLogger.incrementPushed('debts', pushedOpIds.length);
      } else {
        for (const op of debtOps) outboxRepo.markAsError(op.op_id, result.error || 'Erreur');
        syncLogger.warn(`[DEBT] ${result.error}`);
        syncLogger.incrementErrors('debts', debtOps.length);
        return;
      }
    } catch (error) {
      for (const op of debtOps) outboxRepo.markAsError(op.op_id, error.message);
      syncLogger.error(`[DEBT] ${error.message}`);
      syncLogger.incrementErrors('debts', debtOps.length);
      return;
    }
    
    // Marquer dans la BD comme ackés
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
  }
  
  /**
   * Push les ventes vers Google Sheets (feuille "Ventes")
   * ✅ NOUVEAU: Synchronise les ventes locales vers Sheets
   */
  async pushSales(saleOps) {
    if (!saleOps || saleOps.length === 0) return;

    const ackedOpIds = [];
    
    try {
      const normalizeNumber = (val) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return Math.round(val * 100) / 100;
        const num = parseFloat(String(val).replace(',', '.'));
        return isNaN(num) ? 0 : Math.round(num * 100) / 100;
      };

      const ops = [];
      for (const op of saleOps) {
        const payload = this.parseOpPayload(op);
        const sale = payload.sale || payload;
        const items = payload.items || [];

        const uuid = String(sale.uuid || op.entity_uuid || '').trim();
        const invoiceNumber = String(sale.invoice_number || op.entity_code || '').trim();

        if (!uuid || !invoiceNumber) {
          outboxRepo.markAsError(op.op_id, 'Vente invalide (uuid/invoice manquant)');
          continue;
        }

        // Créer une opération pour la vente principale
        ops.push({
          op_id: op.op_id,
          entity: 'sales',
          op: 'upsert',
          payload: {
            uuid,
            invoice_number: invoiceNumber,
            client_name: sale.client_name || 'Client comptant',
            client_phone: sale.client_phone || null,
            total_fc: normalizeNumber(sale.total_fc),
            total_usd: normalizeNumber(sale.total_usd),
            paid_fc: normalizeNumber(sale.paid_fc),
            paid_usd: normalizeNumber(sale.paid_usd),
            change_fc: normalizeNumber(sale.change_fc),
            change_usd: normalizeNumber(sale.change_usd),
            payment_method: sale.payment_method || 'cash',
            status: sale.status || 'completed',
            user_id: sale.user_id || null,
            user_name: sale.user_name || null,
            created_at: sale.created_at || new Date().toISOString(),
            device_id: op.device_id || '',
            // Items sérialisés pour référence
            items_count: items.length,
            items_json: JSON.stringify(items.map(item => ({
              product_code: item.product_code,
              product_name: item.product_name,
              unit_level: item.unit_level,
              unit_mark: item.unit_mark || '',
              qty: item.qty,
              unit_price_fc: item.unit_price_fc,
              unit_price_usd: item.unit_price_usd,
              line_total_fc: item.line_total_fc,
              line_total_usd: item.line_total_usd
            })))
          }
        });
      }

      if (ops.length === 0) return;
      
      const result = await sheetsClient.pushBatch(ops, { timeout: 20000 });
      
      if (result.success || result.applied) {
        const pushedOpIds = ops.map(o => o.op_id);
        ackedOpIds.push(...pushedOpIds);
        syncLogger.info(`📤 [SALE] ↑${pushedOpIds.length} vente(s)`);
        syncLogger.incrementPushed('sales', pushedOpIds.length);
      } else {
        for (const op of saleOps) outboxRepo.markAsError(op.op_id, result.error || 'Erreur sync vente');
        syncLogger.warn(`[SALE] ${result.error}`);
        syncLogger.incrementErrors('sales', saleOps.length);
        return;
      }
    } catch (error) {
      for (const op of saleOps) outboxRepo.markAsError(op.op_id, error.message);
      syncLogger.error(`[SALE] ${error.message}`);
      syncLogger.incrementErrors('sales', saleOps.length);
      return;
    }
    
    // Marquer comme ackés
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
  }
  
  /**
   * Synchronise uniquement les produits depuis Sheets (pull)
   * ✅ CORRECTION PRO:
   * - Dates STRICTEMENT en ISO (pas de Date object)
   * - Marge de sécurité 60s pour éviter les race conditions
   * - Boucle indépendante toutes les 10s (pas bloquée par ventes/push)
   */
  async syncProductsFromSheets() {
    try {
      const sinceIso = sinceIsoWithSkew(syncRepo.getLastPullDate('products'), 60_000);
      const productUnitLevels = ['CARTON', 'MILLIER', 'PIECE'];
      const allProducts = [];
      
      for (const unitLevel of productUnitLevels) {
        try {
          const result = await sheetsClient.pullAllPaged('products', sinceIso, {
            full: false, unitLevel: unitLevel, maxRetries: 3, timeout: 30000, limit: 300
          });
          
          if (result.success && result.data.length > 0) {
            allProducts.push(...result.data);
          } else if (!result.success) {
            syncLogger.verbose(`[PRODUCTS/${unitLevel}] ${result.error}`);
          }
        } catch (error) {
          syncLogger.verbose(`[PRODUCTS/${unitLevel}] ${error.message}`);
        }
      }
      
      if (allProducts.length > 0) {
        await this.applyProductUpdates(allProducts);
        syncRepo.setLastPullDate('products', new Date().toISOString());
        syncLogger.info(`📥 [PRODUCTS] ↓${allProducts.length}`);
      }
    } catch (error) {
      syncLogger.error(`[PRODUCTS] ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Boucle sync ventes - VERSION OPTIMISÉE
   */
  async startSalesSyncLoop() {
    const SALES_SYNC_INTERVAL_MS = 10000;
    
    syncLogger.info(`💰 [SALES] Boucle démarrée (${SALES_SYNC_INTERVAL_MS/1000}s)`);
    
    const syncSalesLoop = async () => {
      if (!_started) return;
      
      if (_salesSyncRunning || !isOnline) {
        _salesLoopTimeout = setTimeout(syncSalesLoop, SALES_SYNC_INTERVAL_MS);
        return;
      }
      
      _salesSyncRunning = true;
      const t0 = Date.now();
      
      try {
        await this.syncSalesOnly();
      } catch (error) {
        syncLogger.error(`[SALES] ${error.message}`);
      } finally {
        _salesSyncRunning = false;
        const wait = Math.max(1000, SALES_SYNC_INTERVAL_MS - (Date.now() - t0));
        if (_started) _salesLoopTimeout = setTimeout(syncSalesLoop, wait);
      }
    };
    
    setImmediate(() => syncSalesLoop());
  }
  
  /**
   * Synchronise les ventes depuis Google Sheets - VERSION OPTIMISÉE
   */
  async syncSalesOnly() {
    const t0 = Date.now();
    
    try {
      const cursor = syncRepo.getCursor('sales');
      let sinceDate;
      let isIncrementalSync = false;
      
      if (cursor) {
        sinceDate = new Date(0).toISOString();
      } else {
        const lastPullDateIso = syncRepo.getLastPullDate('sales');
        if (lastPullDateIso) {
          sinceDate = sinceIsoWithSkew(lastPullDateIso, 60_000);
          isIncrementalSync = true;
        } else {
          sinceDate = new Date(0).toISOString();
        }
      }
      
      let currentCursor = cursor;
      let totalProcessed = 0;
      let pageNumber = 0;
      let isComplete = false;
      let maxUpdatedAt = null;
      
      while (!isComplete) {
        pageNumber++;
        
        const result = await sheetsClient.pull('sales', sinceDate, {
          full: true,
          cursor: currentCursor,
          maxRetries: 5,
          timeout: isIncrementalSync ? 30000 : 60000,
          limit: isIncrementalSync ? 200 : 500
        });
        
        if (!result.success) {
          syncLogger.warn(`[SALES] Page ${pageNumber} fail: ${result.error}`);
          break;
        }
        
        if (result.success && result.data && result.data.length > 0) {
          // Track max updated date
          for (const item of result.data) {
            const itemUpdatedAt = item._updated_at || item._remote_updated_at || item.sold_at;
            if (itemUpdatedAt) {
              const itemDate = new Date(itemUpdatedAt);
              if (!maxUpdatedAt || itemDate > maxUpdatedAt) maxUpdatedAt = itemDate;
            }
          }
          
          const applyResult = await this.applyUpdates('sales', result.data);
          
          // Log résumé uniquement si verbose
          syncLogger.verbose(`[SALES] Page ${pageNumber}: +${applyResult.inserted || 0} -${applyResult.updated || 0}`);
          
          totalProcessed += result.data.length;
          
          if (result.next_cursor && !result.done) {
            currentCursor = result.next_cursor;
          } else {
            isComplete = true;
            syncRepo.setCursor('sales', null);
          }
        } else if (result.success && (!result.data || result.data.length === 0)) {
          isComplete = true;
          syncRepo.setCursor('sales', null);
        } else {
          syncLogger.warn(`[SALES] Page ${pageNumber}: ${result.error}`);
          break;
        }
      }
      
      // Update last pull date
      const finalLastPullDate = maxUpdatedAt && maxUpdatedAt > new Date(sinceDate) 
        ? maxUpdatedAt.toISOString() 
        : new Date().toISOString();
      syncRepo.setLastPullDate('sales', finalLastPullDate);
      
      // Log résumé final
      const ms = Date.now() - t0;
      if (totalProcessed > 0) {
        syncLogger.info(`💰 [SALES] ↓${totalProcessed} (${pageNumber} pages, ${ms}ms)`);
        syncLogger.incrementPulled('sales', totalProcessed);
      }
      
      // Sync bidirectionnelle silencieuse
      try { await this.syncLocalSalesToSheets(); } catch (e) { syncLogger.verbose(`[SALES] Push: ${e.message}`); }
      
      // Cleanup silencieux
      if (isOnline) {
        try { await this.cleanupLocalSalesNotInSheets(); } catch (e) { syncLogger.verbose(`[SALES] Cleanup: ${e.message}`); }
      }
      
      // Verify silencieux
      try { await this.verifySalesSync(); } catch (e) { syncLogger.verbose(`[SALES] Verify: ${e.message}`); }
    } catch (error) {
      syncLogger.error(`[SALES] ${error.message}`);
    }
  }
  
  /**
   * Vérifie les ventes - VERSION OPTIMISÉE (silencieuse sauf erreurs)
   */
  async verifySalesSync() {
    try {
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      
      const totalSales = db.prepare('SELECT COUNT(*) as count FROM sales').get();
      const salesFromSheets = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('SHEETS');
      const salesWithoutItems = db.prepare(`
        SELECT COUNT(DISTINCT s.id) as count FROM sales s
        LEFT JOIN sale_items si ON s.id = si.sale_id WHERE si.id IS NULL
      `).get();
      
      // Log résumé uniquement si problèmes ou mode verbose
      if (salesWithoutItems.count > 0) {
        syncLogger.warn(`[VERIFY-SALES] ${salesWithoutItems.count} vente(s) sans items`);
      }
      
      syncLogger.verbose(`[VERIFY-SALES] Total: ${totalSales.count}, Sheets: ${salesFromSheets.count}`);
    } catch (error) {
      syncLogger.error(`[VERIFY-SALES] ${error.message}`);
    }
  }
  
  /**
   * Synchronise les ventes locales vers Sheets - VERSION OPTIMISÉE
   */
  async syncLocalSalesToSheets() {
    if (!isOnline) return;
    
    try {
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      
      const localSales = db.prepare(`SELECT s.* FROM sales s WHERE s.origin = 'LOCAL' ORDER BY s.sold_at DESC`).all();
      if (!localSales || localSales.length === 0) return;
      
      const opsToPush = [];
      for (const sale of localSales) {
        if (!isOnline) return;
        
        try {
          const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
          const statusForSheets = sale.status === 'pending' ? 'paid' : sale.status;
          
          opsToPush.push({
            entity: 'sales',
            op: 'upsert',
            payload: {
              uuid: sale.uuid, invoice_number: sale.invoice_number, sold_at: sale.sold_at,
              client_name: sale.client_name, client_phone: sale.client_phone, seller_name: sale.seller_name,
              total_fc: sale.total_fc, total_usd: sale.total_usd, rate_fc_per_usd: sale.rate_fc_per_usd || 2800,
              payment_mode: sale.payment_mode || 'cash', paid_fc: sale.paid_fc || 0, paid_usd: sale.paid_usd || 0,
              status: statusForSheets, origin: sale.origin, source_device: sale.source_device,
              items: items.map(item => ({
                uuid: item.uuid, product_code: item.product_code, product_name: item.product_name,
                unit_level: item.unit_level, unit_mark: item.unit_mark || '', qty: item.qty,
                qty_label: item.qty_label || item.qty.toString(), unit_price_fc: item.unit_price_fc,
                subtotal_fc: item.subtotal_fc, unit_price_usd: item.unit_price_usd || 0, subtotal_usd: item.subtotal_usd || 0
              }))
            },
            base_remote_updated_at: sale.synced_at || sale.updated_at || sale.sold_at
          });
        } catch (e) {
          syncLogger.verbose(`[LOCAL-SALES-PUSH] Prep error ${sale.invoice_number}: ${e.message}`);
        }
      }
      
      if (opsToPush.length === 0) return;
      
      const pushResult = await sheetsClient.batchPush(opsToPush);
      let pushed = 0;
      
      if (pushResult && pushResult.success) {
        const now = new Date().toISOString();
        
        for (const appliedOp of pushResult.applied || []) {
          const saleToUpdate = localSales.find(s => s.uuid === appliedOp.uuid || s.invoice_number === appliedOp.invoice_number);
          if (saleToUpdate) {
            const wasPending = saleToUpdate.status === 'pending';
            if (wasPending) {
              db.prepare('UPDATE sales SET synced_at = ?, status = ? WHERE id = ?').run(now, 'paid', saleToUpdate.id);
            } else {
              db.prepare('UPDATE sales SET synced_at = ? WHERE id = ?').run(now, saleToUpdate.id);
            }
            pushed++;
          }
        }
        
        if (pushed > 0) {
          syncLogger.info(`📤 [LOCAL-SALES] ↑${pushed}`);
          syncLogger.incrementPushed('sales', pushed);
        }
      } else {
        syncLogger.verbose(`[LOCAL-SALES-PUSH] ${pushResult?.error || 'Erreur'}`);
        if (pushResult?.error && (pushResult.error.includes('timeout') || pushResult.error.includes('ECONN'))) {
          isOnline = false;
        }
      }
    } catch (error) {
      syncLogger.verbose(`[LOCAL-SALES-PUSH] ${error.message}`);
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        isOnline = false;
      }
    }
  }
  
  /**
   * Supprime les ventes locales qui n'existent plus dans Sheets (sauf si status = pending)
   * Ne bloque pas si hors ligne ou erreur
   */
  async cleanupLocalSalesNotInSheets() {
    try {
      // VÉRIFIER LA CONNEXION INTERNET AVANT DE COMMENCER
      if (!isOnline) return;
      
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      const sheetsInvoices = new Set();
      let cursor = null;
      let done = false;
      let pageCount = 0;
      let totalSheetsRows = 0;
      
      try {
        while (!done && pageCount < 100) {
          pageCount++;
          
          if (!isOnline) return;
          
          const result = await sheetsClient.pull('sales', new Date(0), {
            full: true,
            cursor: cursor,
            limit: 500
          });
          
          if (!result.success) {
            if (result.error && (result.error.includes('timeout') || result.error.includes('ECONNREFUSED') || result.error.includes('ENOTFOUND'))) {
              isOnline = false;
            }
            return;
          }
          
          if (result.data && result.data.length > 0) {
            result.data.forEach(item => {
              if (item.invoice_number) {
                sheetsInvoices.add(item.invoice_number);
              }
            });
            totalSheetsRows += result.data.length;
            
            if (result.done || !result.next_cursor) {
              done = true;
            } else {
              cursor = result.next_cursor;
            }
          } else {
            done = true;
          }
        }
      } catch (pullError) {
        if (pullError.code === 'ECONNREFUSED' || pullError.code === 'ENOTFOUND' || pullError.code === 'ETIMEDOUT' || pullError.message?.includes('timeout')) {
          isOnline = false;
        }
        return;
      }
      
      // Récupérer les ventes locales
      const allSales = db.prepare(`
        SELECT id, invoice_number, status, sold_at, synced_at, origin
        FROM sales
        ORDER BY sold_at DESC
      `).all();
      
      const localSales = allSales.filter(s => s.origin === 'LOCAL');
      const sheetsSales = allSales.filter(s => s.origin === 'SHEETS');
      const syncedLocalSales = localSales.filter(s => s.synced_at !== null);
      
      let deletedLocal = 0;
      let deletedSheets = 0;
      
      // Nettoyer les ventes LOCALES synchronisées qui ne sont plus dans Sheets
      for (const sale of syncedLocalSales) {
        if (!sheetsInvoices.has(sale.invoice_number)) {
          try {
            db.prepare('DELETE FROM print_jobs WHERE invoice_number = ?').run(sale.invoice_number);
            db.prepare('DELETE FROM debt_payments WHERE debt_id IN (SELECT id FROM debts WHERE sale_id = ?)').run(sale.id);
            db.prepare('DELETE FROM debts WHERE sale_id = ?').run(sale.id);
            db.prepare('DELETE FROM sale_voids WHERE sale_id = ?').run(sale.id);
            db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(sale.id);
            db.prepare('DELETE FROM sales WHERE id = ?').run(sale.id);
            deletedLocal++;
          } catch (e) { /* ignore */ }
        }
      }
      
      // Nettoyer les ventes SHEETS absentes
      for (const sale of sheetsSales) {
        if (!sheetsInvoices.has(sale.invoice_number)) {
          try {
            db.prepare('DELETE FROM print_jobs WHERE invoice_number = ?').run(sale.invoice_number);
            db.prepare('DELETE FROM debt_payments WHERE debt_id IN (SELECT id FROM debts WHERE sale_id = ?)').run(sale.id);
            db.prepare('DELETE FROM debts WHERE sale_id = ?').run(sale.id);
            db.prepare('DELETE FROM sale_voids WHERE sale_id = ?').run(sale.id);
            db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(sale.id);
            db.prepare('DELETE FROM sales WHERE id = ?').run(sale.id);
            deletedSheets++;
          } catch (e) { /* ignore */ }
        }
      }
      
      if (deletedLocal + deletedSheets > 0) {
        syncLogger.info(`🧹 [CLEANUP] ${deletedLocal + deletedSheets} vente(s) supprimée(s)`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        isOnline = false;
      }
    }
  }

  /**
   * Configure la détection automatique de connexion Internet (en temps réel)
   * Optimisé pour ne pas bloquer l'event loop
   */
  setupConnectionDetection() {
    // Vérifier la connexion toutes les 15 secondes (réduit la charge)
    setInterval(() => {
      // Utiliser setImmediate pour ne pas bloquer l'event loop
      setImmediate(() => {
        this.checkConnection().catch(() => {
          // Ignorer les erreurs silencieusement pour ne pas polluer les logs
        });
      });
    }, 15000); // Vérifier toutes les 15 secondes (au lieu de 5s)
  }

  /**
   * Vérifie si une connexion Internet est disponible (détection automatique en arrière-plan)
   */
  async checkConnection() {
    const webAppUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    if (!webAppUrl) {
      return; // Pas d'URL configurée
    }

    try {
      const axios = (await import('axios')).default;
      
      // Essayer de pinger Google Sheets avec un timeout court
      const response = await axios.get(webAppUrl, {
        params: { entity: 'test' },
        timeout: 3000, // 3 secondes de timeout
        validateStatus: (status) => status < 500, // Accepter même les erreurs 4xx (signe de connexion)
      });
      
      // Si on arrive ici, la connexion est disponible
      if (!isOnline) {
        syncLogger.info('🌐 [INTERNET] Connexion Internet détectée automatiquement, reprise de la synchronisation');
        isOnline = true;
        
        // Si l'import initial n'a pas été fait, charger immédiatement tous les produits
        const initialImportDone = syncRepo.isInitialImportDone();
        const isDatabaseEmpty = !productsRepo.hasProducts();
        if (!initialImportDone && isDatabaseEmpty) {
          syncLogger.info('📥 [AUTO-SYNC] Base de données vide, import initial automatique depuis Google Sheets...');
          // Import initial complet en arrière-plan (non-bloquant)
          this.pullUpdates(true).catch(err => {
            syncLogger.error('❌ [AUTO-SYNC] Erreur lors de l\'import initial automatique:', err);
          });
        } else {
          // Relancer une sync immédiate (non-bloquant)
          syncLogger.info('🔄 [AUTO-SYNC] Synchronisation automatique déclenchée après détection Internet');
          this.runSyncSafe().catch(err => {
            syncLogger.error('❌ [AUTO-SYNC] Erreur lors de la sync automatique:', err);
          });
        }
      }
    } catch (error) {
      // ✅ IMPORTANT: Seulement marquer comme offline si c'est une vraie erreur de connexion
      // Les timeouts occasionnels ne doivent pas marquer la connexion comme perdue
      // Seulement les erreurs ECONNREFUSED, ENOTFOUND sont vraies déconnexions
      const isRealConnectionError = 
        error.code === 'ECONNREFUSED' || 
        error.code === 'ENOTFOUND' || 
        error.code === 'ERR_TLS_CERT_ALTNAME_INVALID';
      
      if (isRealConnectionError && isOnline) {
        syncLogger.warn('⚠️ [INTERNET] Connexion Internet perdue, synchronisation en attente');
        isOnline = false;
      } else if (!isRealConnectionError) {
        // Timeout ou autre erreur temporaire - ne pas marquer comme offline
        if (isOnline) {
          syncLogger.debug(`⚠️ [INTERNET] Erreur temporaire de connexion (${error.code}), mais isOnline=true`);
        }
      }
    }
  }

  /**
   * Arrête le worker
   */
  stop() {
    _started = false;
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    if (_loopTimeout) {
      clearTimeout(_loopTimeout);
      _loopTimeout = null;
    }
    if (_salesLoopTimeout) {
      clearTimeout(_salesLoopTimeout);
      _salesLoopTimeout = null;
    }
    // ✅ Arrêter la boucle dédiée des produits
    if (_productsLoopTimeout) {
      clearTimeout(_productsLoopTimeout);
      _productsLoopTimeout = null;
    }
    syncLogger.info('Worker de synchronisation arrêté');
    syncLogger.info('💰 [SALES-SYNC] Synchronisation dédiée des ventes arrêtée');
    syncLogger.info('📦 [PRODUCTS-SYNC] Synchronisation dédiée des produits arrêtée');
  }

  /**
   * Wrapper sécurisé pour sync() avec mutex anti-overlap et timeout
   * Optimisé pour ne pas bloquer l'event loop
   */
  async runSyncSafe() {
    if (syncRunning) {
      syncLogger.warn('⏭️ Sync déjà en cours, skip');
      return;
    }
    syncRunning = true;
    
    // Timeout de sécurité (3 minutes max, réduit de 5min)
    const timeout = setTimeout(() => {
      if (syncRunning) {
        syncLogger.error('⏱️ Timeout: Sync prend trop de temps (>3min), arrêt forcé');
        syncRunning = false;
        isSyncing = false;
      }
    }, 3 * 60 * 1000);
    
    try {
      // Utiliser setImmediate pour différer la sync et donner priorité aux requêtes API
      await new Promise((resolve, reject) => {
        setImmediate(async () => {
          try {
            await this.sync();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      syncLogger.error('❌ Sync error', error);
      // Ne pas planter l'application, juste logger l'erreur
      if (error.message?.includes('ECONNREFUSED') || error.message?.includes('ETIMEDOUT')) {
        syncLogger.warn('⚠️ Problème de connexion, sync sera réessayée au prochain cycle');
      }
    } finally {
      clearTimeout(timeout);
      // Utiliser setImmediate pour libérer le mutex de manière non-bloquante
      setImmediate(() => {
        syncRunning = false;
      });
    }
  }

  /**
   * Effectue une synchronisation complète avec gestion d'erreurs robuste
   * Optimisé pour ne pas bloquer l'event loop
   */
  async sync() {
    if (isSyncing) {
      return; // Déjà en cours
    }

    isSyncing = true;
    const syncStartTime = Date.now();

    try {
      // Utiliser setImmediate pour différer chaque étape et donner priorité aux requêtes API
      // Push: envoyer les opérations en attente (avec timeout)
      try {
        await new Promise((resolve, reject) => {
          setImmediate(async () => {
            try {
              await Promise.race([
                this.pushPending(),
                new Promise((_, rejectTimeout) => 
                  setTimeout(() => rejectTimeout(new Error('Push timeout')), 2 * 60 * 1000)
                )
              ]);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
      } catch (pushError) {
        syncLogger.warn('⚠️ Erreur push (non bloquant):', pushError.message);
        // Continue même si push échoue
      }

      // Pull: récupérer les données depuis Sheets (avec timeout)
      // Utiliser process.nextTick pour donner encore plus de priorité aux requêtes API
      try {
        await new Promise((resolve, reject) => {
          process.nextTick(async () => {
            try {
              await Promise.race([
                this.pullUpdates(),
                new Promise((_, rejectTimeout) => 
                  setTimeout(() => rejectTimeout(new Error('Pull timeout')), 3 * 60 * 1000)
                )
              ]);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
      } catch (pullError) {
        syncLogger.warn('⚠️ Erreur pull (non bloquant):', pullError.message);
        // Continue même si pull échoue partiellement
      }
      
      const duration = Date.now() - syncStartTime;
      syncLogger.debug(`✅ Sync terminée en ${duration}ms`);
    } catch (error) {
      syncLogger.error('❌ Erreur lors de la synchronisation:', error);
      // Ne pas propager l'erreur pour éviter de planter l'application
    } finally {
      // Libérer le flag de manière non-bloquante
      setImmediate(() => {
        isSyncing = false;
      });
    }
  }

  /**
   * Push les opérations en attente vers Google Sheets (mode PRO avec batch ou concurrence limitée)
   */
  async pushPending() {
    // Ne pas push si pas de connexion
    if (!isOnline) {
      syncLogger.debug(`⏸️  [PUSH] Pas de connexion Internet, push annulé`);
      return;
    }

    try {
      const pending = syncRepo.getPending(200); // Max 200 par batch

      if (pending.length === 0) return;

      // Préparer les ops pour batch
      const ops = pending.map(op => ({
        op_id: op.id,
        entity: op.entity,
        entity_id: op.entity_id,
        op: op.op,
        payload: this.parseOpPayload(op)
      }));
      
      const batchResult = await sheetsClient.pushBatch(ops, { timeout: 9000 });
      
      if (batchResult.applied) {
        for (const applied of batchResult.applied) {
          syncRepo.markAsSent(applied.op_id);
        }
        if (batchResult.applied.length > 0) {
          syncLogger.info(`📤 [PUSH] ↑${batchResult.applied.length} ops`);
        }
      }

      if (batchResult.conflicts && batchResult.conflicts.length > 0) {
        for (const conflict of batchResult.conflicts) {
          syncRepo.markAsError(conflict.op_id, new Error(conflict.error || 'Conflit'));
        }
      }

      if (!batchResult.success && batchResult.error) {
        if (batchResult.error.includes('network') || batchResult.error.includes('ECONNREFUSED') || batchResult.error.includes('timeout')) {
              isOnline = false;
            }
          }
        } catch (error) {
      syncLogger.error('❌ [PUSH] Erreur pushPending:', error.message);
          // Si erreur réseau, marquer comme hors ligne
          if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            isOnline = false;
          }
    }
  }

  /**
   * Pull les mises à jour depuis Google Sheets - Mode PRO avec pagination
   * Télécharge TOUTES les feuilles (Carton, Piece, Milliers, Ventes, Dettes, etc.)
   * @param {boolean} isInitialImport - Si true, import complet paginé (ignore les dates)
   */
  async pullUpdates(isInitialImport = false) {
    // Vérifier la connexion Internet
    if (!isOnline && !isInitialImport) {
      syncLogger.debug('Hors ligne, pull ignoré');
      return;
    }

    // BOOTSTRAP AUTOMATIQUE : Si table vide → forcer full pull
    const isProductsEmpty = !productsRepo.hasProducts();
    if (isProductsEmpty && !isInitialImport) {
      syncLogger.warn('⚠️  [BOOTSTRAP AUTO] Table products vide détectée → Passage en mode FULL PULL');
      isInitialImport = true; // Forcer le mode full pull
    }

    // Vérifier si les utilisateurs sont vides
    const usersCount = usersRepo.findAll().length;
    const isUsersEmpty = usersCount === 0;

    const globalStartTime = Date.now();

    try {
      const entities = ['users', 'rates', 'debts', 'products', 'sales'];
      const results = [];
      
      // Construire sinceMap pour tous
      const sinceMap = {};
      for (const e of entities) {
        const lastPullDate = syncRepo.getLastPullDate(e);
        let forceFullImport = isInitialImport;
        if (e === 'users' || e === 'debts') forceFullImport = true;
        sinceMap[e] = forceFullImport ? new Date(0).toISOString() : (lastPullDate || new Date(0).toISOString());
      }
      
      // Mode PRO: Full import paginé si initial, sinon incrémental
      if (isInitialImport) {
        // 1) Légers (users, rates, debts)
        const lightEntities = ['users', 'rates', 'debts'];
        
        for (const entity of lightEntities) {
          try {
            const result = await sheetsClient.pullAllPaged(entity, sinceMap[entity], {
              full: true, maxRetries: 8, timeout: 30000
            });
            
            if (result.success && result.data.length > 0) {
              await this.applyUpdates(entity, result.data);
              syncRepo.setLastPullDate(entity, new Date().toISOString());
              results.push({ entity, success: true, data: result.data });
            } else {
              results.push({ entity, success: result.success, data: result.data || [], error: result.error });
            }
          } catch (error) {
            results.push({ entity, success: false, data: [], error: error.message });
          }
        }
        
        // 2) Products - paginé par unit_level
        const productUnitLevels = ['CARTON', 'MILLIER', 'PIECE'];
        const allProducts = [];
        
        for (const unitLevel of productUnitLevels) {
          try {
            const cursor = syncRepo.getCursor('products', unitLevel);
            const result = await sheetsClient.pullAllPaged('products', sinceMap['products'], {
              full: true, unitLevel: unitLevel, startCursor: cursor, maxRetries: 8, timeout: 30000, limit: 300
            });
            
            if (result.success) {
              allProducts.push(...result.data);
              syncRepo.setCursor('products', result.last_cursor || null, unitLevel);
            }
          } catch (error) { /* ignore */ }
        }
        
        if (allProducts.length > 0) {
          try {
            await this.applyUpdates('products', allProducts);
            syncRepo.setLastPullDate('products', new Date().toISOString());
            if (!syncRepo.isInitialImportDone()) {
              syncRepo.setInitialImportDone();
            }
            results.push({ entity: 'products', success: true, data: allProducts });
          } catch (applyError) {
            results.push({ entity: 'products', success: false, data: [], error: applyError.message });
          }
        }
        
        // 3) Sales - paginé
        try {
          const cursor = syncRepo.getCursor('sales');
          
          const result = await sheetsClient.pullAllPaged('sales', sinceMap['sales'], {
            full: true, startCursor: cursor, maxRetries: 8, timeout: 30000, limit: 300
          });
          
          if (result.success && result.data && result.data.length > 0) {
            try {
              await this.applyUpdates('sales', result.data);
              syncRepo.setLastPullDate('sales', new Date().toISOString());
              syncRepo.setCursor('sales', result.last_cursor || null);
              results.push({ entity: 'sales', success: true, data: result.data });
            } catch (applyError) {
              results.push({ entity: 'sales', success: false, data: [], error: applyError.message });
            }
          } else {
            results.push({ entity: 'sales', success: result.success, data: [], error: result.error });
          }
        } catch (error) {
          results.push({ entity: 'sales', success: false, data: [], error: error.message });
        }
        
      } else {
        // Mode incrémental normal
        sinceMap['users'] = new Date(0).toISOString();
        sinceMap['debts'] = new Date(0).toISOString();
        
        // Pull en parallèle limité (légers d'abord)
        const lightEntities = ['users', 'rates', 'debts'];
        const heavyEntities = ['products'];
        
        const lightResults = await sheetsClient.pullMany(lightEntities, sinceMap, { 
          maxRetries: 1 
        });
        
        // Appliquer immédiatement les résultats légers
        for (const r of lightResults) {
          if (r.success && r.data && r.data.length > 0) {
            try {
              await this.applyUpdates(r.entity, r.data);
              const maxUpdated = r.data.reduce((max, item) => {
                const itemDate = item._remote_updated_at || item.last_update || item.created_at || item.sold_at;
                if (itemDate) {
                  const d = new Date(itemDate);
                  return !max || d > max ? d : max;
                }
                return max;
              }, null);
              syncRepo.setLastPullDate(r.entity, maxUpdated ? maxUpdated.toISOString() : new Date().toISOString());
              results.push({ entity: r.entity, success: true, data: r.data });
            } catch (applyError) {
              results.push({ entity: r.entity, success: false, data: [], error: applyError.message });
            }
          } else if (r.success) {
            syncRepo.setLastPullDate(r.entity, new Date().toISOString());
            results.push({ entity: r.entity, success: true, data: [] });
          } else {
            results.push({ entity: r.entity, success: false, data: [], error: r.error });
          }
        }
        
        // Puis les lourds en séquentiel
        for (const entity of heavyEntities) {
        const entityStartTime = Date.now();
        let attempt = 0;
        
        const getRetryDelay = (attemptNum) => Math.min(60_000, 1000 * Math.pow(2, attemptNum - 1));
        
        while (true) {
          attempt++;
          try {
            const lastSync = isInitialImport ? new Date(0) : syncRepo.getLastPullDate(entity);
            const sinceDate = lastSync ? (typeof lastSync === 'string' ? lastSync : lastSync.toISOString()) : new Date(0).toISOString();
            
            const envTimeout = parseInt(process.env.SYNC_TIMEOUT_MS || '30000', 10);
            const timeouts = {
              products: isInitialImport ? 60_000 : parseInt(process.env.SHEETS_TIMEOUT_PRODUCTS_MS || envTimeout.toString(), 10),
              sales: isInitialImport ? 60_000 : parseInt(process.env.SHEETS_TIMEOUT_SALES_MS || envTimeout.toString(), 10),
            };
            const timeout = timeouts[entity] || envTimeout;
            
            const result = await sheetsClient.pull(entity, sinceDate, {
              maxRetries: isInitialImport ? 2 : 1,
              retryDelay: 400,
              timeout: timeout
            });
            
            if (result.success) {
              if (result.data && result.data.length > 0) {
                // APPLIQUER IMMÉDIATEMENT
                try {
                  const upsertStats = await this.applyUpdates(entity, result.data);
                  syncRepo.setLastPullDate(entity, new Date().toISOString());
                  
                  if (entity === 'products' && isInitialImport && !syncRepo.isInitialImportDone()) {
                    syncRepo.setInitialImportDone();
                  }
                  
                  // Log résumé uniquement si données
                  if (upsertStats && (upsertStats.inserted > 0 || upsertStats.updated > 0)) {
                    syncLogger.info(`📥 [${entity.toUpperCase()}] ↓${result.data.length} (${upsertStats.inserted || 0}+/${upsertStats.updated || 0}~)`);
                  }
                } catch (applyError) {
                  syncLogger.error(`[${entity.toUpperCase()}] Apply: ${applyError.message}`);
                }
                
                results.push({ entity, success: true, data: result.data });
                break;
              } else {
                // 0 items - pas de log verbeux
                if (isInitialImport) {
                  syncRepo.setLastPullDate(entity, new Date().toISOString());
                }
                
                results.push({ entity, success: true, data: [] });
                break;
              }
            } else {
              // Erreur dans la réponse - retry avec backoff si initial
              if (isInitialImport) {
                const delay = getRetryDelay(attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              } else {
                results.push({ entity, success: false, data: [], error: result.error });
                break;
              }
            }
          } catch (error) {
            const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
            
            if (isInitialImport) {
              const delay = getRetryDelay(attempt);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            } else {
              if (isTimeout || attempt >= 2) {
                results.push({ entity, success: false, data: [], error: error.message });
                break;
              }
              const delay = getRetryDelay(attempt);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
        }
        
          // Délai entre chaque entité pour ne pas surcharger Apps Script (réduit pour rapidité)
          if (entity !== heavyEntities[heavyEntities.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms de pause
          }
        }
      }
      
      // Résumé final simplifié
      const totalItems = results.reduce((sum, r) => sum + (r.data?.length || 0), 0);
      const successCount = results.filter(r => r.success).length;
      const totalDuration = Date.now() - globalStartTime;
      
      if (totalItems > 0) {
        syncLogger.info(`✅ [SYNC] ${totalItems} items (${(totalDuration / 1000).toFixed(1)}s)`);
      }
      
    } catch (error) {
      syncLogger.error('❌ Erreur pullUpdates:', error);
      // Marquer comme hors ligne si erreur réseau
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.message?.includes('network') || error.message?.includes('timeout')) {
        isOnline = false;
      }
    }
  }

  /**
   * Applique les mises à jour récupérées depuis Sheets
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applyUpdates(entity, data) {
    try {
      // Validation des données
      if (!data || !Array.isArray(data) || data.length === 0) {
        return { inserted: 0, updated: 0, skipped: 0 };
      }
      
      let stats = { inserted: 0, updated: 0, skipped: 0 };
      
      switch (entity) {
        case 'products':
        case 'product_units':
          stats = await this.applyProductUpdates(data);
          break;
        case 'sales':
          stats = await this.applySalesUpdates(data);
          break;
        case 'debts':
          stats = await this.applyDebtsUpdates(data);
          break;
        case 'rates':
          await this.applyRatesUpdates(data);
          stats = { inserted: 0, updated: data.length, skipped: 0 };
          break;
        case 'users':
          await this.applyUsersUpdates(data);
          stats = { inserted: 0, updated: data.length, skipped: 0 };
          break;
        default:
          stats = { inserted: 0, updated: 0, skipped: 0 };
      }
      
      return stats;
    } catch (error) {
      syncLogger.error(`❌ [APPLY-UPDATES] ERREUR ${entity}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Applique les mises à jour de produits
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applyProductUpdates(data) {
    if (!data || data.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }

    // Grouper les produits par code
    const productsByCode = {};
    let itemsSkipped = 0;
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      // Normaliser le code : trim et convertir en string
      let code = item.code;
      if (code) {
        code = String(code).trim();
      }
      
      if (!code || code === '' || code === 'undefined' || code === 'null') {
        itemsSkipped++;
        continue;
      }
      
      // Si l'item a une propriété 'units', c'est un produit avec ses unités (format de getProductsSince pour 'products')
      if (item.units && Array.isArray(item.units)) {
        // Format: { code, name, uuid, units: [...] }
        if (!productsByCode[code]) {
          productsByCode[code] = {
            code: code,
            name: item.name || '',
            uuid: item.uuid,
            units: []
          };
        }
        
        // Ajouter toutes les unités du produit
        // IMPORTANT: Ignorer sale_price_fc venant de Sheets, utiliser seulement sale_price_usd
        for (const unit of item.units) {
          productsByCode[code].units.push({
            uuid: unit.uuid,
            unit_level: unit.unit_level || 'PIECE',
            unit_mark: unit.unit_mark || '',
            stock_initial: unit.stock_initial || unit.stock_current || 0,
            stock_current: unit.stock_current || unit.stock_initial || 0,
            purchase_price_usd: unit.purchase_price_usd || 0,
            // sale_price_fc sera calculé automatiquement depuis sale_price_usd dans products.repo.js
            sale_price_usd: unit.sale_price_usd || 0,
            auto_stock_factor: unit.auto_stock_factor || 1,
            qty_step: unit.qty_step || 1,
            last_update: unit.last_update || new Date().toISOString()
          });
        }
      } else if (item.unit_level) {
        // Format: unité individuelle (format de getProductsPage/getProductsSince pour 'product_units')
        if (!productsByCode[code]) {
          productsByCode[code] = {
            code: code,
            name: item.name || '',
            uuid: item.uuid,
            units: []
          };
        }
        
        productsByCode[code].units.push({
          uuid: item.uuid,
          unit_level: item.unit_level || 'PIECE',
          unit_mark: item.unit_mark || '',
          stock_initial: item.stock_initial || item.stock_current || 0,
          stock_current: item.stock_current || item.stock_initial || 0,
          purchase_price_usd: item.purchase_price_usd || 0,
          // sale_price_fc sera calculé automatiquement depuis sale_price_usd dans products.repo.js
          sale_price_usd: item.sale_price_usd || 0,
          auto_stock_factor: item.auto_stock_factor || 1,
          qty_step: item.qty_step || 1,
          last_update: item.last_update || new Date().toISOString()
        });
      } else {
        // Item sans unit_level - on l'ajoute quand même avec PIECE par défaut
        if (!productsByCode[code]) {
          productsByCode[code] = {
            code: code,
            name: item.name || '',
            uuid: item.uuid,
            units: []
          };
        }
        
        productsByCode[code].units.push({
          uuid: item.uuid,
          unit_level: 'PIECE',
          unit_mark: item.unit_mark || '',
          stock_initial: item.stock_initial || item.stock_current || 0,
          stock_current: item.stock_current || item.stock_initial || 0,
          purchase_price_usd: item.purchase_price_usd || 0,
          // sale_price_fc sera calculé automatiquement depuis sale_price_usd dans products.repo.js
          sale_price_usd: item.sale_price_usd || 0,
          auto_stock_factor: item.auto_stock_factor || 1,
          qty_step: item.qty_step || 1,
          last_update: item.last_update || new Date().toISOString()
        });
      }
    }
    
    // Insérer ou mettre à jour chaque produit
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedPendingCount = 0;
    let errorCount = 0;
    
    for (const code in productsByCode) {
      try {
        const product = productsByCode[code];
        
        // Vérifier si le produit existe déjà
        const existing = productsRepo.findByCode(code);
        const isNew = !existing;
        
        // 🆔 AUTO-GÉNÉRER UUID SI MANQUANT (même pour les anciens produits)
        let productUuid = product.uuid;
        if (!productUuid || productUuid.trim() === '') {
          productUuid = generateUUID();
        } else if (existing && !existing.uuid) {
          // Si le produit existe localement mais sans UUID, le lui attribuer
          productUuid = existing.uuid || product.uuid;
          if (!productUuid || productUuid.trim() === '') {
            productUuid = generateUUID();
          }
        }
        
        // ✅ PRO SIMPLIFIÉ: Sheets = source de vérité
        // Seulement bloquer si opérations RÉCENTES (< 5 min)
        const hasRecentPending = outboxRepo.hasProductPending(code, 5); // 5 minutes max
        
        if (hasRecentPending && !isNew) {
          // Le produit existe et a des modifications RÉCENTES en pending
          skippedPendingCount++;
          syncLogger.verbose(`⏭️ [SKIP] ${code}: modifications récentes en pending`);
          continue;
        }
        
        // ✅ PRO: Marquer tous les anciens stock_moves comme synced pour ce produit
        // Cela permet de débloquer le produit pour les mises à jour Sheets
        if (!isNew) {
          outboxRepo.markAllStockMovesAsSynced(code);
        }
        
        // ✅ PRO SIMPLIFIÉ: Toujours utiliser les données de Sheets (pas de pending récent)
        const unitsToUpsert = [];
        for (const unit of product.units) {
          // Vérifier seulement les mouvements RÉCENTS (< 5 min)
          const hasRecentStockPending = outboxRepo.hasStockMovePending(code, unit.unit_level, unit.unit_mark, 5);
          
          if (hasRecentStockPending && !isNew) {
            // Mouvements RÉCENTS: préserver le stock local + appliquer delta
            const existingUnit = existing?.units?.find(
              u => u.unit_level === unit.unit_level && u.unit_mark === unit.unit_mark
            );
            
            if (existingUnit) {
              const pendingDelta = outboxRepo.getPendingStockDelta(code, unit.unit_level, unit.unit_mark);
              const correctedStock = (unit.stock_current || 0) + pendingDelta;
              
              syncLogger.verbose(`🔄 [RECENT-PENDING] ${code}/${unit.unit_level}: sheets=${unit.stock_current}, delta=${pendingDelta}, final=${correctedStock}`);
              
              unitsToUpsert.push({
                ...unit,
                stock_current: correctedStock,
                stock_initial: correctedStock
              });
            } else {
              unitsToUpsert.push(unit);
            }
          } else {
            // ✅ PAS DE PENDING RÉCENT: Écraser avec les données de Sheets
            const existingUnit = existing?.units?.find(
              u => u.unit_level === unit.unit_level && (u.unit_mark || '') === (unit.unit_mark || '')
            );
            
            if (existingUnit && !isNew) {
              const localStock = existingUnit.stock_current || 0;
              const sheetsStock = unit.stock_current || unit.stock_initial || 0;
              
              if (Math.abs(localStock - sheetsStock) > 0.01) {
                syncLogger.info(`📥 [SHEETS→LOCAL] ${code}/${unit.unit_level}: ${localStock} → ${sheetsStock}`);
              }
            }
            
            // Utiliser les données de Sheets telles quelles
            unitsToUpsert.push(unit);
          }
        }
        
        productsRepo.upsert({
          ...product,
          uuid: productUuid,
          units: unitsToUpsert,
          is_active: 1,
          _origin: 'SHEETS'
        });
        
        if (isNew) {
          insertedCount++;
        } else {
          updatedCount++;
        }
      } catch (error) {
        errorCount++;
        syncLogger.error(`❌ Erreur upsert produit ${code}: ${error.message}`);
      }
    }
    
    // Émettre un event pour rafraîchir l'UI si des produits ont été modifiés
    if (insertedCount + updatedCount > 0) {
      try {
        const { getSocketIO } = await import('../../api/socket.js');
        const io = getSocketIO();
        if (io) {
          io.emit('products:updated', {
            ts: new Date().toISOString(),
            count: insertedCount + updatedCount,
            inserted: insertedCount,
            updated: updatedCount,
            source: 'SHEETS'
          });
        }
      } catch (ioError) {
        // Ne pas bloquer la sync si problème Socket.IO
      }
    }
    
    return { inserted: insertedCount, updated: updatedCount, skipped: skippedPendingCount };
  }

  /**
   * Applique les mises à jour de ventes
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applySalesUpdates(data) {
    if (!data || data.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    
    // Grouper les lignes par facture (une facture peut avoir plusieurs lignes)
    const salesByInvoice = {};
    let skippedLinesCount = 0;
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const invoiceNumber = item.invoice_number;
      
      if (!invoiceNumber || invoiceNumber.toString().trim() === '') {
        skippedLinesCount++;
        continue;
      }
      
      if (!salesByInvoice[invoiceNumber]) {
        salesByInvoice[invoiceNumber] = {
          uuid: null, // UUID de la vente (sera récupéré depuis la première ligne ou généré)
          invoice_number: invoiceNumber,
          sold_at: item.sold_at,
          client_name: item.client_name || '',
          client_phone: item.client_phone || '',
          seller_name: item.seller_name || '',
          items: []
        };
      }
      
      // Utiliser le UUID de la première ligne si disponible (pour la vente elle-même)
      if (!salesByInvoice[invoiceNumber].uuid && item._sale_uuid) {
        salesByInvoice[invoiceNumber].uuid = item._sale_uuid;
      }
      
      // Trouver le product_id depuis le code produit
      let product = null;
      let productName = item.product_name || '';
      if (item.product_code) {
        product = productsRepo.findByCode(item.product_code);
        if (product && !productName) {
          productName = product.name || '';
        }
      }
      
      // Normaliser l'unité depuis Sheets
      let unitLevel = null;
      let unitLevelFromSheets = null;
      
      const rawUnit = item.unit_level ? String(item.unit_level).trim() : '';
      
      if (rawUnit) {
        unitLevelFromSheets = normalizeUnitFromSheets(rawUnit);
        
        if (!unitLevelFromSheets) {
          const upperValue = rawUnit.toUpperCase();
          if (upperValue === 'MILLIER' || upperValue === 'CARTON' || upperValue === 'PIECE' || upperValue === 'MILLIERS') {
            unitLevelFromSheets = upperValue === 'MILLIERS' ? 'MILLIER' : upperValue;
          }
        }
      }
      
      // Utiliser l'unité de Sheets si elle est valide
      if (unitLevelFromSheets) {
        unitLevel = unitLevelFromSheets;
      }
      
      let unitMark = item.unit_mark || '';
      
      // Si unitLevel n'est pas spécifié dans Sheets, chercher dans le produit
      if (!unitLevel && product?.id && product.units && product.units.length > 0) {
        const foundUnit = product.units[0];
        unitLevel = foundUnit.unit_level;
        unitMark = foundUnit.unit_mark || '';
      } else if (unitLevel && product?.id && product.units && product.units.length > 0) {
        let foundUnit = product.units.find(
          u => u.unit_level === unitLevel && u.unit_mark === unitMark
        );
        
        if (!foundUnit) {
          foundUnit = product.units.find(u => u.unit_level === unitLevel);
          if (foundUnit && !unitMark) {
            unitMark = foundUnit.unit_mark || '';
          }
        } else {
          unitMark = foundUnit.unit_mark || unitMark;
        }
      }
      
      // Fallback final
      if (!unitLevel) {
        unitLevel = 'PIECE';
      }
      
      // Préserver l'unité de Sheets si elle existe
      if (unitLevelFromSheets && unitLevel !== unitLevelFromSheets) {
        unitLevel = unitLevelFromSheets;
      }
      
      // Calculer subtotal si non fourni
      const qty = item.qty || 0;
      const unitPriceFC = item.unit_price_fc || 0;
      const unitPriceUSD = item.unit_price_usd || 0;
      const subtotalFC = item.subtotal_fc !== undefined ? item.subtotal_fc : (qty * unitPriceFC);
      const subtotalUSD = item.subtotal_usd !== undefined ? item.subtotal_usd : (qty * unitPriceUSD);
      
      // Ignorer si produit non trouvé
      if (!product?.id) {
        skippedLinesCount++;
        continue;
      }
      
      salesByInvoice[invoiceNumber].items.push({
        uuid: item.uuid || null,
        product_id: product.id,
        product_code: item.product_code || '',
        product_name: productName,
        unit_level: unitLevel,
        unit_mark: unitMark,
        qty: qty,
        qty_label: item.qty_label || (qty ? qty.toString() : '0'),
        unit_price_fc: unitPriceFC,
        subtotal_fc: subtotalFC,
        unit_price_usd: unitPriceUSD,
        subtotal_usd: subtotalUSD
      });
      
      // Mettre à jour les métadonnées de la vente
      if (item.client_name) salesByInvoice[invoiceNumber].client_name = item.client_name;
      if (item.client_phone) salesByInvoice[invoiceNumber].client_phone = item.client_phone;
      if (item.seller_name) salesByInvoice[invoiceNumber].seller_name = item.seller_name;
      if (item.sold_at) salesByInvoice[invoiceNumber].sold_at = item.sold_at;
    }
    
    const uniqueInvoicesCount = Object.keys(salesByInvoice).length;
    
    let insertedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    
    // Traiter chaque facture
    for (const invoiceNumber in salesByInvoice) {
      try {
        const saleData = salesByInvoice[invoiceNumber];
        
        // Calculer les totaux de la facture
        let totalFC = 0;
        let totalUSD = 0;
        for (const item of saleData.items) {
          totalFC += item.subtotal_fc || 0;
          totalUSD += item.subtotal_usd || 0;
        }
        
        // Vérifier si la vente existe déjà dans SQLite
        const existing = salesRepo.findByInvoice(invoiceNumber);
        const isNew = !existing;
        
        // Générer UUID pour la vente si non fourni
        if (!saleData.uuid) {
          saleData.uuid = existing?.uuid || generateUUID();
        }
        
        // Validation des données avant upsert
        if (!saleData.sold_at) {
          saleData.sold_at = new Date().toISOString();
        }
        
        try {
          const savedSale = salesRepo.upsert({
            uuid: saleData.uuid,
            invoice_number: invoiceNumber,
            sold_at: saleData.sold_at,
            client_name: saleData.client_name,
            client_phone: saleData.client_phone,
            seller_name: saleData.seller_name,
            total_fc: totalFC,
            total_usd: totalUSD,
            payment_mode: 'cash',
            status: 'paid',
            origin: 'SHEETS',
            rate_fc_per_usd: 2800,
            items: saleData.items
          });
          
          if (savedSale && savedSale.id) {
            if (isNew) {
              insertedCount++;
            } else {
              updatedCount++;
            }
          }
        } catch (error) {
          syncLogger.error(`❌ Erreur upsert facture ${invoiceNumber}: ${error.message}`);
          throw error;
        }
      } catch (error) {
        errorCount++;
      }
    }
    
    return { inserted: insertedCount, updated: updatedCount, skipped: 0 };
  }
  
  /**
   * Vérifie que les ventes sont bien synchronisées depuis Sheets vers SQLite
   */
  async verifySalesSync() {
    try {
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      
      // 1. Compter les ventes dans SQLite
      const allSalesInDb = salesRepo.findAll({});
      const salesFromSheets = allSalesInDb.filter(s => s.origin === 'SHEETS');
      const totalSalesInDb = allSalesInDb.length;
      
      // 2. Compter les items dans SQLite
      const itemsCountResult = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
      const totalItemsInDb = itemsCountResult?.count || 0;
      
      return {
        totalSales: totalSalesInDb,
        salesFromSheets: salesFromSheets.length,
        totalItems: totalItemsInDb
      };
    } catch (error) {
      syncLogger.error(`❌ [VERIFY-SALES] Erreur: ${error.message}`);
      return { totalSales: 0, salesFromSheets: 0, totalItems: 0 };
    }
  }

  /**
   * Applique les mises à jour de dettes
   */
  async applyDebtsUpdates(data) {
    if (!data || data.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      
      try {
        if (!item.invoice_number) {
          skippedCount++;
          continue;
        }
        
        const existing = debtsRepo.findByInvoice(item.invoice_number);
        const isNew = !existing;
        
        const debtUuid = item.uuid || undefined;
        
        const debtData = {
          uuid: debtUuid,
          invoice_number: item.invoice_number,
          client_name: item.client_name || '',
          client_phone: item.client_phone || null,
          product_description: item.product_description || null,
          total_fc: item.total_fc || 0,
          paid_fc: item.paid_fc || 0,
          remaining_fc: item.remaining_fc !== undefined ? item.remaining_fc : (item.total_fc || 0) - (item.paid_fc || 0),
          total_usd: item.total_usd || 0,
          debt_fc_in_usd: item.debt_fc_in_usd || null,
          note: item.note || null,
          status: item.status || 'open',
          created_at: item.created_at || new Date().toISOString()
        };
        
        debtsRepo.upsert(debtData);
        
        if (isNew) {
          insertedCount++;
        } else {
          updatedCount++;
        }
      } catch (error) {
        errorCount++;
        syncLogger.error(`❌ Erreur dette ${item.invoice_number}: ${error.message}`);
      }
    }
    
    return { inserted: insertedCount, updated: updatedCount, skipped: skippedCount };
  }

  /**
   * Applique les mises à jour de taux
   */
  async applyRatesUpdates(data) {
    if (data.length > 0) {
      const latestRate = data[data.length - 1];
      try {
        ratesRepo.updateCurrent(latestRate.rate_fc_per_usd, null);
      } catch (error) {
        syncLogger.error(`❌ Erreur taux: ${error.message}`);
      }
    }
  }

  /**
   * Applique les mises à jour d'utilisateurs (basé sur UUID)
   */
  async applyUsersUpdates(data) {
    if (!data || data.length === 0) {
      return;
    }
    
    // Construire index local pour matching rapide
    const localUsers = usersRepo.findAll();
    const byUuid = new Map();
    const byUsername = new Map();
    
    for (const user of localUsers) {
      if (user.uuid) {
        byUuid.set(user.uuid.trim(), user);
      }
      if (user.username) {
        const normalized = usersRepo.normalizeUsername(user.username);
        byUsername.set(normalized, user);
      }
    }
    
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let repaired = 0; // UUID réparés

    for (let i = 0; i < data.length; i++) {
      const userData = data[i];
      try {
        const username = userData.username || userData.nom || '';
        if (!username || username.trim() === '') {
          syncLogger.warn(`   ⚠️  [USERS] Utilisateur #${i + 1} ignoré: nom vide`);
          skipped++;
          continue;
        }

        // Extraire UUID (peut être dans uuid ou _uuid)
        const remoteUuid = (userData.uuid || userData._uuid || '').trim();
        
        // A) Si UUID existe → UPSERT par UUID
        if (remoteUuid) {
          
          const existing = byUuid.get(remoteUuid);
          
          if (existing) {
            
            const updateData = {
              phone: userData.phone || userData.numero || existing.phone,
              is_active: userData.is_active !== undefined ? (userData.is_active ? 1 : 0) : existing.is_active,
              is_admin: userData.is_admin !== undefined ? (userData.is_admin ? 1 : 0) : existing.is_admin,
              is_vendeur: userData.is_vendeur !== undefined ? (userData.is_vendeur ? 1 : 0) : (existing.is_vendeur !== undefined ? existing.is_vendeur : 1),
              is_gerant_stock: userData.is_gerant_stock !== undefined ? (userData.is_gerant_stock ? 1 : 0) : (existing.is_gerant_stock || 0),
              can_manage_products: userData.can_manage_products !== undefined ? (userData.can_manage_products ? 1 : 0) : (existing.can_manage_products || 0),
              // PRÉSERVER les URLs existantes : ne pas écraser si vide depuis Sheets
              device_brand: userData.device_brand || existing.device_brand || '',
              profile_url: userData.profile_url || existing.profile_url || '',
              expo_push_token: userData.expo_push_token || existing.expo_push_token || '',
            };
            
            // Mise à jour du mot de passe depuis Sheets si présent
            
            if (userData.password && userData.password.trim() !== '') {
              updateData.password = userData.password;
            } else {
              // Si pas de mot de passe dans Sheets, vérifier si l'utilisateur existe sans password_hash
              const db = getDb();
              const userWithHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existing.id);
              
              if (!userWithHash || !userWithHash.password_hash || userWithHash.password_hash.trim() === '') {
                // Utiliser le mot de passe par défaut si l'utilisateur n'a pas de password_hash
                updateData.password = 'changeme123';
              }
            }
            
            const updatedUser = await usersRepo.update(existing.id, updateData);
            
            // Vérifier que le password_hash a bien été mis à jour
            const db2 = getDb();
            const verifyHash = db2.prepare('SELECT password_hash FROM users WHERE id = ?').get(existing.id);
            
            updated++;
          } else {
            // UUID existe mais utilisateur non trouvé par UUID → vérifier par username
            const normalized = usersRepo.normalizeUsername(username);
            const existingByUsername = byUsername.get(normalized);
            
            if (existingByUsername) {
              // Utilisateur existe par username mais UUID différent → UPDATE avec réparation UUID
              
              // Réparer UUID : assigner le UUID de Sheets à l'utilisateur local
              usersRepo.setUuid(existingByUsername.id, remoteUuid);
              existingByUsername.uuid = remoteUuid;
              byUuid.set(remoteUuid, existingByUsername);
              repaired++;
              
              // Mettre à jour avec les données de Sheets
              const updateData = {
                phone: userData.phone || userData.numero || existingByUsername.phone,
                is_active: userData.is_active !== undefined ? (userData.is_active ? 1 : 0) : existingByUsername.is_active,
                is_admin: userData.is_admin !== undefined ? (userData.is_admin ? 1 : 0) : existingByUsername.is_admin,
                is_vendeur: userData.is_vendeur !== undefined ? (userData.is_vendeur ? 1 : 0) : (existingByUsername.is_vendeur !== undefined ? existingByUsername.is_vendeur : 1),
                is_gerant_stock: userData.is_gerant_stock !== undefined ? (userData.is_gerant_stock ? 1 : 0) : (existingByUsername.is_gerant_stock || 0),
                can_manage_products: userData.can_manage_products !== undefined ? (userData.can_manage_products ? 1 : 0) : (existingByUsername.can_manage_products || 0),
                device_brand: userData.device_brand || existingByUsername.device_brand || '',
                profile_url: userData.profile_url || existingByUsername.profile_url || '',
                expo_push_token: userData.expo_push_token || existingByUsername.expo_push_token || '',
              };
              
              // Mise à jour du mot de passe depuis Sheets
              if (userData.password && userData.password.trim() !== '') {
                updateData.password = userData.password;
              } else {
                // Si pas de mot de passe dans Sheets mais utilisateur existe sans password_hash, utiliser défaut
                const db = getDb();
                const userWithHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existingByUsername.id);
                if (!userWithHash || !userWithHash.password_hash || userWithHash.password_hash.trim() === '') {
                  updateData.password = 'changeme123';
                }
              }
              
              await usersRepo.update(existingByUsername.id, updateData);
              updated++;
            } else {
              // Vraiment nouveau : créer
              const createData = {
                uuid: remoteUuid,
                username: username.trim(),
                password: userData.password || 'changeme123', // Utiliser le mot de passe depuis Sheets
                phone: userData.phone || userData.numero || '',
                is_active: userData.is_active !== undefined ? (userData.is_active ? 1 : 0) : 1,
                is_admin: userData.is_admin !== undefined ? (userData.is_admin ? 1 : 0) : 0,
                is_vendeur: userData.is_vendeur !== undefined ? (userData.is_vendeur ? 1 : 0) : 1,
                is_gerant_stock: userData.is_gerant_stock !== undefined ? (userData.is_gerant_stock ? 1 : 0) : 0,
                can_manage_products: userData.can_manage_products !== undefined ? (userData.can_manage_products ? 1 : 0) : 0,
                created_at: userData.created_at || new Date().toISOString(),
                device_brand: userData.device_brand || '',
                profile_url: userData.profile_url || '',
                expo_push_token: userData.expo_push_token || '',
              };
              
              try {
                const newUser = await usersRepo.create(createData);
                byUuid.set(remoteUuid, newUser);
                byUsername.set(usersRepo.normalizeUsername(username), newUser);
                inserted++;
              } catch (createError) {
                // Fallback : si erreur UNIQUE sur username, essayer update
                if (createError?.code === 'SQLITE_CONSTRAINT_UNIQUE' && String(createError.message || '').includes('users.username')) {
                  const existingByUsernameFallback = usersRepo.findByUsername(username.trim());
                  if (existingByUsernameFallback) {
                    // Réparer UUID et mettre à jour
                    usersRepo.setUuid(existingByUsernameFallback.id, remoteUuid);
                    const updateDataFallback = {
                      phone: userData.phone || userData.numero || existingByUsernameFallback.phone,
                      is_active: userData.is_active !== undefined ? (userData.is_active ? 1 : 0) : existingByUsernameFallback.is_active,
                      is_admin: userData.is_admin !== undefined ? (userData.is_admin ? 1 : 0) : existingByUsernameFallback.is_admin,
                      is_vendeur: userData.is_vendeur !== undefined ? (userData.is_vendeur ? 1 : 0) : (existingByUsernameFallback.is_vendeur !== undefined ? existingByUsernameFallback.is_vendeur : 1),
                      is_gerant_stock: userData.is_gerant_stock !== undefined ? (userData.is_gerant_stock ? 1 : 0) : (existingByUsernameFallback.is_gerant_stock || 0),
                      can_manage_products: userData.can_manage_products !== undefined ? (userData.can_manage_products ? 1 : 0) : (existingByUsernameFallback.can_manage_products || 0),
                      device_brand: userData.device_brand || existingByUsernameFallback.device_brand || '',
                      profile_url: userData.profile_url || existingByUsernameFallback.profile_url || '',
                      expo_push_token: userData.expo_push_token || existingByUsernameFallback.expo_push_token || '',
                    };
                    
                    // Mise à jour du mot de passe depuis Sheets
                    if (userData.password && userData.password.trim() !== '') {
                      updateDataFallback.password = userData.password;
                    } else {
                      // Si pas de mot de passe dans Sheets mais utilisateur existe sans password_hash, utiliser défaut
                      const db = getDb();
                      const userWithHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existingByUsernameFallback.id);
                      if (!userWithHash || !userWithHash.password_hash || userWithHash.password_hash.trim() === '') {
                        updateDataFallback.password = 'changeme123';
                      }
                    }
                    
                    await usersRepo.update(existingByUsernameFallback.id, updateDataFallback);
                    updated++;
                    repaired++;
                  } else {
                    throw createError; // Re-throw si on ne peut pas résoudre
                  }
                } else {
                  throw createError; // Re-throw les autres erreurs
                }
              }
            }
          }
          continue;
        }
        
        // B) Si UUID vide → chercher par username normalisé
        const normalized = usersRepo.normalizeUsername(username);
        const existing = byUsername.get(normalized);
        
        if (existing) {
          
          // Réparer : assigner UUID local si absent, puis mettre à jour
          let userUuid = existing.uuid;
          if (!userUuid || userUuid.trim() === '') {
            userUuid = generateUUID();
            usersRepo.setUuid(existing.id, userUuid);
            existing.uuid = userUuid;
            byUuid.set(userUuid, existing);
            repaired++;
            
            // Pousser vers Sheets pour backfill UUID - PRO et TOP
            syncRepo.addToOutbox('users', existing.id.toString(), 'upsert', {
              uuid: userUuid,
              username: existing.username,
              phone: existing.phone || '',
              is_admin: existing.is_admin,
              is_active: existing.is_active,
              is_vendeur: existing.is_vendeur !== undefined ? existing.is_vendeur : 1,
              is_gerant_stock: existing.is_gerant_stock || 0,
              can_manage_products: existing.can_manage_products || 0,
            });
          }
          
          // Mettre à jour (PRÉSERVER les URLs existantes)
          const updateData = {
            phone: userData.phone || userData.numero || existing.phone,
            is_active: userData.is_active !== undefined ? (userData.is_active ? 1 : 0) : existing.is_active,
            is_admin: userData.is_admin !== undefined ? (userData.is_admin ? 1 : 0) : existing.is_admin,
            is_vendeur: userData.is_vendeur !== undefined ? (userData.is_vendeur ? 1 : 0) : (existing.is_vendeur !== undefined ? existing.is_vendeur : 1),
            is_gerant_stock: userData.is_gerant_stock !== undefined ? (userData.is_gerant_stock ? 1 : 0) : (existing.is_gerant_stock || 0),
            can_manage_products: userData.can_manage_products !== undefined ? (userData.can_manage_products ? 1 : 0) : (existing.can_manage_products || 0),
            // PRÉSERVER : ne pas écraser si vide depuis Sheets
            device_brand: userData.device_brand || existing.device_brand || '',
            profile_url: userData.profile_url || existing.profile_url || '',
            expo_push_token: userData.expo_push_token || existing.expo_push_token || '',
          };
          
          // Mise à jour du mot de passe depuis Sheets
          if (userData.password && userData.password.trim() !== '') {
            updateData.password = userData.password;
          } else {
            // Si pas de mot de passe dans Sheets mais utilisateur existe sans password_hash, utiliser défaut
            const db = getDb();
            const userWithHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existing.id);
            if (!userWithHash || !userWithHash.password_hash || userWithHash.password_hash.trim() === '') {
              updateData.password = 'changeme123';
            }
          }
          
          await usersRepo.update(existing.id, updateData);
          updated++;
        } else {
          // C) Nouvel utilisateur sans UUID
          const newUuid = generateUUID();
          const createData = {
            uuid: newUuid,
            username: username.trim(),
            password: userData.password || 'changeme123', // Utiliser le mot de passe depuis Sheets
            phone: userData.phone || userData.numero || '',
            is_active: userData.is_active !== undefined ? (userData.is_active ? 1 : 0) : 1,
            is_admin: userData.is_admin !== undefined ? (userData.is_admin ? 1 : 0) : 0,
            is_vendeur: userData.is_vendeur !== undefined ? (userData.is_vendeur ? 1 : 0) : 1,
            is_gerant_stock: userData.is_gerant_stock !== undefined ? (userData.is_gerant_stock ? 1 : 0) : 0,
            can_manage_products: userData.can_manage_products !== undefined ? (userData.can_manage_products ? 1 : 0) : 0,
            created_at: userData.created_at || new Date().toISOString(),
            // PRÉSERVER les URLs : utiliser telles quelles depuis Sheets
            device_brand: userData.device_brand || '',
            profile_url: userData.profile_url || '', // Ne pas modifier l'URL
            expo_push_token: userData.expo_push_token || '',
          };
          
          const newUser = await usersRepo.create(createData);
          byUuid.set(newUuid, newUser);
          byUsername.set(normalized, newUser);
          inserted++;
          
          // Pousser vers Sheets pour backfill UUID - PRO et TOP
          syncRepo.addToOutbox('users', newUser.id.toString(), 'upsert', {
            uuid: newUuid,
            username: newUser.username,
            phone: newUser.phone || '',
            is_admin: newUser.is_admin,
            is_active: newUser.is_active,
            is_vendeur: newUser.is_vendeur !== undefined ? newUser.is_vendeur : 1,
            is_gerant_stock: newUser.is_gerant_stock || 0,
            can_manage_products: newUser.can_manage_products || 0,
          });
        }
      } catch (error) {
        // Logger les erreurs proprement (éviter les objets caractère par caractère)
        const username = userData.username || userData.nom || 'Inconnu';
        const errorDetails = {
          username: username,
          message: String(error?.message || error || 'Erreur inconnue'),
          code: error?.code || 'UNKNOWN'
        };
        syncLogger.error(`   ❌ [USERS] Erreur traitement utilisateur #${i + 1} (${username}):`, errorDetails);
        if (error?.stack) {
          syncLogger.error(`   📋 Stack trace:`, String(error.stack).substring(0, 500));
        }
        skipped++;
      }
    }

    // Vérifier la validité de tous les utilisateurs connectés après sync
    await this.checkConnectedUsersValidity();
  }

  /**
   * Vérifie que tous les utilisateurs actuellement connectés sont toujours valides
   * Déconnecte automatiquement ceux qui sont devenus invalides
   */
  async checkConnectedUsersValidity() {
    try {
      
      // Obtenir l'instance Socket.IO pour notifier les clients
      const { getSocketIO } = await import('../../api/socket.js');
      const io = getSocketIO();
      
      if (!io) {
        syncLogger.warn(`   ⚠️ [USERS-VALIDITY] Socket.IO non disponible, impossible de notifier les clients`);
        return;
      }

      // Récupérer tous les utilisateurs de la base
      const allUsers = usersRepo.findAll();
      const invalidUsers = [];

      // Vérifier chaque utilisateur
      for (const user of allUsers) {
        // Si l'utilisateur est inactif, notifier tous les clients connectés avec cet user_id
        if (!user.is_active || user.is_active === 0) {
          invalidUsers.push(user);
          io.emit('user:deactivated', {
            user_id: user.id,
            username: user.username,
            phone: user.phone,
            reason: 'Compte désactivé lors de la synchronisation'
          });
        }
      }
    } catch (error) {
      syncLogger.error(`   ❌ [USERS-VALIDITY] Erreur lors de la vérification de validité:`, error);
    }
  }

  /**
   * Force une synchronisation immédiate
   */
  async syncNow() {
    syncLogger.info('🔄 [SYNC NOW] Début synchronisation manuelle (syncNow)');
    try {
      await this.runSyncSafe();
      syncLogger.info('✅ [SYNC NOW] Synchronisation manuelle terminée avec succès');
    } catch (error) {
      syncLogger.error('❌ [SYNC NOW] Erreur synchronisation manuelle:', error);
      throw error;
    }
  }

  /**
   * Force l'état online = true et pousse les opérations pending
   * Utile après une perte de connexion détectée par erreur
   */
  async resetOnlineAndPush() {
    syncLogger.info('🌐 [RESET-ONLINE] Force connexion Internet active');
    isOnline = true;
    
    syncLogger.info('📤 [RESET-ONLINE] Début push des opérations pending...');
    try {
      await this.pushPendingOperations();
      syncLogger.info('✅ [RESET-ONLINE] Push terminé avec succès');
      return { success: true, message: 'Online status reset and push completed' };
    } catch (error) {
      syncLogger.error('❌ [RESET-ONLINE] Erreur lors du push:', error.message);
      throw error;
    }
  }
}

export const syncWorker = new SyncWorker();



