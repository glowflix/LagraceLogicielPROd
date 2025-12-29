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
   * Démarre le worker avec import initial intelligent
   */
  async start() {
    if (syncInterval) {
      return; // Déjà démarré
    }

    syncLogger.info(`🚀 Démarrage du worker de synchronisation (intervalle: ${SYNC_INTERVAL_MS}ms)`);
    syncLogger.info(`📡 URL Google Apps Script: ${process.env.GOOGLE_SHEETS_WEBAPP_URL ? '✅ Configurée' : '❌ Non configurée'}`);

    // Détection automatique de connexion (doit être fait en premier)
    this.setupConnectionDetection();

    // Vérifier si l'import initial a déjà été fait
    const initialImportDone = syncRepo.isInitialImportDone();
    const isDatabaseEmpty = !productsRepo.hasProducts();
    
    // BOOTSTRAP AUTOMATIQUE : Si table vide → full pull (même si flag = 1)
    if (isDatabaseEmpty) {
      syncLogger.warn('⚠️  [BOOTSTRAP] Base de données vide (0 produits) → Bootstrap automatique activé');
      syncLogger.info('   🔄 [BOOTSTRAP] Mode: Full pull (toutes les données) même si initial_import_done = 1');
      syncLogger.info('   📋 [BOOTSTRAP] Le système va télécharger TOUTES les données existantes dans Google Sheets');
      
      // Vérifier la connexion d'abord
      await this.checkConnection();
      
      // Si en ligne, faire le bootstrap immédiatement
      if (isOnline) {
        syncLogger.info('   🚀 [BOOTSTRAP] Démarrage du bootstrap (full pull)...');
        this.pullUpdates(true).catch(err => {
          syncLogger.error('❌ [BOOTSTRAP] Erreur lors du bootstrap:', err);
          syncLogger.warn('   ⚠️  [BOOTSTRAP] Bootstrap échoué, sera réessayé au prochain cycle si base toujours vide');
        });
      } else {
        syncLogger.info('⏳ [BOOTSTRAP] En attente de connexion Internet pour le bootstrap...');
      }
    } else if (!initialImportDone) {
      // Import initial classique (si flag = 0 mais base non vide, c'est suspect mais on continue)
      syncLogger.info('📥 [IMPORT] Flag initial_import_done = 0, mais base contient des données');
      syncLogger.info('   🔄 [IMPORT] Synchronisation incrémentale normale');
      if (isOnline) {
        await this.runSyncSafe();
      }
    } else {
      // Mode normal : base non vide + flag = 1
      syncLogger.info('📊 [SYNC] Mode normal : synchronisation incrémentale uniquement');
      if (isOnline) {
        await this.runSyncSafe();
      }
    }

    // Boucle "après fin" au lieu de setInterval (évite les overlaps)
    syncLogger.info(`⏰ [AUTO-SYNC] Synchronisation automatique configurée: toutes les ${SYNC_INTERVAL_MS / 1000} secondes (TEMPS RÉEL)`);
    syncLogger.info(`   🔄 [AUTO-SYNC] Mode: Détection Internet auto + Sync auto toutes les ${SYNC_INTERVAL_MS / 1000}s`);
    syncLogger.info(`   📊 [AUTO-SYNC] Les données seront stockées dans SQL et disponibles immédiatement dans les pages`);
    syncLogger.info(`   ⚡ [AUTO-SYNC] Mode PRO: Boucle "après fin" (pas de setInterval) pour éviter les overlaps`);
    
    _started = true;
    const loop = async () => {
      if (!_started) return;
      
      // Utiliser setImmediate pour différer la sync et ne pas bloquer l'event loop
      setImmediate(async () => {
        const t0 = Date.now();
        if (isOnline) {
          // Utiliser process.nextTick pour donner la priorité aux requêtes API
          process.nextTick(async () => {
            await this.runSyncSafe().catch(err => {
              syncLogger.error(`❌ [AUTO-SYNC] Erreur sync automatique: ${err.message}`);
            });
          });
        } else {
          syncLogger.debug(`⏸️  [AUTO-SYNC] Sync ignorée: pas de connexion Internet`);
        }
        
        const elapsed = Date.now() - t0;
        const wait = Math.max(2000, SYNC_INTERVAL_MS - elapsed); // min 2s (au lieu de 1s)
        
        if (_started) {
          _loopTimeout = setTimeout(loop, wait);
        }
      });
    };
    
    // Démarrer la boucle avec un délai initial pour ne pas bloquer le démarrage
    setTimeout(loop, 5000); // Attendre 5s avant la première sync
    
    // Démarrer la synchronisation dédiée des ventes (immédiate + toutes les 10 secondes)
    this.startSalesSyncLoop();
    
    // Démarrer la synchronisation des opérations pending (push vers Sheets)
    // IMPORTANT: Les modifications locales (prix, stock, etc.) sont pushées automatiquement
    this.startPushSyncLoop();
  }
  
  /**
   * Boucle de push des opérations pending vers Google Sheets
   * Gère automatiquement les modifications locales quand la connexion revient
   * 
   * Fonctionnalités:
   * - Push automatique des PRODUCT_PATCH (modifications prix/nom)
   * - Push automatique des UNIT_PATCH (modifications unités)
   * - Push automatique des STOCK_MOVE (mouvements de stock)
   * - Déduplication automatique (last-write-wins pour les patches)
   * - Idempotence via op_id (pas de doublons côté Sheets)
   */
  async startPushSyncLoop() {
    const PUSH_SYNC_INTERVAL_MS = 15000; // 15 secondes
    
    syncLogger.info(`📤 [PUSH-SYNC] Démarrage de la synchronisation des modifications locales`);
    syncLogger.info(`   ⚡ [PUSH-SYNC] Mode: AUTO-PUSH toutes les ${PUSH_SYNC_INTERVAL_MS / 1000} secondes`);
    syncLogger.info(`   📦 [PUSH-SYNC] Types: PRODUCT_PATCH, UNIT_PATCH, STOCK_MOVE`);
    syncLogger.info(`   🔄 [PUSH-SYNC] Idempotence via op_id (pas de doublons)`);
    
    const pushLoop = async () => {
      if (!_started) return;
      
      if (_pushSyncRunning) {
        syncLogger.debug(`⏭️ [PUSH-SYNC] Push déjà en cours, skip`);
        setTimeout(pushLoop, PUSH_SYNC_INTERVAL_MS);
        return;
      }
      
      if (!isOnline) {
        syncLogger.debug(`⏸️ [PUSH-SYNC] Pas de connexion Internet, opérations en attente`);
        // Afficher le nombre d'opérations en attente
        try {
          const stats = outboxRepo.getStats();
          if (stats.totalPending > 0) {
            syncLogger.info(`   📊 [PUSH-SYNC] ${stats.totalPending} opération(s) en attente de connexion`);
          }
        } catch (e) {}
        setTimeout(pushLoop, PUSH_SYNC_INTERVAL_MS);
        return;
      }
      
      _pushSyncRunning = true;
      const pushStartTime = Date.now();
      
      try {
        await this.pushPendingOperations();
      } catch (error) {
        syncLogger.error(`❌ [PUSH-SYNC] Erreur lors du push: ${error.message}`);
      } finally {
        _pushSyncRunning = false;
        const elapsed = Date.now() - pushStartTime;
        const wait = Math.max(5000, PUSH_SYNC_INTERVAL_MS - elapsed);
        
        if (_started) {
          setTimeout(pushLoop, wait);
        }
      }
    };
    
    // Démarrer après un délai initial (laisser le temps au pull de se faire d'abord)
    setTimeout(pushLoop, 10000);
  }
  
  /**
   * Push les opérations pending vers Google Sheets
   * Gère les patches produits, patches unités et mouvements de stock
   */
  async pushPendingOperations() {
    try {
      // Récupérer les statistiques
      const stats = outboxRepo.getStats();
      
      if (stats.totalPending === 0 && stats.stockMovesPending === 0) {
        syncLogger.debug(`📤 [PUSH-SYNC] Aucune opération pending`);
        return;
      }
      
      syncLogger.info(`📤 [PUSH-SYNC] ==========================================`);
      syncLogger.info(`📤 [PUSH-SYNC] PUSH DES MODIFICATIONS LOCALES`);
      syncLogger.info(`📤 [PUSH-SYNC] ==========================================`);
      syncLogger.info(`   📊 Pending: ${JSON.stringify(stats.pendingByType)}`);
      syncLogger.info(`   📊 Stock moves pending: ${stats.stockMovesPending}`);
      
      // 1. Push des patches produits (PRODUCT_PATCH)
      const productPatches = outboxRepo.getPendingOperations('PRODUCT_PATCH', 50);
      if (productPatches.length > 0) {
        syncLogger.info(`   📦 [PRODUCT_PATCH] ${productPatches.length} patch(es) à envoyer`);
        await this.pushProductPatches(productPatches);
      }
      
      // 2. Push des patches unités (UNIT_PATCH) - inclut les prix
      const unitPatches = outboxRepo.getPendingOperations('UNIT_PATCH', 50);
      if (unitPatches.length > 0) {
        syncLogger.info(`   💰 [UNIT_PATCH] ${unitPatches.length} patch(es) à envoyer (prix, etc.)`);
        await this.pushUnitPatches(unitPatches);
      }
      
      // 3. Push des mouvements de stock (STOCK_MOVE)
      const stockMoves = outboxRepo.getPendingOperations('STOCK_MOVE', 50);
      if (stockMoves.length > 0) {
        syncLogger.info(`   📊 [STOCK_MOVE] ${stockMoves.length} mouvement(s) à envoyer`);
        await this.pushStockMoves(stockMoves);
      }
      
      // Réessayer les opérations en erreur (max 3 tentatives)
      outboxRepo.retryErrorOperations();
      
      _lastPushTime = Date.now();
      
      // CRITIQUE: Après un push réussi, déclencher un pull pour recevoir les mises à jour depuis Sheets
      // Cela libère les produits pour accepter les modifications venant de Sheets
      const pushedCount = (productPatches.length || 0) + (unitPatches.length || 0) + (stockMoves.length || 0);
      if (pushedCount > 0) {
        syncLogger.info(`   🔄 [PUSH-SYNC] ${pushedCount} opération(s) envoyée(s), déclenchement pull pour recevoir les mises à jour depuis Sheets...`);
        
        // Déclencher un pull après un court délai pour laisser Sheets se mettre à jour
        // CRITIQUE: Cela libère les produits pour recevoir les mises à jour depuis Sheets
        setTimeout(async () => {
          try {
            syncLogger.info(`   📥 [PUSH-SYNC] Pull déclenché après push réussi pour libérer les produits`);
            await this.syncProductsFromSheets();
          } catch (pullError) {
            syncLogger.warn(`   ⚠️ [PUSH-SYNC] Erreur pull après push: ${pullError.message}`);
          }
        }, 2000); // 2 secondes de délai pour laisser Sheets se mettre à jour
      }
      
      syncLogger.info(`📤 [PUSH-SYNC] ==========================================`);
      
    } catch (error) {
      syncLogger.error(`❌ [PUSH-SYNC] Erreur pushPendingOperations: ${error.message}`);
    }
  }
  
  /**
   * Push les patches produits vers Sheets
   * Utilise batchPush pour être compatible avec le Code.gs (handleBatchPush)
   */
  async pushProductPatches(patches) {
    if (!patches || patches.length === 0) return;
    
    const ackedOpIds = [];
    
    // Préparer les opérations pour batchPush
    const ops = patches.map(op => ({
      op_id: op.op_id,
      entity: 'products',
      op: 'upsert',
      payload: {
        code: op.entity_code,
        ...op.payload
      }
    }));
    
    try {
      syncLogger.info(`      📤 Push ${patches.length} patch(es) produit via batchPush`);
      
      // Utiliser pushBatch qui supporte le mode batch via Code.gs
      const result = await sheetsClient.pushBatch(ops);
      
      if (result.success) {
        // Marquer les opérations appliquées comme confirmées
        for (const applied of (result.applied || [])) {
          if (applied.op_id) {
            ackedOpIds.push(applied.op_id);
          }
        }
        
        // Marquer les conflits comme erreurs
        for (const conflict of (result.conflicts || [])) {
          if (conflict.op_id) {
            outboxRepo.markAsError(conflict.op_id, conflict.reason || 'Conflit');
          }
        }
        
        syncLogger.info(`      ✅ ${ackedOpIds.length}/${patches.length} patch(es) produit confirmé(s)`);
      } else {
        for (const op of patches) {
          outboxRepo.markAsError(op.op_id, result.error || 'Erreur push');
        }
        syncLogger.warn(`      ⚠️ Erreur patches produits: ${result.error}`);
      }
    } catch (error) {
      for (const op of patches) {
        outboxRepo.markAsError(op.op_id, error.message);
      }
      syncLogger.error(`      ❌ Erreur push produits: ${error.message}`);
    }
    
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
  }
  
  /**
   * Push les patches unités vers Sheets (prix, stock, etc.)
   * CRITIQUE: Inclut sale_price_fc et stock_current pour TOUTES les unités (CARTON, MILLIER, PIECE)
   * Utilise batchPush pour être compatible avec le Code.gs (handleBatchPush → handleProductUpsert)
   */
  async pushUnitPatches(patches) {
    if (!patches || patches.length === 0) return;
    
    const ackedOpIds = [];
    
    // Préparer les opérations pour batchPush
    // IMPORTANT: Chaque patch d'unité doit inclure:
    // - code (product_code)
    // - unit_level (CARTON, MILLIER, PIECE)
    // - sale_price_fc (pour TOUTES les feuilles: Carton, Milliers, Piece)
    // - sale_price_usd
    // - stock_current/stock_initial
    // - auto_stock_factor
    const ops = patches.map(op => {
      const payload = op.payload || {};
      
      // CRITIQUE: Construire le payload complet pour handleProductUpsert dans Code.gs
      return {
        op_id: op.op_id,
        entity: 'product_units',
        op: 'upsert',
        payload: {
          code: payload.product_code || op.entity_code,
          name: payload.name || '',
          unit_level: payload.unit_level,
          unit_mark: payload.unit_mark || '',
          // CRITIQUE: Inclure les deux prix pour Sheets
          sale_price_usd: payload.sale_price_usd || 0,
          sale_price_fc: payload.sale_price_fc || 0,
          purchase_price_usd: payload.purchase_price_usd || 0,
          // CRITIQUE: Inclure le stock
          stock_initial: payload.stock_initial || payload.stock_current || 0,
          stock_current: payload.stock_current || payload.stock_initial || 0,
          // Automatisation stock
          auto_stock_factor: payload.auto_stock_factor || 1,
          qty_step: payload.qty_step || 1,
          // Métadonnées
          uuid: payload.product_uuid,
          last_update: new Date().toISOString()
        }
      };
    });
    
    try {
      syncLogger.info(`      📤 Push ${patches.length} patch(es) unité via batchPush`);
      
      // Log détaillé pour debug
      for (const op of ops.slice(0, 3)) {
        syncLogger.info(`         📦 ${op.payload.code}/${op.payload.unit_level}: FC=${op.payload.sale_price_fc}, USD=${op.payload.sale_price_usd}, Stock=${op.payload.stock_current}`);
      }
      if (ops.length > 3) {
        syncLogger.info(`         ... et ${ops.length - 3} autre(s)`);
      }
      
      // Utiliser pushBatch qui supporte le mode batch via Code.gs
      const result = await sheetsClient.pushBatch(ops);
      
      if (result.success) {
        // Marquer les opérations appliquées comme confirmées
        for (const applied of (result.applied || [])) {
          if (applied.op_id) {
            ackedOpIds.push(applied.op_id);
          }
        }
        
        // Marquer les conflits comme erreurs
        for (const conflict of (result.conflicts || [])) {
          if (conflict.op_id) {
            outboxRepo.markAsError(conflict.op_id, conflict.reason || 'Conflit');
            syncLogger.warn(`         ⚠️ Conflit unité (op_id: ${conflict.op_id}): ${conflict.reason}`);
          }
        }
        
        syncLogger.info(`      ✅ ${ackedOpIds.length}/${patches.length} patch(es) unité confirmé(s)`);
      } else {
        for (const op of patches) {
          outboxRepo.markAsError(op.op_id, result.error || 'Erreur push');
        }
        syncLogger.warn(`      ⚠️ Erreur patches unités: ${result.error}`);
      }
    } catch (error) {
      for (const op of patches) {
        outboxRepo.markAsError(op.op_id, error.message);
      }
      syncLogger.error(`      ❌ Erreur push unités: ${error.message}`);
    }
    
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
  }
  
  /**
   * Push les mouvements de stock vers Sheets
   * IMPORTANT: On envoie des DELTAS, pas des valeurs absolues
   */
  async pushStockMoves(moves) {
    const ackedOpIds = [];
    const ackedMoveIds = [];
    
    // Grouper par produit/unité pour batch
    const movesByUnit = {};
    for (const op of moves) {
      const payload = op.payload;
      const key = `${payload.product_code}-${payload.unit_level}-${payload.unit_mark || ''}`;
      if (!movesByUnit[key]) {
        movesByUnit[key] = {
          product_code: payload.product_code,
          unit_level: payload.unit_level,
          unit_mark: payload.unit_mark || '',
          moves: []
        };
      }
      movesByUnit[key].moves.push({ op, payload });
    }
    
    for (const key in movesByUnit) {
      const unitMoves = movesByUnit[key];
      
      try {
        // Calculer le delta total pour cette unité
        const totalDelta = unitMoves.moves.reduce((sum, m) => sum + m.payload.delta, 0);
        
        syncLogger.info(`      📤 Push mouvement stock: ${unitMoves.product_code}/${unitMoves.unit_level} delta=${totalDelta > 0 ? '+' : ''}${totalDelta}`);
        
        // Préparer les données pour Sheets
        const moveData = {
          product_code: unitMoves.product_code,
          unit_level: unitMoves.unit_level,
          unit_mark: unitMoves.unit_mark,
          delta: totalDelta,
          move_ids: unitMoves.moves.map(m => m.payload.move_id),
          op_ids: unitMoves.moves.map(m => m.op.op_id)
        };
        
        // Appeler l'API Sheets pour appliquer le delta de stock
        const result = await sheetsClient.push('stock_moves', [moveData]);
        
        if (result.success) {
          for (const m of unitMoves.moves) {
            ackedOpIds.push(m.op.op_id);
            if (m.payload.move_id) {
              ackedMoveIds.push(m.payload.move_id);
            }
          }
          syncLogger.info(`      ✅ Mouvement stock confirmé: ${unitMoves.product_code}/${unitMoves.unit_level}`);
        } else {
          for (const m of unitMoves.moves) {
            outboxRepo.markAsError(m.op.op_id, result.error || 'Erreur push');
          }
          syncLogger.warn(`      ⚠️ Erreur mouvement stock: ${result.error}`);
        }
      } catch (error) {
        for (const m of unitMoves.moves) {
          outboxRepo.markAsError(m.op.op_id, error.message);
        }
        syncLogger.error(`      ❌ Erreur push stock ${key}: ${error.message}`);
      }
    }
    
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
    if (ackedMoveIds.length > 0) {
      outboxRepo.markStockMovesSynced(ackedMoveIds);
    }
  }
  
  /**
   * Synchronise uniquement les produits depuis Sheets (pull)
   * Utilisé après un push réussi pour libérer les produits et recevoir les mises à jour depuis Sheets
   * CRITIQUE: Les produits avec des opérations "acked" ne sont plus bloqués et peuvent recevoir les mises à jour
   */
  async syncProductsFromSheets() {
    try {
      syncLogger.info(`📥 [PRODUCTS-PULL] Synchronisation produits depuis Sheets (après push réussi)`);
      
      // Récupérer la date de dernière synchronisation
      const sinceDate = syncRepo.getLastPullDate('products');
      const since = sinceDate ? new Date(sinceDate) : new Date(0);
      
      // Pull paginé par unit_level (CARTON, MILLIER, PIECE)
      const productUnitLevels = ['CARTON', 'MILLIER', 'PIECE'];
      const allProducts = [];
      
      for (const unitLevel of productUnitLevels) {
        try {
          syncLogger.info(`   📄 [PRODUCTS-PULL] Feuille: ${unitLevel}`);
          
          const result = await sheetsClient.pullAllPaged('products', since, {
            full: false, // Mode incrémental seulement
            unitLevel: unitLevel,
            maxRetries: 3,
            timeout: 30000,
            limit: 300
          });
          
          if (result.success && result.data.length > 0) {
            allProducts.push(...result.data);
            syncLogger.info(`   ✅ [PRODUCTS-PULL/${unitLevel}] ${result.data.length} produit(s) récupéré(s)`);
          } else if (result.success) {
            syncLogger.debug(`   📭 [PRODUCTS-PULL/${unitLevel}] Aucune mise à jour`);
          } else {
            syncLogger.warn(`   ⚠️ [PRODUCTS-PULL/${unitLevel}] Erreur: ${result.error}`);
          }
        } catch (error) {
          syncLogger.error(`   ❌ [PRODUCTS-PULL/${unitLevel}] Erreur: ${error.message}`);
        }
      }
      
      // Appliquer les mises à jour si des produits ont été récupérés
      if (allProducts.length > 0) {
        syncLogger.info(`   📦 [PRODUCTS-PULL] Total: ${allProducts.length} produit(s) à appliquer`);
        await this.applyProductUpdates(allProducts);
        syncRepo.setLastPullDate('products', new Date().toISOString());
        syncLogger.info(`   ✅ [PRODUCTS-PULL] Synchronisation terminée: ${allProducts.length} produit(s) mis à jour`);
      } else {
        syncLogger.info(`   ✅ [PRODUCTS-PULL] Aucune mise à jour disponible depuis Sheets`);
      }
    } catch (error) {
      syncLogger.error(`   ❌ [PRODUCTS-PULL] Erreur synchronisation produits: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Synchronisation dédiée des ventes : Immédiate + toutes les 10 secondes
   * Utilise la pagination avec cursor pour prendre beaucoup de données en lot
   */
  async startSalesSyncLoop() {
    const SALES_SYNC_INTERVAL_MS = 10000; // 10 secondes
    
    syncLogger.info(`💰 [SALES-SYNC] Démarrage de la synchronisation dédiée des ventes`);
    syncLogger.info(`   ⚡ [SALES-SYNC] Mode: IMMÉDIAT + toutes les ${SALES_SYNC_INTERVAL_MS / 1000} secondes`);
    syncLogger.info(`   📦 [SALES-SYNC] Pagination avec cursor pour lots importants`);
    syncLogger.info(`   🔄 [SALES-SYNC] Continue proprement là où on s'est arrêté`);
    
    // Fonction de synchronisation des ventes
    const syncSalesLoop = async () => {
      if (!_started) return; // Arrêter si le worker est arrêté
      
      if (_salesSyncRunning) {
        syncLogger.debug(`⏭️ [SALES-SYNC] Sync ventes déjà en cours, skip`);
        _salesLoopTimeout = setTimeout(syncSalesLoop, SALES_SYNC_INTERVAL_MS);
        return;
      }
      
      if (!isOnline) {
        syncLogger.debug(`⏸️ [SALES-SYNC] Pas de connexion Internet, skip`);
        _salesLoopTimeout = setTimeout(syncSalesLoop, SALES_SYNC_INTERVAL_MS);
        return;
      }
      
      _salesSyncRunning = true;
      const syncStartTime = Date.now();
      
      try {
        await this.syncSalesOnly();
      } catch (error) {
        syncLogger.error(`❌ [SALES-SYNC] Erreur lors de la synchronisation des ventes: ${error.message}`);
      } finally {
        _salesSyncRunning = false;
        const elapsed = Date.now() - syncStartTime;
        const wait = Math.max(1000, SALES_SYNC_INTERVAL_MS - elapsed); // Min 1s entre les syncs
        
        if (_started) {
          _salesLoopTimeout = setTimeout(syncSalesLoop, wait);
        }
      }
    };
    
    // Démarrer immédiatement (pas d'attente)
    setImmediate(() => {
      syncSalesLoop();
    });
  }
  
  /**
   * Synchronise uniquement les ventes depuis Google Sheets avec pagination
   * Utilise pullAllPaged avec cursor pour continuer là où on s'est arrêté
   */
  async syncSalesOnly() {
    const salesStartTime = Date.now();
    
    try {
      syncLogger.info(`💰 [SALES-SYNC] ==========================================`);
      syncLogger.info(`💰 [SALES-SYNC] DÉBUT SYNCHRONISATION DES VENTES`);
      syncLogger.info(`💰 [SALES-SYNC] ==========================================`);
      
      // Récupérer le cursor pour continuer là où on s'est arrêté (import initial en cours)
      const cursor = syncRepo.getCursor('sales');
      
      // DÉTERMINER LE MODE DE SYNCHRONISATION
      let sinceDate;
      let syncMode;
      let isIncrementalSync = false;
      
      if (cursor) {
        // Cursor existe = Import initial en cours (pagination)
        syncMode = 'IMPORT INITIAL (pagination en cours)';
        sinceDate = new Date(0).toISOString(); // Télécharger toutes les ventes
        const cursorStr = String(cursor);
        syncLogger.info(`   📍 [SALES-SYNC] Cursor trouvé: continuation de la pagination`);
        syncLogger.info(`   📍 [SALES-SYNC] Cursor: ${cursorStr.length > 50 ? cursorStr.substring(0, 50) + '...' : cursorStr}`);
      } else {
        // Pas de cursor = Synchronisation incrémentale ou import initial
        const lastPullDate = syncRepo.getLastPullDate('sales');
        
        if (lastPullDate) {
          // Synchronisation incrémentale : seulement les ventes modifiées/ajoutées depuis lastPullDate
          // IMPORTANT: Utiliser une date légèrement antérieure pour éviter de manquer des ventes
          // (à cause des différences de temps entre serveurs ou des arrondis)
          const adjustedDate = new Date(lastPullDate.getTime() - 60000); // Soustraire 1 minute pour sécurité
          syncMode = 'SYNC INCRÉMENTALE (mises à jour seulement)';
          sinceDate = adjustedDate.toISOString();
          isIncrementalSync = true;
          syncLogger.info(`   🔄 [SALES-SYNC] Mode: ${syncMode}`);
          syncLogger.info(`   📅 [SALES-SYNC] Dernière sync: ${lastPullDate.toISOString()} (${lastPullDate.toLocaleString('fr-FR')})`);
          syncLogger.info(`   📅 [SALES-SYNC] Date ajustée (sécurité -1min): ${sinceDate} (${new Date(sinceDate).toLocaleString('fr-FR')})`);
          syncLogger.info(`   📥 [SALES-SYNC] Téléchargement des ventes modifiées/ajoutées depuis cette date`);
        } else {
          // Pas de lastPullDate = Import initial complet
          syncMode = 'IMPORT INITIAL (première synchronisation)';
          sinceDate = new Date(0).toISOString();
          syncLogger.info(`   🚀 [SALES-SYNC] Mode: ${syncMode}`);
          syncLogger.info(`   📥 [SALES-SYNC] Téléchargement de TOUTES les ventes depuis Sheets`);
        }
      }
      
      syncLogger.info(`   📅 [SALES-SYNC] Date 'since': ${sinceDate} (${new Date(sinceDate).toLocaleString('fr-FR')})`);
      
      // Vérification AVANT téléchargement
      let salesCountBefore = 0;
      let itemsCountBefore = 0;
      try {
        const { getDb } = await import('../../db/sqlite.js');
        const db = getDb();
        const salesCountResult = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('SHEETS');
        const itemsCountResult = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
        salesCountBefore = salesCountResult?.count || 0;
        itemsCountBefore = itemsCountResult?.count || 0;
        syncLogger.info(`   🔍 [SALES-SYNC] ÉTAT AVANT: ${salesCountBefore} vente(s), ${itemsCountBefore} item(s) dans SQLite`);
      } catch (initError) {
        syncLogger.warn(`   ⚠️  [SALES-SYNC] Erreur vérification avant: ${initError.message}`);
      }
      
      // Pull avec pagination PRO
      if (isIncrementalSync) {
        syncLogger.info(`   📥 [SALES-SYNC] Mode INCRÉMENTAL: Téléchargement des ventes modifiées/ajoutées depuis ${new Date(sinceDate).toLocaleString('fr-FR')}...`);
      } else {
        syncLogger.info(`   📥 [SALES-SYNC] Mode IMPORT COMPLET: Téléchargement depuis Google Sheets (mode PRO - continuera jusqu'à la fin)...`);
      }
      
      let currentCursor = cursor;
      let totalProcessed = 0;
      let pageNumber = 0;
      let isComplete = false;
      let maxUpdatedAt = null; // Pour suivre la date de mise à jour la plus récente
      
      // BOUCLE jusqu'à ce que toutes les pages soient lues
      while (!isComplete) {
        pageNumber++;
        syncLogger.info(`   📄 [SALES-SYNC] Page ${pageNumber} - Cursor: ${currentCursor || 'début'}`);
        
        // Utiliser pull() pour récupérer une seule page à la fois
        // IMPORTANT: Toujours utiliser full=true pour s'assurer de récupérer toutes les ventes
        // même en mode incrémental, car Google Sheets filtre déjà par _updated_at
        const result = await sheetsClient.pull('sales', sinceDate, {
          full: true, // Toujours true - Google Sheets filtre par _updated_at automatiquement
          cursor: currentCursor,
          maxRetries: 5,
          timeout: isIncrementalSync ? 30000 : 60000, // Timeout plus court pour sync incrémentale (moins de données)
          limit: isIncrementalSync ? 200 : 500 // Limite plus petite pour sync incrémentale (plus rapide)
        });
        
        syncLogger.info(`   📊 [SALES-SYNC] Résultat page ${pageNumber}:`);
        syncLogger.info(`      ✅ Success: ${result.success}`);
        syncLogger.info(`      📦 Data length: ${result.data ? result.data.length : 0} ligne(s)`);
        syncLogger.info(`      📍 Next cursor: ${result.next_cursor || 'null (fin de pagination)'}`);
        syncLogger.info(`      ✅ Done: ${result.done !== undefined ? (result.done ? 'true (toutes les pages lues)' : 'false (plus de pages à lire)') : 'undefined'}`);
        
        // Vérifier si on a des données à appliquer
        if (!result.success) {
          syncLogger.warn(`   ⚠️  [SALES-SYNC] Échec du téléchargement page ${pageNumber}: ${result.error || 'Erreur inconnue'}`);
          break; // Sortir de la boucle en cas d'erreur
        }
        
        if (result.success && result.data && result.data.length > 0) {
          syncLogger.info(`   ✅ [SALES-SYNC] ${result.data.length} ligne(s) téléchargée(s) depuis Sheets en ${Date.now() - salesStartTime}ms`);
          
          // Suivre la date de mise à jour la plus récente pour mettre à jour lastPullDate
          for (const item of result.data) {
            const itemUpdatedAt = item._updated_at || item._remote_updated_at || item.sold_at || item.created_at;
            if (itemUpdatedAt) {
              const itemDate = new Date(itemUpdatedAt);
              if (!maxUpdatedAt || itemDate > maxUpdatedAt) {
                maxUpdatedAt = itemDate;
              }
            }
          }
          
          // Log détaillé des premières lignes pour vérification
          if (result.data.length > 0) {
            syncLogger.info(`   📋 [SALES-SYNC] Exemple de données téléchargées (3 premières lignes):`);
            for (let i = 0; i < Math.min(3, result.data.length); i++) {
              const item = result.data[i];
              const updatedAt = item._updated_at || item._remote_updated_at || item.sold_at || 'N/A';
              syncLogger.info(`      [${i + 1}] Facture: ${item.invoice_number || 'N/A'}, Client: ${item.client_name || 'N/A'}, Produit: ${item.product_code || 'N/A'}, Qty: ${item.qty || 0}, Updated: ${updatedAt}`);
            }
          }
          
          // Appliquer les mises à jour (qui gère le groupement par facture)
          syncLogger.info(`   🔄 [SALES-SYNC] ==========================================`);
          syncLogger.info(`   🔄 [SALES-SYNC] APPLICATION DES DONNÉES DANS SQLITE`);
          syncLogger.info(`   🔄 [SALES-SYNC] ==========================================`);
          syncLogger.info(`   📦 ${result.data.length} ligne(s) à traiter → Groupement par facture → Stockage dans SQLite`);
          syncLogger.info(`   💾 Tables SQLite: "sales" + "sale_items"`);
          const applyStartTime = Date.now();
          const applyResult = await this.applyUpdates('sales', result.data);
          const applyDuration = Date.now() - applyStartTime;
          
          // Vérification immédiate dans SQLite pour confirmer le stockage
          let salesCountAfter = 0;
          let itemsCountAfter = 0;
          try {
            const { getDb } = await import('../../db/sqlite.js');
            const db = getDb();
            const salesCountResult = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('SHEETS');
            const itemsCountResult = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
            salesCountAfter = salesCountResult?.count || 0;
            itemsCountAfter = itemsCountResult?.count || 0;
          } catch (verifyError) {
            syncLogger.error(`   ❌ [SALES-SYNC] Erreur vérification après: ${verifyError.message}`);
          }
          
          syncLogger.info(`   ✅ [SALES-SYNC] ==========================================`);
          syncLogger.info(`   ✅ [SALES-SYNC] APPLICATION TERMINÉE EN ${applyDuration}ms`);
          syncLogger.info(`   ✅ [SALES-SYNC] ==========================================`);
          syncLogger.info(`      📊 Résultat de l'application:`);
          syncLogger.info(`         ✅ ${applyResult.inserted || 0} facture(s) CRÉÉE(S) dans SQLite`);
          syncLogger.info(`         ✅ ${applyResult.updated || 0} facture(s) MIS(E) À JOUR dans SQLite`);
          syncLogger.info(`         ⏭️  ${applyResult.skipped || 0} facture(s) IGNORÉE(S) (déjà synchronisées)`);
          if (applyResult.errorCount && applyResult.errorCount > 0) {
            syncLogger.warn(`         ❌ ${applyResult.errorCount} facture(s) EN ERREUR`);
          }
          
          // Vérification SQLite immédiate avec comparaison AVANT/APRÈS
          syncLogger.info(`      🔍 [SALES-SYNC] VÉRIFICATION IMMÉDIATE DANS SQLITE:`);
          syncLogger.info(`         📊 AVANT: ${salesCountBefore} vente(s), ${itemsCountBefore} item(s)`);
          syncLogger.info(`         📊 APRÈS: ${salesCountAfter} vente(s), ${itemsCountAfter} item(s)`);
          
          const newSales = salesCountAfter - salesCountBefore;
          const newItems = itemsCountAfter - itemsCountBefore;
          
          if (newSales > 0 || newItems > 0) {
            syncLogger.info(`         ✅ ${newSales} nouvelle(s) vente(s) ajoutée(s) dans SQLite!`);
            syncLogger.info(`         ✅ ${newItems} nouvel(aux) item(s) ajouté(s) dans SQLite!`);
          } else if (applyResult.inserted > 0 || applyResult.updated > 0) {
            syncLogger.warn(`         ⚠️  Des ventes ont été traitées (${applyResult.inserted} créée(s), ${applyResult.updated} mise(s) à jour) mais le nombre total n'a pas changé`);
            syncLogger.warn(`         💡 Raison possible: Les ventes existaient déjà et ont été mises à jour`);
          } else if (result.data.length > 0) {
            syncLogger.error(`         ❌ ERREUR CRITIQUE: ${result.data.length} ligne(s) téléchargée(s) mais aucune vente stockée!`);
            syncLogger.error(`         💡 Diagnostic: Vérifier les logs d'erreur ci-dessus pour chaque facture`);
          }
          
          if (salesCountAfter > 0) {
            syncLogger.info(`      ✅ [SALES-SYNC] CONFIRMÉ: ${salesCountAfter} vente(s) stockée(s) dans SQLite (table "sales")`);
            syncLogger.info(`      ✅ [SALES-SYNC] CONFIRMÉ: ${itemsCountAfter} item(s) stocké(s) dans SQLite (table "sale_items")`);
            syncLogger.info(`      💾 Les ventes sont maintenant stockées dans la base SQLite locale`);
            syncLogger.info(`      📱 Elles seront visibles dans la page "Historique des ventes"`);
          } else {
            syncLogger.error(`      ❌ [SALES-SYNC] ERREUR CRITIQUE: Aucune vente trouvée dans SQLite après l'application!`);
            syncLogger.error(`      📊 [SALES-SYNC] Diagnostic:`);
            syncLogger.error(`         - Lignes téléchargées: ${result.data.length}`);
            syncLogger.error(`         - Factures créées: ${applyResult.inserted || 0}`);
            syncLogger.error(`         - Factures mises à jour: ${applyResult.updated || 0}`);
            syncLogger.error(`         - Factures ignorées: ${applyResult.skipped || 0}`);
            syncLogger.error(`      💡 [SALES-SYNC] Vérifier que applySalesUpdates() fonctionne correctement`);
            syncLogger.error(`      💡 [SALES-SYNC] Vérifier les logs d'erreur ci-dessus pour chaque facture`);
            
            // Diagnostic supplémentaire
            if (result.data.length > 0) {
              const firstItem = result.data[0];
              syncLogger.error(`      🔍 [SALES-SYNC] Exemple de première ligne téléchargée:`);
              syncLogger.error(`         - invoice_number: ${firstItem.invoice_number || 'MANQUANT'}`);
              syncLogger.error(`         - client_name: ${firstItem.client_name || 'N/A'}`);
              syncLogger.error(`         - product_code: ${firstItem.product_code || 'MANQUANT'}`);
              syncLogger.error(`         - qty: ${firstItem.qty !== undefined ? firstItem.qty : 'MANQUANT'}`);
              syncLogger.error(`         - sold_at: ${firstItem.sold_at || 'MANQUANT'}`);
            }
          }
          
          totalProcessed += result.data.length;
          
          // Mettre à jour le cursor pour la prochaine itération
          if (result.next_cursor && !result.done) {
            currentCursor = result.next_cursor;
            syncLogger.info(`   📍 [SALES-SYNC] Page ${pageNumber} traitée: ${result.data.length} ligne(s) | Total: ${totalProcessed} | Continuation...`);
          } else {
            // Fin de pagination
            isComplete = true;
            syncRepo.setCursor('sales', null);
            syncLogger.info(`   ✅ [SALES-SYNC] Pagination terminée: ${totalProcessed} ligne(s) traitées au total`);
          }
        } else if (result.success && (!result.data || result.data.length === 0)) {
          // Aucune donnée retournée - fin de pagination
          syncLogger.info(`   ℹ️  [SALES-SYNC] Page ${pageNumber}: Aucune donnée retournée (fin de pagination)`);
          isComplete = true;
          syncRepo.setCursor('sales', null);
        } else {
          // Erreur - sortir de la boucle
          syncLogger.warn(`   ⚠️  [SALES-SYNC] Erreur page ${pageNumber}: ${result.error || 'Erreur inconnue'}`);
          break;
        }
      }
      
      // Mettre à jour la date de dernière synchronisation après toutes les pages
      // Utiliser maxUpdatedAt si disponible (plus précis), sinon utiliser maintenant
      const finalLastPullDate = maxUpdatedAt && maxUpdatedAt > new Date(sinceDate) 
        ? maxUpdatedAt.toISOString() 
        : new Date().toISOString();
      
      syncRepo.setLastPullDate('sales', finalLastPullDate);
      
      if (isIncrementalSync) {
        syncLogger.info(`   ✅ [SALES-SYNC] Sync incrémentale terminée: ${totalProcessed} ligne(s) traitées`);
        syncLogger.info(`   📅 [SALES-SYNC] lastPullDate mis à jour: ${finalLastPullDate} (${new Date(finalLastPullDate).toLocaleString('fr-FR')})`);
      } else {
        syncLogger.info(`💰 [SALES-SYNC] SYNCHRONISATION COMPLÈTE TERMINÉE (${Date.now() - salesStartTime}ms)`);
        syncLogger.info(`💰 [SALES-SYNC] Total: ${totalProcessed} ligne(s) traitées en ${pageNumber} page(s)`);
      }
      syncLogger.info(`💰 [SALES-SYNC] ==========================================`);
      
      // Synchronisation bidirectionnelle : Push des ventes locales vers Sheets
      syncLogger.info(`   🔄 [SALES-SYNC] Démarrage synchronisation bidirectionnelle...`);
      try {
        await this.syncLocalSalesToSheets();
      } catch (pushError) {
        syncLogger.warn(`   ⚠️ [SALES-SYNC] Erreur push ventes locales vers Sheets: ${pushError.message}`);
        // Ne pas bloquer si erreur push (peut être hors ligne)
      }
      
      // Nettoyage : Supprimer les ventes locales qui n'existent plus dans Sheets (sauf pending)
      // IMPORTANT: Vérifier la connexion Internet avant le nettoyage
      // IMPORTANT: Appeler le nettoyage APRÈS chaque synchronisation pour supprimer les ventes supprimées dans Sheets
      if (isOnline) {
        try {
          syncLogger.info(`   🧹 [SALES-SYNC] Démarrage nettoyage des ventes supprimées dans Sheets...`);
          await this.cleanupLocalSalesNotInSheets();
          syncLogger.info(`   ✅ [SALES-SYNC] Nettoyage terminé`);
        } catch (cleanupError) {
          syncLogger.warn(`   ⚠️ [SALES-SYNC] Erreur nettoyage ventes locales: ${cleanupError.message}`);
          // Ne pas bloquer si erreur nettoyage
        }
      } else {
        syncLogger.info(`   ⏸️ [SALES-SYNC] Nettoyage annulé: pas de connexion Internet`);
      }
      
      // Vérification automatique post-synchronisation
      syncLogger.info(`   🔍 [SALES-SYNC] Démarrage de la vérification automatique...`);
      await this.verifySalesSync();
    } catch (error) {
      syncLogger.error(`   ❌ [SALES-SYNC] Erreur: ${error.message}`);
      if (error.stack) {
        syncLogger.error(`      Stack: ${error.stack.substring(0, 300)}...`);
      }
      // Ne pas réinitialiser le cursor en cas d'erreur pour réessayer au prochain cycle
    }
  }
  
  /**
   * Vérifie que les ventes sont bien synchronisées depuis Sheets vers SQLite
   * Compare la structure et le contenu des tables
   */
  async verifySalesSync() {
    try {
      syncLogger.info(`🔍 [VERIFY-SALES] ==========================================`);
      syncLogger.info(`🔍 [VERIFY-SALES] VÉRIFICATION DE LA SYNCHRONISATION DES VENTES`);
      syncLogger.info(`🔍 [VERIFY-SALES] ==========================================`);
      
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      
      // 1. Vérifier la structure de la table sales
      syncLogger.info(`   📋 [VERIFY-SALES] Vérification de la structure SQLite (table: sales)`);
      const salesTableInfo = db.prepare("PRAGMA table_info(sales)").all();
      syncLogger.info(`      ✅ Table 'sales' existe avec ${salesTableInfo.length} colonne(s)`);
      
      const expectedSalesColumns = [
        'id', 'uuid', 'invoice_number', 'sold_at', 'client_name', 'client_phone',
        'seller_name', 'seller_user_id', 'total_fc', 'total_usd', 'rate_fc_per_usd',
        'payment_mode', 'paid_fc', 'paid_usd', 'status', 'origin', 'source_device',
        'created_at', 'updated_at', 'synced_at'
      ];
      
      const actualSalesColumns = salesTableInfo.map(col => col.name);
      const missingSalesColumns = expectedSalesColumns.filter(col => !actualSalesColumns.includes(col));
      if (missingSalesColumns.length > 0) {
        syncLogger.warn(`      ⚠️  Colonnes manquantes dans 'sales': ${missingSalesColumns.join(', ')}`);
      } else {
        syncLogger.info(`      ✅ Toutes les colonnes attendues sont présentes dans 'sales'`);
      }
      
      // 2. Vérifier la structure de la table sale_items
      syncLogger.info(`   📋 [VERIFY-SALES] Vérification de la structure SQLite (table: sale_items)`);
      const saleItemsTableInfo = db.prepare("PRAGMA table_info(sale_items)").all();
      syncLogger.info(`      ✅ Table 'sale_items' existe avec ${saleItemsTableInfo.length} colonne(s)`);
      
      const expectedSaleItemsColumns = [
        'id', 'uuid', 'sale_id', 'product_id', 'product_code', 'product_name',
        'unit_level', 'unit_mark', 'qty', 'qty_label', 'unit_price_fc',
        'subtotal_fc', 'unit_price_usd', 'subtotal_usd', 'created_at'
      ];
      
      const actualSaleItemsColumns = saleItemsTableInfo.map(col => col.name);
      const missingSaleItemsColumns = expectedSaleItemsColumns.filter(col => !actualSaleItemsColumns.includes(col));
      if (missingSaleItemsColumns.length > 0) {
        syncLogger.warn(`      ⚠️  Colonnes manquantes dans 'sale_items': ${missingSaleItemsColumns.join(', ')}`);
      } else {
        syncLogger.info(`      ✅ Toutes les colonnes attendues sont présentes dans 'sale_items'`);
      }
      
      // 3. Compter les ventes dans SQLite
      syncLogger.info(`   📊 [VERIFY-SALES] Comptage des ventes dans SQLite`);
      
      const totalSalesCount = db.prepare('SELECT COUNT(*) as count FROM sales').get();
      const salesFromSheetsCount = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('SHEETS');
      const salesLocalCount = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('LOCAL');
      
      syncLogger.info(`      📦 Total ventes (sales): ${totalSalesCount.count}`);
      syncLogger.info(`      📥 Ventes depuis Sheets (origin='SHEETS'): ${salesFromSheetsCount.count}`);
      syncLogger.info(`      💻 Ventes locales (origin='LOCAL'): ${salesLocalCount.count}`);
      
      // 4. Compter les items de vente
      const totalSaleItemsCount = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
      syncLogger.info(`      📦 Total items de vente (sale_items): ${totalSaleItemsCount.count}`);
      
      // 5. Vérifier l'intégrité (ventes sans items)
      const salesWithoutItems = db.prepare(`
        SELECT COUNT(DISTINCT s.id) as count
        FROM sales s
        LEFT JOIN sale_items si ON s.id = si.sale_id
        WHERE si.id IS NULL
      `).get();
      
      if (salesWithoutItems.count > 0) {
        syncLogger.warn(`      ⚠️  ${salesWithoutItems.count} vente(s) sans items de vente`);
      } else {
        syncLogger.info(`      ✅ Toutes les ventes ont des items associés`);
      }
      
      // 6. Afficher quelques exemples de ventes depuis Sheets
      const sampleSales = db.prepare(`
        SELECT 
          invoice_number, 
          client_name, 
          sold_at, 
          total_fc,
          (SELECT COUNT(*) FROM sale_items WHERE sale_id = sales.id) as items_count
        FROM sales 
        WHERE origin = 'SHEETS' 
        ORDER BY sold_at DESC 
        LIMIT 5
      `).all();
      
      if (sampleSales.length > 0) {
        syncLogger.info(`   📋 [VERIFY-SALES] Exemples de ventes depuis Sheets (5 dernières):`);
        for (const sale of sampleSales) {
          syncLogger.info(`      📄 Facture: ${sale.invoice_number}, Client: ${sale.client_name || 'N/A'}, Total: ${sale.total_fc} FC, Items: ${sale.items_count}, Date: ${sale.sold_at}`);
        }
      } else {
        syncLogger.warn(`      ⚠️  Aucune vente depuis Sheets trouvée dans SQLite`);
        syncLogger.warn(`      💡 Vérifier que getSalesPage() dans Code.gs retourne des données`);
      }
      
      // 7. Vérifier les colonnes attendues dans Sheets (selon Code.gs)
      syncLogger.info(`   📋 [VERIFY-SALES] Structure attendue dans Google Sheets (feuille "Ventes"):`);
      syncLogger.info(`      Colonnes attendues: Date, Numéro de facture, Code produit, client, QTE, MARK, Prix unitaire, Vendeur, mode stock, Telephone, USD, _uuid`);
      syncLogger.info(`      💡 Si getSalesPage() retourne 0 items, vérifier que ces colonnes existent dans Sheets`);
      
      syncLogger.info(`🔍 [VERIFY-SALES] ==========================================`);
      syncLogger.info(`🔍 [VERIFY-SALES] VÉRIFICATION TERMINÉE`);
      syncLogger.info(`🔍 [VERIFY-SALES] ==========================================`);
      
    } catch (error) {
      syncLogger.error(`❌ [VERIFY-SALES] Erreur: ${error.message}`);
    }
  }
  
  /**
   * Synchronise les ventes locales vers Google Sheets (push)
   * Ne bloque pas si hors ligne ou erreur
   */
  async syncLocalSalesToSheets() {
    try {
      syncLogger.info(`🔄 [LOCAL-SALES-PUSH] ==========================================`);
      syncLogger.info(`🔄 [LOCAL-SALES-PUSH] SYNCHRONISATION VENTES LOCALES → SHEETS`);
      syncLogger.info(`🔄 [LOCAL-SALES-PUSH] ==========================================`);
      
      // VÉRIFIER LA CONNEXION INTERNET AVANT DE COMMENCER
      if (!isOnline) {
        syncLogger.info(`   ⏸️ [LOCAL-SALES-PUSH] Pas de connexion Internet, synchronisation annulée`);
        syncLogger.info(`   💡 [LOCAL-SALES-PUSH] La synchronisation sera reprise lorsque la connexion sera rétablie`);
        return;
      }
      
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      
      // Récupérer TOUTES les ventes locales (y compris celles avec status='pending')
      // IMPORTANT: Pousser toutes les ventes locales vers Sheets pour synchronisation complète
      // Les ventes avec status='pending' seront synchronisées et leur statut sera mis à jour à 'paid'
      const localSales = db.prepare(`
        SELECT s.*
        FROM sales s
        WHERE s.origin = 'LOCAL'
        ORDER BY s.sold_at DESC
      `).all();
      
      if (!localSales || localSales.length === 0) {
        syncLogger.info(`   ✅ [LOCAL-SALES-PUSH] Aucune vente locale à synchroniser`);
        return;
      }
      
      // Séparer les ventes pending des autres
      const pendingSales = localSales.filter(s => s.status === 'pending');
      const otherSales = localSales.filter(s => s.status !== 'pending');
      
      syncLogger.info(`   📦 [LOCAL-SALES-PUSH] ${localSales.length} vente(s) locale(s) à synchroniser vers Sheets`);
      syncLogger.info(`      ⏳ ${pendingSales.length} vente(s) avec status='pending' (seront synchronisées et passées à 'paid')`);
      syncLogger.info(`      ✅ ${otherSales.length} vente(s) déjà synchronisées (seront mises à jour)`);
      syncLogger.info(`   💡 [LOCAL-SALES-PUSH] Toutes les ventes locales seront poussées vers Sheets`);
      
      // Préparer les opérations pour batchPush (plus efficace)
      const opsToPush = [];
      
      for (const sale of localSales) {
        try {
          // Vérifier la connexion avant chaque traitement
          if (!isOnline) {
            syncLogger.warn(`   ⚠️ [LOCAL-SALES-PUSH] Connexion Internet perdue, arrêt de la synchronisation`);
            return;
          }
          
          // Récupérer les items depuis DB
          const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
          
          // Préparer le payload pour Sheets
          // IMPORTANT: Envoyer 'paid' à Sheets même si localement c'est 'pending'
          // Car une fois synchronisée, la vente sera considérée comme payée
          const statusForSheets = sale.status === 'pending' ? 'paid' : sale.status;
          
          const payload = {
            uuid: sale.uuid,
            invoice_number: sale.invoice_number,
            sold_at: sale.sold_at,
            client_name: sale.client_name,
            client_phone: sale.client_phone,
            seller_name: sale.seller_name,
            total_fc: sale.total_fc,
            total_usd: sale.total_usd,
            rate_fc_per_usd: sale.rate_fc_per_usd || 2800,
            payment_mode: sale.payment_mode || 'cash',
            paid_fc: sale.paid_fc || 0,
            paid_usd: sale.paid_usd || 0,
            status: statusForSheets, // IMPORTANT: Toujours envoyer 'paid' à Sheets (même si localement 'pending')
            origin: sale.origin,
            source_device: sale.source_device,
            items: items.map(item => ({
              uuid: item.uuid,
              product_code: item.product_code,
              product_name: item.product_name,
              unit_level: item.unit_level,
              unit_mark: item.unit_mark || '',
              qty: item.qty,
              qty_label: item.qty_label || item.qty.toString(),
              unit_price_fc: item.unit_price_fc,
              subtotal_fc: item.subtotal_fc,
              unit_price_usd: item.unit_price_usd || 0,
              subtotal_usd: item.subtotal_usd || 0
            }))
          };
          
          opsToPush.push({
            entity: 'sales',
            op: 'upsert',
            payload: payload,
            base_remote_updated_at: sale.synced_at || sale.updated_at || sale.sold_at
          });
        } catch (saleError) {
          syncLogger.warn(`   ⚠️ [LOCAL-SALES-PUSH] Erreur préparation vente ${sale.invoice_number}: ${saleError.message}`);
        }
      }
      
      if (opsToPush.length === 0) {
        syncLogger.info(`   ✅ [LOCAL-SALES-PUSH] Aucune opération à pousser`);
        return;
      }
      
      syncLogger.info(`   📤 [LOCAL-SALES-PUSH] Envoi de ${opsToPush.length} opération(s) vers Sheets via batchPush...`);
      
      // Utiliser batchPush pour envoyer toutes les ventes en une seule requête (plus efficace)
      const pushResult = await sheetsClient.batchPush(opsToPush);
      
      let pushed = 0;
      let errors = 0;
      
      if (pushResult && pushResult.success) {
        // Mettre à jour synced_at ET status pour les ventes qui ont été appliquées avec succès
        // IMPORTANT: Si la vente avait status='pending', la passer à 'paid' après synchronisation réussie
        syncLogger.info(`   📊 [LOCAL-SALES-PUSH] ${pushResult.applied?.length || 0} vente(s) appliquée(s) avec succès dans Sheets`);
        
        const syncedInvoiceNumbers = new Set();
        const now = new Date().toISOString();
        
        // Marquer comme synchronisées les ventes qui sont dans 'applied'
        for (const appliedOp of pushResult.applied || []) {
          const saleToUpdate = localSales.find(s => s.uuid === appliedOp.uuid || s.invoice_number === appliedOp.invoice_number);
          if (saleToUpdate) {
            const wasPending = saleToUpdate.status === 'pending';
            
            // Mettre à jour synced_at et status (de 'pending' à 'paid' si nécessaire)
            if (wasPending) {
              db.prepare('UPDATE sales SET synced_at = ?, status = ? WHERE id = ?').run(now, 'paid', saleToUpdate.id);
              syncLogger.info(`   ✅ [LOCAL-SALES-PUSH] Vente ${saleToUpdate.invoice_number} (ID: ${saleToUpdate.id}) synchronisée: status 'pending' → 'paid', synced_at = ${now}`);
            } else {
              db.prepare('UPDATE sales SET synced_at = ? WHERE id = ?').run(now, saleToUpdate.id);
              syncLogger.info(`   ✅ [LOCAL-SALES-PUSH] Vente ${saleToUpdate.invoice_number} (ID: ${saleToUpdate.id}, Status: ${saleToUpdate.status}) synchronisée vers Sheets, synced_at = ${now}`);
            }
            syncedInvoiceNumbers.add(saleToUpdate.invoice_number);
            pushed++;
          } else {
            syncLogger.warn(`   ⚠️ [LOCAL-SALES-PUSH] Vente appliquée dans Sheets mais non trouvée localement: ${appliedOp.invoice_number || appliedOp.uuid}`);
          }
        }
        
        // IMPORTANT: Si le push a réussi mais qu'une vente locale n'est pas dans 'applied',
        // cela peut signifier qu'elle existe déjà dans Sheets (mise à jour plutôt qu'insertion)
        // Dans ce cas, on la marque quand même comme synchronisée si elle était dans les opérations envoyées
        const sentInvoiceNumbers = new Set(opsToPush.map(op => op.invoice_number));
        const notInAppliedButSent = localSales.filter(s => 
          sentInvoiceNumbers.has(s.invoice_number) && 
          !syncedInvoiceNumbers.has(s.invoice_number) &&
          !s.synced_at // Ne marquer que si pas déjà synchronisée
        );
        
        if (notInAppliedButSent.length > 0) {
          syncLogger.info(`   💡 [LOCAL-SALES-PUSH] ${notInAppliedButSent.length} vente(s) locale(s) envoyée(s) mais non dans 'applied' (probablement déjà dans Sheets):`);
          for (const sale of notInAppliedButSent) {
            const wasPending = sale.status === 'pending';
            if (wasPending) {
              db.prepare('UPDATE sales SET synced_at = ?, status = ? WHERE id = ?').run(now, 'paid', sale.id);
              syncLogger.info(`   ✅ [LOCAL-SALES-PUSH] Vente ${sale.invoice_number} (ID: ${sale.id}) marquée comme synchronisée: status 'pending' → 'paid', synced_at = ${now}`);
            } else {
              db.prepare('UPDATE sales SET synced_at = ? WHERE id = ?').run(now, sale.id);
              syncLogger.info(`   ✅ [LOCAL-SALES-PUSH] Vente ${sale.invoice_number} (ID: ${sale.id}) marquée comme synchronisée, synced_at = ${now}`);
            }
            syncedInvoiceNumbers.add(sale.invoice_number);
            if (!syncedInvoiceNumbers.has(sale.invoice_number)) {
              pushed++;
            }
          }
        }
        
        // Log des ventes locales qui n'ont vraiment pas été synchronisées
        const trulyNotSyncedSales = localSales.filter(s => 
          !syncedInvoiceNumbers.has(s.invoice_number) && 
          !sentInvoiceNumbers.has(s.invoice_number)
        );
        if (trulyNotSyncedSales.length > 0) {
          syncLogger.warn(`   ⚠️ [LOCAL-SALES-PUSH] ${trulyNotSyncedSales.length} vente(s) locale(s) n'ont PAS été envoyées ni synchronisées:`);
          for (const sale of trulyNotSyncedSales.slice(0, 5)) {
            syncLogger.warn(`      - ${sale.invoice_number} (ID: ${sale.id}, Status: ${sale.status}, Synced: ${sale.synced_at || 'null'})`);
          }
        }
        
        // Compter les conflits comme erreurs
        if (pushResult.conflicts && pushResult.conflicts.length > 0) {
          errors += pushResult.conflicts.length;
          for (const conflict of pushResult.conflicts) {
            syncLogger.warn(`   ⚠️ [LOCAL-SALES-PUSH] Conflit pour vente ${conflict.uuid || conflict.invoice_number}: ${conflict.reason || 'Conflit inconnu'}`);
          }
        }
        
        syncLogger.info(`   ✅ [LOCAL-SALES-PUSH] Synchronisation terminée: ${pushed} poussée(s), ${errors} erreur(s)/conflit(s)`);
      } else {
        errors = opsToPush.length;
        syncLogger.warn(`   ⚠️ [LOCAL-SALES-PUSH] Échec batchPush: ${pushResult?.error || 'Erreur inconnue'}`);
        
        // Marquer comme hors ligne si erreur réseau
        if (pushResult?.error && (pushResult.error.includes('timeout') || pushResult.error.includes('ECONNREFUSED') || pushResult.error.includes('ENOTFOUND'))) {
          syncLogger.warn(`   🌐 [LOCAL-SALES-PUSH] Connexion Internet perdue détectée`);
          isOnline = false;
        }
      }
      
      syncLogger.info(`🔄 [LOCAL-SALES-PUSH] ==========================================`);
    } catch (error) {
      syncLogger.warn(`   ⚠️ [LOCAL-SALES-PUSH] Erreur globale: ${error.message}`);
      
      // Marquer comme hors ligne si erreur réseau
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        syncLogger.warn(`   🌐 [LOCAL-SALES-PUSH] Connexion Internet perdue détectée`);
        isOnline = false;
      }
      
      // Ne pas bloquer si erreur (peut être hors ligne)
    }
  }
  
  /**
   * Supprime les ventes locales qui n'existent plus dans Sheets (sauf si status = pending)
   * Ne bloque pas si hors ligne ou erreur
   */
  async cleanupLocalSalesNotInSheets() {
    try {
      syncLogger.info(`🧹 [CLEANUP-SALES] ==========================================`);
      syncLogger.info(`🧹 [CLEANUP-SALES] NETTOYAGE VENTES ABSENTES DE SHEETS`);
      syncLogger.info(`🧹 [CLEANUP-SALES] ==========================================`);
      
      // VÉRIFIER LA CONNEXION INTERNET AVANT DE COMMENCER
      if (!isOnline) {
        syncLogger.info(`   ⏸️ [CLEANUP-SALES] Pas de connexion Internet, nettoyage annulé`);
        syncLogger.info(`   💡 [CLEANUP-SALES] Le nettoyage sera repris lorsque la connexion sera rétablie`);
        return;
      }
      
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      
      // Récupérer toutes les factures depuis Sheets (via pull complet)
      syncLogger.info(`   📥 [CLEANUP-SALES] Récupération des factures depuis Sheets...`);
      const sheetsInvoices = new Set();
      let cursor = null;
      let done = false;
      let pageCount = 0;
      let totalSheetsRows = 0;
      
      try {
        while (!done && pageCount < 100) { // Limite de sécurité
          pageCount++;
          
          // Vérifier la connexion avant chaque requête
          if (!isOnline) {
            syncLogger.warn(`   ⚠️ [CLEANUP-SALES] Connexion Internet perdue pendant la récupération, arrêt du nettoyage`);
            return; // Arrêter le nettoyage si connexion perdue
          }
          
          const result = await sheetsClient.pull('sales', new Date(0), {
            full: true,
            cursor: cursor,
            limit: 500
          });
          
          // Vérifier si la requête a échoué (connexion perdue)
          if (!result.success) {
            syncLogger.warn(`   ⚠️ [CLEANUP-SALES] Échec de la récupération depuis Sheets: ${result.error || 'Erreur inconnue'}`);
            syncLogger.warn(`   ⚠️ [CLEANUP-SALES] Nettoyage annulé pour éviter de supprimer des ventes par erreur`);
            
            // Marquer comme hors ligne si erreur réseau
            if (result.error && (result.error.includes('timeout') || result.error.includes('ECONNREFUSED') || result.error.includes('ENOTFOUND'))) {
              syncLogger.warn(`   🌐 [CLEANUP-SALES] Connexion Internet perdue détectée`);
              isOnline = false;
            }
            
            return; // Arrêter le nettoyage si Sheets est inaccessible
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
        syncLogger.warn(`   ⚠️ [CLEANUP-SALES] Erreur lors de la récupération depuis Sheets: ${pullError.message}`);
        syncLogger.warn(`   ⚠️ [CLEANUP-SALES] Nettoyage annulé pour éviter de supprimer des ventes par erreur`);
        
        // Marquer comme hors ligne si erreur réseau
        if (pullError.code === 'ECONNREFUSED' || pullError.code === 'ENOTFOUND' || pullError.code === 'ETIMEDOUT' || pullError.message?.includes('timeout')) {
          syncLogger.warn(`   🌐 [CLEANUP-SALES] Connexion Internet perdue détectée`);
          isOnline = false;
        }
        
        return; // Arrêter le nettoyage si erreur
      }
      
      syncLogger.info(`   📊 [CLEANUP-SALES] ${sheetsInvoices.size} facture(s) unique(s) trouvée(s) dans Sheets (${totalSheetsRows} lignes)`);
      
      // IMPORTANT: Récupérer TOUTES les ventes synchronisées (LOCAL et SHEETS) pour comparaison
      // On supprimera celles qui ne sont plus dans Sheets
      // IMPORTANT: Inclure les ventes avec status='pending' MAIS seulement si elles sont synchronisées (synced_at != null)
      // Les ventes pending non synchronisées seront conservées car elles n'ont pas encore été envoyées à Sheets
      const allSales = db.prepare(`
        SELECT id, invoice_number, status, sold_at, synced_at, origin
        FROM sales
        ORDER BY sold_at DESC
      `).all();
      
      syncLogger.info(`   📊 [CLEANUP-SALES] ${allSales.length} vente(s) totale(s) dans la base de données`);
      
      // Séparer par origine
      const localSales = allSales.filter(s => s.origin === 'LOCAL');
      const sheetsSales = allSales.filter(s => s.origin === 'SHEETS');
      
      syncLogger.info(`   📊 [CLEANUP-SALES] ${localSales.length} vente(s) locale(s), ${sheetsSales.length} vente(s) depuis Sheets`);
      
      // Pour les ventes LOCALES : ne supprimer que celles synchronisées (synced_at != null)
      // Les ventes LOCALES non synchronisées (même avec status='pending') sont conservées car elles n'ont pas encore été envoyées à Sheets
      const syncedLocalSales = localSales.filter(s => s.synced_at !== null);
      const notSyncedLocalSales = localSales.filter(s => s.synced_at === null);
      
      // Pour les ventes SHEETS : toutes peuvent être supprimées si absentes de Sheets
      // Car si une vente SHEETS n'existe plus dans Sheets, elle a été supprimée et doit être supprimée localement aussi
      syncLogger.info(`   💡 [CLEANUP-SALES] Les ventes SHEETS absentes de Sheets seront supprimées`);
      syncLogger.info(`   💡 [CLEANUP-SALES] Les ventes LOCALES synchronisées (synced_at != null) absentes de Sheets seront supprimées`);
      syncLogger.info(`   💡 [CLEANUP-SALES] Les ventes LOCALES non synchronisées (synced_at = null) seront conservées (même si status='pending')`);
      syncLogger.info(`   📊 [CLEANUP-SALES] ${syncedLocalSales.length} vente(s) LOCALE(s) synchronisée(s) à vérifier`);
      syncLogger.info(`   📊 [CLEANUP-SALES] ${notSyncedLocalSales.length} vente(s) LOCALE(s) non synchronisée(s) conservée(s)`);
      
      let deletedLocal = 0;
      let deletedSheets = 0;
      let keptLocal = 0;
      let keptSheets = 0;
      
      // Nettoyer les ventes LOCALES synchronisées qui ne sont plus dans Sheets
      // Si une vente LOCALE a été synchronisée (synced_at != null) mais n'existe plus dans Sheets,
      // cela signifie qu'elle a été supprimée dans Sheets et doit être supprimée localement aussi
      syncLogger.info(`   🔍 [CLEANUP-SALES] Vérification de ${syncedLocalSales.length} vente(s) LOCALE(s) synchronisée(s)...`);
      for (const sale of syncedLocalSales) {
        const isInSheets = sheetsInvoices.has(sale.invoice_number);
        syncLogger.debug(`   🔍 [CLEANUP-SALES] Vente LOCALE ${sale.invoice_number} (ID: ${sale.id}, Status: ${sale.status}, Synced: ${sale.synced_at}): ${isInSheets ? '✅ Présente dans Sheets' : '❌ ABSENTE de Sheets → SUPPRESSION'}`);
        
        if (!isInSheets) {
          try {
            // IMPORTANT: Supprimer dans l'ordre pour respecter les contraintes de clés étrangères
            // 1. Supprimer les jobs d'impression associés (print_jobs référence invoice_number)
            const printJobsDeleted = db.prepare('DELETE FROM print_jobs WHERE invoice_number = ?').run(sale.invoice_number);
            // 2. Supprimer les paiements de dettes associés (si existent)
            const debtPaymentsDeleted = db.prepare('DELETE FROM debt_payments WHERE debt_id IN (SELECT id FROM debts WHERE sale_id = ?)').run(sale.id);
            // 3. Supprimer les dettes associées (FOREIGN KEY sans CASCADE)
            const debtsDeleted = db.prepare('DELETE FROM debts WHERE sale_id = ?').run(sale.id);
            // 4. Supprimer les annulations de vente (sale_voids) - devrait être CASCADE mais on le fait explicitement
            const voidsDeleted = db.prepare('DELETE FROM sale_voids WHERE sale_id = ?').run(sale.id);
            // 5. Supprimer les items de vente (CASCADE devrait le faire, mais on le fait explicitement)
            const itemsDeleted = db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(sale.id);
            // 6. Enfin, supprimer la vente elle-même
            db.prepare('DELETE FROM sales WHERE id = ?').run(sale.id);
            deletedLocal++;
            syncLogger.info(`   🗑️ [CLEANUP-SALES] ✅ Vente LOCALE synchronisée ${sale.invoice_number} (ID: ${sale.id}) supprimée (absente de Sheets)`);
            syncLogger.info(`      📋 ${itemsDeleted.changes || 0} item(s), ${debtsDeleted.changes || 0} dette(s), ${debtPaymentsDeleted.changes || 0} paiement(s) de dette, ${voidsDeleted.changes || 0} annulation(s), ${printJobsDeleted.changes || 0} job(s) d'impression supprimé(s)`);
          } catch (deleteError) {
            syncLogger.warn(`   ⚠️ [CLEANUP-SALES] Erreur suppression vente LOCALE ${sale.invoice_number} (ID: ${sale.id}): ${deleteError.message}`);
            syncLogger.warn(`      📋 Stack: ${deleteError.stack?.substring(0, 300)}`);
          }
        } else {
          keptLocal++;
        }
      }
      
      // Nettoyer les ventes SHEETS absentes de Sheets
      // Si une vente SHEETS n'existe plus dans Sheets, elle a été supprimée et doit être supprimée localement
      syncLogger.info(`   🔍 [CLEANUP-SALES] Vérification de ${sheetsSales.length} vente(s) SHEETS...`);
      for (const sale of sheetsSales) {
        const isInSheets = sheetsInvoices.has(sale.invoice_number);
        syncLogger.debug(`   🔍 [CLEANUP-SALES] Vente SHEETS ${sale.invoice_number} (ID: ${sale.id}): ${isInSheets ? '✅ Présente dans Sheets' : '❌ ABSENTE de Sheets → SUPPRESSION'}`);
        
        if (!isInSheets) {
          try {
            // IMPORTANT: Supprimer dans l'ordre pour respecter les contraintes de clés étrangères
            // 1. Supprimer les jobs d'impression associés (print_jobs référence invoice_number)
            const printJobsDeleted = db.prepare('DELETE FROM print_jobs WHERE invoice_number = ?').run(sale.invoice_number);
            // 2. Supprimer les paiements de dettes associés (si existent)
            const debtPaymentsDeleted = db.prepare('DELETE FROM debt_payments WHERE debt_id IN (SELECT id FROM debts WHERE sale_id = ?)').run(sale.id);
            // 3. Supprimer les dettes associées (FOREIGN KEY sans CASCADE)
            const debtsDeleted = db.prepare('DELETE FROM debts WHERE sale_id = ?').run(sale.id);
            // 4. Supprimer les annulations de vente (sale_voids) - devrait être CASCADE mais on le fait explicitement
            const voidsDeleted = db.prepare('DELETE FROM sale_voids WHERE sale_id = ?').run(sale.id);
            // 5. Supprimer les items de vente (CASCADE devrait le faire, mais on le fait explicitement)
            const itemsDeleted = db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(sale.id);
            // 6. Enfin, supprimer la vente elle-même
            db.prepare('DELETE FROM sales WHERE id = ?').run(sale.id);
            deletedSheets++;
            syncLogger.info(`   🗑️ [CLEANUP-SALES] ✅ Vente SHEETS ${sale.invoice_number} (ID: ${sale.id}) supprimée (absente de Sheets)`);
            syncLogger.info(`      📋 ${itemsDeleted.changes || 0} item(s), ${debtsDeleted.changes || 0} dette(s), ${debtPaymentsDeleted.changes || 0} paiement(s) de dette, ${voidsDeleted.changes || 0} annulation(s), ${printJobsDeleted.changes || 0} job(s) d'impression supprimé(s)`);
          } catch (deleteError) {
            syncLogger.warn(`   ⚠️ [CLEANUP-SALES] Erreur suppression vente SHEETS ${sale.invoice_number} (ID: ${sale.id}): ${deleteError.message}`);
            syncLogger.warn(`      📋 Stack: ${deleteError.stack?.substring(0, 300)}`);
          }
        } else {
          keptSheets++;
        }
      }
      
      syncLogger.info(`   ✅ [CLEANUP-SALES] Nettoyage terminé:`);
      syncLogger.info(`      🗑️ ${deletedLocal} vente(s) LOCALE(s) synchronisée(s) supprimée(s) (absentes de Sheets)`);
      syncLogger.info(`      🗑️ ${deletedSheets} vente(s) SHEETS supprimée(s) (absentes de Sheets)`);
      syncLogger.info(`      ✅ ${keptLocal} vente(s) LOCALE(s) synchronisée(s) conservée(s) (présentes dans Sheets)`);
      syncLogger.info(`      ✅ ${keptSheets} vente(s) SHEETS conservée(s) (présentes dans Sheets)`);
      syncLogger.info(`      ⏭️ ${notSyncedLocalSales.length} vente(s) LOCALE(s) non synchronisée(s) conservée(s) (seront synchronisées plus tard)`);
      
      // Vérification finale : compter les ventes restantes
      const remainingSales = db.prepare('SELECT COUNT(*) as count FROM sales WHERE status != ?').get('pending');
      syncLogger.info(`      📊 Total ventes restantes (hors pending): ${remainingSales.count}`);
      
      if (deletedLocal > 0 || deletedSheets > 0) {
        syncLogger.info(`   🎉 [CLEANUP-SALES] ✅ Nettoyage réussi: ${deletedLocal + deletedSheets} vente(s) supprimée(s) qui n'existent plus dans Sheets`);
        syncLogger.info(`   💡 [CLEANUP-SALES] Ces ventes ne seront plus affichées dans la page "Historique des ventes"`);
      }
      
      syncLogger.info(`🧹 [CLEANUP-SALES] ==========================================`);
    } catch (error) {
      syncLogger.warn(`   ⚠️ [CLEANUP-SALES] Erreur globale: ${error.message}`);
      
      // Marquer comme hors ligne si erreur réseau
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        syncLogger.warn(`   🌐 [CLEANUP-SALES] Connexion Internet perdue détectée`);
        isOnline = false;
      }
      
      // Ne pas bloquer si erreur (peut être hors ligne)
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
      // Pas de connexion ou timeout
      if (isOnline && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout'))) {
        syncLogger.warn('⚠️ [INTERNET] Connexion Internet perdue, synchronisation en attente');
        isOnline = false;
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
    syncLogger.info('Worker de synchronisation arrêté');
    syncLogger.info('💰 [SALES-SYNC] Synchronisation dédiée des ventes arrêtée');
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

      if (pending.length === 0) {
        syncLogger.debug(`📭 [PUSH] Aucune opération en attente`);
        return;
      }

      syncLogger.info(`📤 [PUSH] ==========================================`);
      syncLogger.info(`📤 [PUSH] PUSH DE ${pending.length} OPÉRATION(S) VERS SHEETS`);
      syncLogger.info(`📤 [PUSH] ==========================================`);
      
      // LOG: Détails des opérations update_stock
      const stockUpdates = pending.filter(op => op.op === 'update_stock');
      if (stockUpdates.length > 0) {
        syncLogger.info(`📦 [PUSH] ${stockUpdates.length} opération(s) update_stock trouvée(s):`);
        stockUpdates.forEach((op, idx) => {
          const payload = JSON.parse(op.payload_json || JSON.stringify(op.payload || {}));
          syncLogger.info(`   [${idx + 1}] Produit: ${payload.product_code}`);
          syncLogger.info(`       Unité: ${payload.unit_level}, Mark: ${payload.unit_mark || '(vide)'}`);
          if (payload.stock_absolute !== undefined) {
            syncLogger.info(`       Stock ABSOLU: ${payload.stock_absolute} (écrasera colonne C dans Sheets)`);
          }
          if (payload.stock_change !== undefined) {
            syncLogger.info(`       Stock change (relatif): ${payload.stock_change}`);
          }
          syncLogger.info(`       Invoice: ${payload.invoice_number || '(vide)'}`);
        });
      }

      // Préparer les ops pour batch
      const ops = pending.map(op => ({
        op_id: op.id,
        entity: op.entity,
        entity_id: op.entity_id,
        op: op.op,
        payload: JSON.parse(op.payload_json || JSON.stringify(op.payload || {}))
      }));

      syncLogger.info(`📤 [PUSH] Envoi du batch vers Google Sheets...`);
      
      // Essayer batch d'abord, sinon fallback en concurrence limitée
      const batchResult = await sheetsClient.pushBatch(ops, { timeout: 9000 });

      // Traiter les résultats
      syncLogger.info(`📤 [PUSH] Résultat du batch:`);
      syncLogger.info(`   Success: ${batchResult.success}`);
      syncLogger.info(`   Applied: ${batchResult.applied?.length || 0} opération(s)`);
      syncLogger.info(`   Conflicts: ${batchResult.conflicts?.length || 0} conflit(s)`);
      if (batchResult.error) {
        syncLogger.error(`   Erreur: ${batchResult.error}`);
      }
      
      if (batchResult.applied) {
        const appliedStockUpdates = batchResult.applied.filter(applied => {
          const op = ops.find(o => o.op_id === applied.op_id);
          return op && op.op === 'update_stock';
        });
        
        if (appliedStockUpdates.length > 0) {
          syncLogger.info(`✅ [PUSH] ${appliedStockUpdates.length} opération(s) update_stock appliquée(s) avec succès dans Sheets`);
        }
        
        for (const applied of batchResult.applied) {
          syncRepo.markAsSent(applied.op_id);
        }
        syncLogger.info(`   ✅ [PUSH] ${batchResult.applied.length} opération(s) appliquée(s)`);
      }

      if (batchResult.conflicts && batchResult.conflicts.length > 0) {
        for (const conflict of batchResult.conflicts) {
          syncRepo.markAsError(conflict.op_id, new Error(conflict.error || 'Conflit'));
        }
        syncLogger.warn(`   ⚠️  [PUSH] ${batchResult.conflicts.length} conflit(s)`);
      }

            // Si erreur réseau, marquer comme hors ligne
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
    if (isUsersEmpty) {
      syncLogger.warn(`⚠️  [BOOTSTRAP AUTO] Table users vide détectée (${usersCount} utilisateur(s)) → Forcer import complet pour users`);
    } else {
      // Même si la base n'est pas vide, forcer un import complet pour récupérer TOUS les utilisateurs
      // Cela garantit que tous les utilisateurs (anciens et nouveaux) sont synchronisés
      syncLogger.info(`👥 [USERS] Base contient ${usersCount} utilisateur(s) → Import complet pour récupérer TOUS les utilisateurs (anciens et nouveaux)`);
    }

    const globalStartTime = Date.now();
    syncLogger.info(`🔄 Début pull depuis Google Sheets${isInitialImport ? ' (BOOTSTRAP/FULL - TOUT EN UNE FOIS)' : ' (synchronisation incrémentale)'}`);
    syncLogger.info(`   ⏰ Début: ${new Date().toISOString()}`);
    syncLogger.info(`   📋 Téléchargement de TOUTES les feuilles: Products (Carton/Piece/Milliers), Sales, Debts, Rates, Users`);

    try {
      const entities = ['users', 'rates', 'debts', 'products', 'sales'];
      const results = [];
      
      // Construire sinceMap pour tous
      const sinceMap = {};
      syncLogger.info(`   📅 [SYNC] Dates 'since' utilisées pour chaque entité:`);
      for (const e of entities) {
        const lastPullDate = syncRepo.getLastPullDate(e);
        
        // Vérifier si la base est vide pour cette entité
        // Pour les utilisateurs, TOUJOURS forcer un import complet pour récupérer TOUS les utilisateurs
        let forceFullImport = isInitialImport;
        if (e === 'users') {
          forceFullImport = true; // TOUJOURS récupérer tous les utilisateurs
          syncLogger.info(`   👥 [USERS] Import complet forcé → Récupération de TOUS les utilisateurs (date since = 1970)`);
        }
        
        // Si bootstrap/full import ou base vide → date très ancienne (1970)
        sinceMap[e] = forceFullImport ? new Date(0).toISOString() : (lastPullDate || new Date(0).toISOString());
        const sinceDate = new Date(sinceMap[e]);
        syncLogger.info(`      - ${e.toUpperCase()}: ${sinceMap[e]} (${sinceDate.toLocaleString('fr-FR')})${forceFullImport ? ' 🚀 BOOTSTRAP/FULL' : (!lastPullDate ? ' ⚠️ AUCUNE DATE PRÉCÉDENTE - Import complet' : '')}`);
      }
      
      // Mode PRO: Full import paginé si initial, sinon incrémental
      if (isInitialImport) {
        syncLogger.info(`   🚀 [FULL IMPORT] Mode paginé activé pour import complet`);
        
        // 1) Légers (users, rates, debts) - pas de pagination nécessaire
        const lightEntities = ['users', 'rates', 'debts'];
        syncLogger.info(`   ⚡ [FULL IMPORT] Pull des entités légères: ${lightEntities.join(', ')}`);
        
        for (const entity of lightEntities) {
          const entityStartTime = Date.now();
          try {
            if (entity === 'users') {
              syncLogger.info(`   👥 [USERS] Début pull depuis Google Sheets...`);
              syncLogger.info(`   👥 [USERS] Since date: ${sinceMap[entity]}`);
            }
            
            const result = await sheetsClient.pullAllPaged(entity, sinceMap[entity], {
              full: true,
              maxRetries: 8,
              timeout: 30000
            });
            
            if (entity === 'users') {
              syncLogger.info(`   👥 [USERS] Résultat pull: success=${result.success}, data.length=${result.data?.length || 0}`);
              if (result.error) {
                syncLogger.error(`   👥 [USERS] Erreur pull: ${result.error}`);
              }
              if (result.data && result.data.length > 0) {
                syncLogger.info(`   👥 [USERS] Premier utilisateur reçu:`, JSON.stringify(result.data[0]).substring(0, 200));
              }
            }
            
            if (result.success && result.data.length > 0) {
              syncLogger.info(`   ✅ [${entity.toUpperCase()}] ${result.data.length} item(s) téléchargé(s) en ${Date.now() - entityStartTime}ms`);
              await this.applyUpdates(entity, result.data);
              syncRepo.setLastPullDate(entity, new Date().toISOString());
              results.push({ entity, success: true, data: result.data, duration: Date.now() - entityStartTime });
            } else {
              syncLogger.warn(`   ⏭️  [${entity.toUpperCase()}] Aucune donnée ou erreur`);
              if (entity === 'users' && result.error) {
                syncLogger.error(`   👥 [USERS] Détails erreur:`, result.error);
              }
              results.push({ entity, success: result.success, data: result.data || [], error: result.error, skipped: !result.success });
            }
          } catch (error) {
            syncLogger.error(`   ❌ [${entity.toUpperCase()}] Erreur: ${error.message}`);
            if (entity === 'users') {
              syncLogger.error(`   👥 [USERS] Stack trace:`, error.stack);
            }
            results.push({ entity, success: false, data: [], error: error.message, skipped: true });
          }
        }
        
        // 2) Products - paginé par unit_level (Carton, Milliers, Piece)
        syncLogger.info(`   📦 [FULL IMPORT] Pull paginé Products (Carton, Milliers, Piece)...`);
        const productUnitLevels = ['CARTON', 'MILLIER', 'PIECE'];
        const allProducts = [];
        
        for (const unitLevel of productUnitLevels) {
          const unitStartTime = Date.now();
          syncLogger.info(`   📄 [PRODUCTS] Feuille: ${unitLevel}`);
          
          try {
            const cursor = syncRepo.getCursor('products', unitLevel);
            const result = await sheetsClient.pullAllPaged('products', sinceMap['products'], {
              full: true,
              unitLevel: unitLevel,
              startCursor: cursor,
              maxRetries: 8,
              timeout: 30000,
              limit: 300
            });
            
            if (result.success) {
              allProducts.push(...result.data);
              syncLogger.info(`   ✅ [PRODUCTS/${unitLevel}] ${result.data.length} produit(s) en ${Date.now() - unitStartTime}ms`);
              syncRepo.setCursor('products', result.last_cursor || null, unitLevel);
            } else {
              syncLogger.warn(`   ⚠️ [PRODUCTS/${unitLevel}] Erreur: ${result.error}`);
            }
          } catch (error) {
            syncLogger.error(`   ❌ [PRODUCTS/${unitLevel}] Erreur: ${error.message}`);
          }
        }
        
        // Grouper products par code et appliquer
        if (allProducts.length > 0) {
          syncLogger.info(`   📦 [PRODUCTS] Total: ${allProducts.length} produit(s) à appliquer`);
          try {
            await this.applyUpdates('products', allProducts);
            syncRepo.setLastPullDate('products', new Date().toISOString());
            if (!syncRepo.isInitialImportDone()) {
              syncRepo.setInitialImportDone();
              syncLogger.info(`   🎉 [IMPORT] Import initial terminé avec succès (${allProducts.length} produit(s))`);
            }
            results.push({ entity: 'products', success: true, data: allProducts, duration: 0 });
          } catch (applyError) {
            syncLogger.error(`   ❌ [PRODUCTS] Erreur application: ${applyError.message}`);
            results.push({ entity: 'products', success: false, data: [], error: applyError.message, skipped: true });
          }
        }
        
        // 3) Sales - paginé
        syncLogger.info(`   💰 [FULL IMPORT] Pull paginé Sales...`);
        const salesStartTime = Date.now();
        try {
          const cursor = syncRepo.getCursor('sales');
          const cursorStr = cursor ? String(cursor) : null;
          syncLogger.info(`   📍 [SALES] Cursor: ${cursorStr ? (cursorStr.length > 50 ? cursorStr.substring(0, 50) + '...' : cursorStr) : 'null (début)'}`);
          
          const result = await sheetsClient.pullAllPaged('sales', sinceMap['sales'], {
            full: true,
            startCursor: cursor,
            maxRetries: 8,
            timeout: 30000,
            limit: 300
          });
          
          syncLogger.info(`   📊 [SALES] Résultat pullAllPaged:`);
          syncLogger.info(`      ✅ Success: ${result.success}`);
          syncLogger.info(`      📦 Data length: ${result.data ? result.data.length : 0} ligne(s)`);
          syncLogger.info(`      📍 Next cursor: ${result.last_cursor || 'null (fin)'}`);
          syncLogger.info(`      ✅ Done: ${result.done ? 'true' : 'false'}`);
          
          if (result.success && result.data && result.data.length > 0) {
            syncLogger.info(`   ✅ [SALES] ${result.data.length} ligne(s) téléchargée(s) en ${Date.now() - salesStartTime}ms`);
            syncLogger.info(`   🔄 [SALES] Application dans SQLite...`);
            
            // Vérification avant application
            let salesCountBefore = 0;
            try {
              const { getDb } = await import('../../db/sqlite.js');
              const db = getDb();
              const countResult = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('SHEETS');
              salesCountBefore = countResult?.count || 0;
              syncLogger.info(`   🔍 [SALES] Ventes avant application: ${salesCountBefore}`);
            } catch (countError) {
              syncLogger.warn(`   ⚠️  [SALES] Erreur comptage avant: ${countError.message}`);
            }
            
            try {
              const applyResult = await this.applyUpdates('sales', result.data);
              syncLogger.info(`   ✅ [SALES] Application terminée: ${applyResult.inserted || 0} créée(s), ${applyResult.updated || 0} mise(s) à jour`);
              
              // Vérification après application
              let salesCountAfter = 0;
              try {
                const { getDb } = await import('../../db/sqlite.js');
                const db = getDb();
                const countResult = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('SHEETS');
                salesCountAfter = countResult?.count || 0;
                syncLogger.info(`   🔍 [SALES] Ventes après application: ${salesCountAfter}`);
                
                const newSales = salesCountAfter - salesCountBefore;
                if (newSales > 0) {
                  syncLogger.info(`   ✅ [SALES] ${newSales} nouvelle(s) vente(s) ajoutée(s) avec succès!`);
                } else if (applyResult.inserted > 0 || applyResult.updated > 0) {
                  syncLogger.warn(`   ⚠️  [SALES] Des ventes ont été traitées mais le nombre total n'a pas changé`);
                }
              } catch (countError) {
                syncLogger.warn(`   ⚠️  [SALES] Erreur comptage après: ${countError.message}`);
              }
              
              syncRepo.setLastPullDate('sales', new Date().toISOString());
              syncRepo.setCursor('sales', result.last_cursor || null);
              results.push({ entity: 'sales', success: true, data: result.data, duration: Date.now() - salesStartTime });
            } catch (applyError) {
              syncLogger.error(`   ❌ [SALES] ERREUR lors de l'application: ${applyError.message}`);
              syncLogger.error(`   📋 [SALES] Stack: ${applyError.stack?.substring(0, 500)}`);
              results.push({ entity: 'sales', success: false, data: [], error: applyError.message, skipped: true });
            }
          } else if (result.success) {
            syncLogger.warn(`   ⏭️ [SALES] Aucune donnée retournée (0 ligne)`);
            syncLogger.warn(`   💡 [SALES] Raisons possibles:`);
            syncLogger.warn(`      - Feuille "Ventes" vide dans Google Sheets`);
            syncLogger.warn(`      - Toutes les ventes filtrées par date`);
            syncLogger.warn(`      - Cursor invalide`);
            results.push({ entity: 'sales', success: true, data: [], error: 'Aucune donnée', skipped: false });
          } else {
            syncLogger.error(`   ❌ [SALES] Erreur lors du pull: ${result.error || 'Erreur inconnue'}`);
            results.push({ entity: 'sales', success: false, data: [], error: result.error, skipped: true });
          }
        } catch (error) {
          syncLogger.error(`   ❌ [SALES] Erreur: ${error.message}`);
          syncLogger.error(`   📋 [SALES] Stack: ${error.stack?.substring(0, 500)}`);
          results.push({ entity: 'sales', success: false, data: [], error: error.message, skipped: true });
        }
        
      } else {
        // Mode incrémental normal (rapide)
        syncLogger.info(`   🔄 [SYNC INCRÉMENTALE] Mode rapide (depuis lastPullDate)`);
        
        // Pour les utilisateurs, TOUJOURS forcer un import complet même en mode incrémental
        // Cela garantit que tous les utilisateurs (anciens et nouveaux) sont récupérés
        syncLogger.info(`   👥 [USERS] Import complet forcé même en mode incrémental → Récupération de TOUS les utilisateurs`);
        sinceMap['users'] = new Date(0).toISOString();
        
        // Pull en parallèle limité (légers d'abord)
        const lightEntities = ['users', 'rates', 'debts'];
        // Sales exclu: synchronisé séparément toutes les 10s avec pagination via startSalesSyncLoop()
        const heavyEntities = ['products'];
        
        syncLogger.info(`   ⚡ [SYNC] Pull parallèle des entités légères: ${lightEntities.join(', ')}`);
        if (isUsersEmpty) {
          syncLogger.info(`   👥 [USERS] Date 'since' forcée à 1970 pour import complet: ${sinceMap['users']}`);
        }
        const lightResults = await sheetsClient.pullMany(lightEntities, sinceMap, { 
          maxRetries: 1 
        });
        
        // Appliquer immédiatement les résultats légers
        for (const r of lightResults) {
          if (r.success && r.data && r.data.length > 0) {
            syncLogger.info(`   ✅ [${r.entity.toUpperCase()}] ${r.data.length} item(s) téléchargé(s)`);
            try {
              await this.applyUpdates(r.entity, r.data);
              // Utiliser max_updated_at si disponible
              const maxUpdated = r.data.reduce((max, item) => {
                const itemDate = item._remote_updated_at || item.last_update || item.created_at || item.sold_at;
                if (itemDate) {
                  const d = new Date(itemDate);
                  return !max || d > max ? d : max;
                }
                return max;
              }, null);
              syncRepo.setLastPullDate(r.entity, maxUpdated ? maxUpdated.toISOString() : new Date().toISOString());
              results.push({ entity: r.entity, success: true, data: r.data, duration: 0 });
            } catch (applyError) {
              syncLogger.error(`   ❌ [${r.entity.toUpperCase()}] Erreur application: ${applyError.message}`);
              results.push({ entity: r.entity, success: false, data: [], error: applyError.message, skipped: true });
            }
          } else if (r.success) {
            syncLogger.info(`   ℹ️  [${r.entity.toUpperCase()}] Aucune donnée (0 item)`);
            syncRepo.setLastPullDate(r.entity, new Date().toISOString());
            results.push({ entity: r.entity, success: true, data: [], duration: 0 });
          } else {
            syncLogger.warn(`   ⏭️  [${r.entity.toUpperCase()}] Skip: ${r.error || 'Erreur'}`);
            results.push({ entity: r.entity, success: false, data: [], error: r.error, skipped: true });
          }
        }
        
        // Puis les lourds en séquentiel (avec timeout court)
        for (const entity of heavyEntities) {
        const entityStartTime = Date.now();
        let attempt = 0;
        
        // Backoff exponentiel : 1s, 2s, 4s, 8s, ... max 60s
        const getRetryDelay = (attemptNum) => {
          const delay = Math.min(60_000, 1000 * Math.pow(2, attemptNum - 1));
          return delay;
        };
        
        while (true) {
          attempt++;
          try {
            const lastSync = isInitialImport ? new Date(0) : syncRepo.getLastPullDate(entity);
            const sinceDate = lastSync ? (typeof lastSync === 'string' ? lastSync : lastSync.toISOString()) : new Date(0).toISOString();
            
            if (attempt === 1) {
              syncLogger.info(`📥 [${entity.toUpperCase()}] Début téléchargement depuis Google Sheets`);
              syncLogger.info(`   📅 [${entity.toUpperCase()}] Date 'since' utilisée: ${sinceDate} (${new Date(sinceDate).toLocaleString('fr-FR')})`);
              syncLogger.info(`   🔍 [${entity.toUpperCase()}] Mode: ${isInitialImport ? 'IMPORT INITIAL (toutes les données)' : 'SYNC INCRÉMENTALE (depuis lastPullDate)'}`);
            } else {
              syncLogger.info(`📥 [${entity.toUpperCase()}] Tentative ${attempt}${isInitialImport ? ' (retry infini activé)' : ''}`);
            }
            
            // Timeout depuis ENV ou valeurs par défaut (PRO : utilise les variables d'environnement)
            const envTimeout = parseInt(process.env.SYNC_TIMEOUT_MS || '30000', 10);
            const timeouts = {
              products: isInitialImport ? 60_000 : parseInt(process.env.SHEETS_TIMEOUT_PRODUCTS_MS || envTimeout.toString(), 10),
              sales: isInitialImport ? 60_000 : parseInt(process.env.SHEETS_TIMEOUT_SALES_MS || envTimeout.toString(), 10),
            };
            const timeout = timeouts[entity] || envTimeout;
            syncLogger.info(`   ⏱️  [${entity.toUpperCase()}] Timeout configuré: ${timeout}ms (${isInitialImport ? 'IMPORT INITIAL' : 'SYNC NORMALE'}) depuis ENV: ${process.env.SYNC_TIMEOUT_MS || 'défaut'}`);
            
            const result = await sheetsClient.pull(entity, sinceDate, {
              maxRetries: isInitialImport ? 2 : 1,
              retryDelay: 400,
              timeout: timeout
            });
            
            const pullDuration = Date.now() - entityStartTime;
            
            if (result.success) {
              if (result.data && result.data.length > 0) {
                syncLogger.info(`   ✅ [${entity.toUpperCase()}] ${result.data.length} item(s) téléchargé(s) en ${pullDuration}ms`);
                
                // Logs détaillés pour les ventes (toujours affichés pour debug)
                if (entity === 'sales' && result.data.length > 0) {
                  syncLogger.info(`   📋 [SALES] Détail des lignes téléchargées depuis Sheets:`);
                  const invoiceCounts = {};
                  result.data.forEach(item => {
                    const inv = item.invoice_number || 'N/A';
                    invoiceCounts[inv] = (invoiceCounts[inv] || 0) + 1;
                  });
                  const uniqueInvoices = Object.keys(invoiceCounts).length;
                  syncLogger.info(`   📊 [SALES] ${result.data.length} ligne(s) → ${uniqueInvoices} facture(s) unique(s) détectée(s)`);
                  
                  // Afficher les 5 premières factures pour debug
                  result.data.slice(0, 5).forEach((sale, index) => {
                    syncLogger.info(`      [${index + 1}] Facture: ${sale.invoice_number || 'N/A'}, Client: ${sale.client_name || 'N/A'}, Produit: ${sale.product_code || 'N/A'}, Qty: ${sale.qty || 0}`);
                  });
                  if (result.data.length > 5) {
                    syncLogger.info(`      ... et ${result.data.length - 5} autre(s) ligne(s)`);
                  }
                }
                
                // Logs détaillés pour produits uniquement si VERBOSE
                const VERBOSE = process.env.SYNC_VERBOSE === '1';
                if (VERBOSE && entity === 'products' && result.data.length > 0) {
                  syncLogger.info(`   📋 Détail produits: ${result.data.length} produit(s)`);
                  result.data.slice(0, 3).forEach((product, index) => {
                    const unitsCount = product.units ? product.units.length : 0;
                    syncLogger.info(`      [${index + 1}] Code: "${product.code || 'N/A'}", Nom: "${product.name || 'N/A'}", Unités: ${unitsCount}`);
                  });
                }
                
                // APPLIQUER IMMÉDIATEMENT après téléchargement réussi (pas d'attente)
                try {
                  const applyStartTime = Date.now();
                  const upsertStats = await this.applyUpdates(entity, result.data);
                  const applyDuration = Date.now() - applyStartTime;
                  
                  syncRepo.setLastPullDate(entity, new Date().toISOString());
                  
                  // Si Products a réussi et c'était un import initial, marquer comme fait
                  if (entity === 'products' && isInitialImport && !syncRepo.isInitialImportDone()) {
                    syncRepo.setInitialImportDone();
                    syncLogger.info(`   🎉 [IMPORT] Import initial terminé avec succès (${result.data.length} produit(s))`);
                  }
                  
                  // Logs optimisés avec détails spécifiques pour les ventes
                  if (upsertStats) {
                    if (entity === 'sales') {
                      syncLogger.info(`   ✅ [SALES] Stockage SQL réussi: ${upsertStats.inserted || 0} facture(s) créée(s), ${upsertStats.updated || 0} facture(s) mise(s) à jour (${applyDuration}ms)`);
                      syncLogger.info(`   📱 [SALES] Les ventes sont maintenant disponibles dans la page "Historique des ventes"`);
                    } else {
                      syncLogger.info(`   ✅ [${entity.toUpperCase()}] ${result.data.length} item(s) → SQL: ${upsertStats.inserted || 0} inséré(s), ${upsertStats.updated || 0} mis à jour, ${upsertStats.skipped || 0} ignoré(s) (${applyDuration}ms)`);
                    }
                  } else {
                    syncLogger.info(`   ✅ [${entity.toUpperCase()}] ${result.data.length} item(s) appliqué(s) en ${applyDuration}ms`);
                  }
                } catch (applyError) {
                  syncLogger.error(`   ❌ [${entity.toUpperCase()}] Erreur application SQL: ${applyError.message}`);
                  // Continuer quand même, on a réussi le téléchargement
                }
                
                results.push({ entity, success: true, data: result.data, duration: pullDuration });
                break; // Succès, sortir de la boucle de retry
              } else {
                syncLogger.warn(`   ⚠️  [${entity.toUpperCase()}] Aucune donnée retournée (0 item)`);
                syncLogger.warn(`   🔍 [${entity.toUpperCase()}] Diagnostic détaillé:`);
                syncLogger.warn(`      - Date 'since' utilisée: ${sinceDate} (${new Date(sinceDate).toLocaleString('fr-FR')})`);
                syncLogger.warn(`      - Mode: ${isInitialImport ? 'IMPORT INITIAL (devrait retourner toutes les données)' : 'SYNC INCRÉMENTALE (seulement les données modifiées depuis lastPullDate)'}`);
                syncLogger.warn(`      - Si sync incrémentale: Vérifier que lastPullDate n'est pas trop récent`);
                syncLogger.warn(`      - Si import initial: Vérifier que les données existent dans Google Sheets`);
                syncLogger.warn(`      - ⚠️  ATTENTION: lastPullDate sera mis à jour même si 0 items → risque de ne jamais récupérer les données`);
                
                // IMPORTANT: Ne pas mettre à jour lastPullDate si 0 items en sync incrémentale
                // (sinon on ne récupérera jamais les données)
                if (!isInitialImport) {
                  syncLogger.warn(`      - ⏭️  [${entity.toUpperCase()}] Ne pas mettre à jour lastPullDate (0 items, sync incrémentale)`);
                } else {
                  // Pour import initial, mettre à jour quand même (mais c'est suspect)
                  syncLogger.warn(`      - ⚠️  [${entity.toUpperCase()}] Import initial avec 0 items - Vérifier les données dans Sheets`);
                  syncRepo.setLastPullDate(entity, new Date().toISOString());
                }
                
                results.push({ entity, success: true, data: [], duration: pullDuration });
                break; // Succès (mais vide), sortir de la boucle de retry
              }
            } else {
              // Erreur dans la réponse
              syncLogger.error(`   ❌ [${entity.toUpperCase()}] Échec tentative ${attempt}: ${result.error || 'Erreur inconnue'}`);
              
              // Si import initial, retry infini avec backoff exponentiel
              if (isInitialImport) {
                const delay = getRetryDelay(attempt);
                syncLogger.info(`   🔄 Retry dans ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; // Réessayer indéfiniment
              } else {
                // Pour sync normale, max 1 tentative (skip rapidement)
                syncLogger.warn(`   ⏭️  [${entity.toUpperCase()}] Skip après erreur (sync normale, pas de retry)`);
                syncLogger.warn(`   💡 [${entity.toUpperCase()}] Sera réessayé au prochain cycle de sync (dans 10s)`);
                results.push({ entity, success: false, data: [], error: result.error, duration: Date.now() - entityStartTime, skipped: true });
                break; // Skip immédiatement pour sync normale
              }
            }
          } catch (error) {
            const errorDuration = Date.now() - entityStartTime;
            const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
            
            if (isTimeout) {
              syncLogger.warn(`   ⏱️  [${entity.toUpperCase()}] Timeout après ${(errorDuration / 1000).toFixed(1)}s`);
            } else {
            syncLogger.error(`   ❌ [${entity.toUpperCase()}] Erreur tentative ${attempt} après ${errorDuration}ms: ${error.message}`);
            }
            
            // Si import initial, retry infini avec backoff exponentiel
            if (isInitialImport) {
              const delay = getRetryDelay(attempt);
              syncLogger.info(`   🔄 Retry dans ${delay / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue; // Réessayer indéfiniment
            } else {
              // Pour sync normale : skip rapidement si timeout (pas de retry)
              if (isTimeout) {
                syncLogger.warn(`   ⏭️  [${entity.toUpperCase()}] Skip après timeout (sync normale, pas de retry)`);
                syncLogger.warn(`   💡 [${entity.toUpperCase()}] Sera réessayé au prochain cycle de sync (dans 10s)`);
                results.push({ entity, success: false, data: [], error: `Timeout après ${(errorDuration / 1000).toFixed(1)}s`, duration: errorDuration, skipped: true });
                break; // Skip immédiatement pour sync normale
              }
              
              // Pour autres erreurs, max 2 tentatives (pas 3)
              if (attempt >= 2) {
                syncLogger.warn(`   ⏭️  [${entity.toUpperCase()}] Skip après ${attempt} tentative(s) (sync normale)`);
                results.push({ entity, success: false, data: [], error: error.message, duration: errorDuration, skipped: true });
                break; // Échec après 2 tentatives
              }
              const delay = getRetryDelay(attempt);
              syncLogger.info(`   🔄 Retry dans ${delay / 1000}s...`);
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
      
      // Résumé final (les données ont déjà été appliquées au fur et à mesure)
      const totalItems = results.reduce((sum, r) => sum + (r.data?.length || 0), 0);
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success && !r.skipped).length;
      const skippedCount = results.filter(r => r.skipped).length;
      const totalDuration = Date.now() - globalStartTime;
      
      // Compter spécifiquement les ventes pour le résumé
      const salesResult = results.find(r => r.entity === 'sales');
      const salesCount = salesResult?.data?.length || 0;
      
      syncLogger.info(`✅ [SYNC] Synchronisation terminée en ${(totalDuration / 1000).toFixed(1)}s`);
      syncLogger.info(`   📊 [SYNC] Résumé global:`);
      syncLogger.info(`      ✅ ${successCount}/${entities.length} entité(s) synchronisée(s) avec succès`);
      if (skippedCount > 0) {
        syncLogger.info(`      ⏭️  ${skippedCount}/${entities.length} entité(s) skipée(s) (sera réessayé au prochain cycle)`);
      }
      if (failedCount > 0) {
        syncLogger.warn(`      ❌ ${failedCount}/${entities.length} entité(s) en échec`);
      }
      syncLogger.info(`      📦 ${totalItems} item(s) téléchargé(s) et STOCKÉ(S) dans SQLite`);
      if (salesCount > 0 && salesResult?.success) {
        syncLogger.info(`      💰 [SALES] ${salesCount} ligne(s) de vente téléchargée(s) depuis Sheets`);
        syncLogger.info(`      📄 [SALES] ✅ Ventes stockées dans SQLite → Disponibles dans la page "Historique des ventes"`);
        syncLogger.info(`      💡 [SALES] Pour voir toutes les ventes: Menu → Historique → Ajuster les dates (Du/Au)`);
      }
      
      if (skippedCount > 0) {
        results.filter(r => r.skipped).forEach(r => {
          syncLogger.info(`      ⏭️  ${r.entity}: ${r.error || 'Skip'}`);
        });
        syncLogger.info(`   🔄 [SYNC] Entités skipées seront réessayées dans ${SYNC_INTERVAL_MS / 1000} secondes`);
      }
      
      if (failedCount > 0) {
        syncLogger.warn(`   ⚠️  [SYNC] ${failedCount} entité(s) n'ont pas pu être synchronisée(s)`);
        results.filter(r => !r.success && !r.skipped).forEach(r => {
          syncLogger.warn(`      ❌ ${r.entity}: ${r.error || 'Erreur inconnue'}`);
        });
      }
      
      if (totalDuration < 30000) {
        syncLogger.info(`   ⚡ [SYNC] Synchronisation RAPIDE (< 30s) ✅`);
      } else {
        syncLogger.warn(`   ⚠️  [SYNC] Synchronisation lente (${(totalDuration / 1000).toFixed(1)}s) - vérifier la connexion`);
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
    const applyStartTime = Date.now();
    try {
      syncLogger.info(`⚙️  [APPLY-UPDATES] ==========================================`);
      syncLogger.info(`⚙️  [APPLY-UPDATES] Application des mises à jour pour ${entity}`);
      syncLogger.info(`⚙️  [APPLY-UPDATES] ==========================================`);
      syncLogger.info(`   📦 Données reçues: ${data ? data.length : 0} item(s)`);
      syncLogger.info(`   📋 Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
      
      // Validation des données
      if (!data) {
        syncLogger.error(`   ❌ [APPLY-UPDATES] ERREUR: data est null ou undefined`);
        return { inserted: 0, updated: 0, skipped: 0 };
      }
      
      if (!Array.isArray(data)) {
        syncLogger.error(`   ❌ [APPLY-UPDATES] ERREUR: data n'est pas un tableau (type: ${typeof data})`);
        return { inserted: 0, updated: 0, skipped: 0 };
      }
      
      if (data.length === 0) {
        syncLogger.warn(`   ⚠️  [APPLY-UPDATES] Aucune donnée à appliquer (tableau vide)`);
        return { inserted: 0, updated: 0, skipped: 0 };
      }
      
      // Log spécial pour les ventes
      if (entity === 'sales') {
        syncLogger.info(`   🔄 [APPLY-UPDATES] Appel de applySalesUpdates() pour ${data.length} ligne(s) de vente`);
        syncLogger.info(`   🔄 [APPLY-UPDATES] Les ventes vont être stockées dans SQLite (tables: sales + sale_items)`);
        syncLogger.info(`   📋 [APPLY-UPDATES] Exemple de première ligne: invoice_number="${data[0]?.invoice_number || 'N/A'}", product_code="${data[0]?.product_code || 'N/A'}"`);
      }
      
      let stats = { inserted: 0, updated: 0, skipped: 0 };
      
      switch (entity) {
        case 'products':
        case 'product_units':
          stats = await this.applyProductUpdates(data);
          break;
        case 'sales':
          try {
            stats = await this.applySalesUpdates(data);
            syncLogger.info(`   ✅ [APPLY-UPDATES] applySalesUpdates() terminé avec succès`);
            syncLogger.info(`      📊 Résultat: ${stats.inserted || 0} créée(s), ${stats.updated || 0} mise(s) à jour, ${stats.skipped || 0} ignorée(s)`);
            
            // Vérification automatique post-application pour les ventes
            if (stats.inserted > 0 || stats.updated > 0) {
              syncLogger.info(`   🔍 [APPLY-UPDATES] Vérification automatique post-application...`);
              try {
                const { getDb } = await import('../../db/sqlite.js');
                const db = getDb();
                const salesCount = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('SHEETS');
                const itemsCount = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
                syncLogger.info(`      ✅ [VERIFY] Ventes dans SQLite: ${salesCount.count} (origin='SHEETS')`);
                syncLogger.info(`      ✅ [VERIFY] Items dans SQLite: ${itemsCount.count}`);
                
                if (salesCount.count === 0 && (stats.inserted > 0 || stats.updated > 0)) {
                  syncLogger.error(`      ❌ [VERIFY] ERREUR: Aucune vente trouvée malgré ${stats.inserted + stats.updated} traitement(s) réussi(s)`);
                  syncLogger.error(`      💡 [VERIFY] Diagnostic: Les ventes n'ont peut-être pas été persistées en base`);
                } else {
                  syncLogger.info(`      ✅ [VERIFY] Vérification réussie: Les ventes sont bien présentes en base`);
                }
              } catch (verifyError) {
                syncLogger.warn(`      ⚠️  [VERIFY] Erreur lors de la vérification automatique: ${verifyError.message}`);
              }
            }
          } catch (salesError) {
            syncLogger.error(`   ❌ [APPLY-UPDATES] ERREUR lors de l'application des ventes:`);
            syncLogger.error(`      Message: ${salesError.message || 'Erreur inconnue'}`);
            syncLogger.error(`      Stack: ${salesError.stack?.substring(0, 500)}`);
            throw salesError; // Re-lancer pour être capturé par le catch externe
          }
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
          syncLogger.warn(`⚠️  [APPLY-UPDATES] Type d'entité non géré: ${entity}`);
          stats = { inserted: 0, updated: 0, skipped: 0 };
      }
      
      const applyDuration = Date.now() - applyStartTime;
      syncLogger.info(`✅ [APPLY-UPDATES] Application terminée en ${applyDuration}ms`);
      syncLogger.info(`   📊 Résultat final: ${stats.inserted || 0} inséré(s), ${stats.updated || 0} mis à jour, ${stats.skipped || 0} ignoré(s)`);
      syncLogger.info(`⚙️  [APPLY-UPDATES] ==========================================`);
      
      return stats;
    } catch (error) {
      const applyDuration = Date.now() - applyStartTime;
      syncLogger.error(`❌ [APPLY-UPDATES] ERREUR lors de l'application pour ${entity} (après ${applyDuration}ms):`);
      syncLogger.error(`   Message: ${error.message || 'Erreur inconnue'}`);
      syncLogger.error(`   Stack: ${error.stack?.substring(0, 500)}`);
      syncLogger.error(`⚙️  [APPLY-UPDATES] ==========================================`);
      throw error;
    }
  }

  /**
   * Applique les mises à jour de produits
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applyProductUpdates(data) {
    const startTime = Date.now();
    
    if (!data || data.length === 0) {
      syncLogger.warn('⚠️  [PRODUCTS] Aucune donnée produit à appliquer');
      return;
    }

    syncLogger.info(`📦 [PRODUCTS] Début application de ${data.length} item(s) dans SQLite...`);
    syncLogger.info(`   💾 [SQL] Tables: products + product_units, Opération: INSERT/UPDATE`);
    syncLogger.info(`   📊 [SQL] Type de données: ${Array.isArray(data) ? 'array' : typeof data}, ${data.length} ligne(s) à traiter`);
    
    if (data.length > 0) {
      syncLogger.info(`   🔍 [SQL] Premier item: ${JSON.stringify(data[0]).substring(0, 200)}...`);
    }

    // Grouper les produits par code
    const productsByCode = {};
    let itemsSkipped = 0;
    let itemsWithoutCode = 0;
    let itemsWithoutUnitLevel = 0;
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      // Normaliser le code : trim et convertir en string
      let code = item.code;
      if (code) {
        code = String(code).trim();
      }
      
      if (!code || code === '' || code === 'undefined' || code === 'null') {
        itemsSkipped++;
        itemsWithoutCode++;
        syncLogger.warn(`   ⚠️  Item ${i+1}/${data.length} ignoré: code vide ou invalide (code="${item.code}")`);
        if (i < 5) { // Log les 5 premiers items ignorés pour diagnostic
          syncLogger.warn(`      Détail item ignoré: ${JSON.stringify(item).substring(0, 200)}`);
        }
        continue;
      }
      
      syncLogger.debug(`   📝 Item ${i+1}/${data.length}: code="${code}", name="${item.name || 'N/A'}", unit_level="${item.unit_level || 'N/A'}"`);
      
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
        itemsWithoutUnitLevel++;
        syncLogger.warn(`   ⚠️  Item ${i+1}/${data.length} sans unit_level, utilisation de PIECE par défaut (code="${code}")`);
        
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
    
    syncLogger.info(`   📊 Groupement terminé: ${Object.keys(productsByCode).length} produit(s) unique(s) trouvé(s)`);
    syncLogger.info(`   ⏭️  Items ignorés: ${itemsSkipped} (${itemsWithoutCode} sans code, ${itemsWithoutUnitLevel} sans unit_level)`);
    
    if (itemsSkipped > 0 && itemsSkipped === data.length) {
      syncLogger.error(`   ❌ CRITIQUE: TOUS les items ont été ignorés ! Vérifier que les colonnes "Code produit" dans Sheets (Carton/Milliers/Piece) sont bien remplies.`);
      syncLogger.error(`   💡 Solution: Vérifier dans Google Sheets que chaque ligne a un code produit valide dans la colonne "Code produit"`);
    }
    
    // Insérer ou mettre à jour chaque produit
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedPendingCount = 0;
    let errorCount = 0;
    const upsertStartTime = Date.now();
    
    for (const code in productsByCode) {
      try {
        const product = productsByCode[code];
        syncLogger.info(`   💾 [${code}] Upsert produit "${product.name || 'sans nom'}" avec ${product.units.length} unité(s)`);
        
        // Vérifier si le produit existe déjà
        const existing = productsRepo.findByCode(code);
        const isNew = !existing;
        
        // RÈGLE CRITIQUE: Ne pas écraser un produit/unité en pending (modifications locales non synchronisées)
        // Utiliser le nouveau système d'outbox pour vérifier les opérations pending
        const hasProductPending = outboxRepo.hasProductPending(code);
        
        if (hasProductPending && !isNew) {
          // Le produit existe et a des modifications locales en pending
          // Ne pas écraser les modifications locales
          skippedPendingCount++;
          syncLogger.warn(`      ⏸️  Produit "${code}" IGNORÉ (modifications locales en pending)`);
          syncLogger.warn(`         💡 Les modifications locales seront synchronisées vers Sheets avant d'accepter les mises à jour depuis Sheets`);
          continue;
        }
        
        // Pour chaque unité, vérifier si elle a des mouvements de stock pending
        // Si des mouvements pending existent, on doit préserver le stock local
        // et appliquer les deltas pending sur le stock Sheets
        const unitsToUpsert = [];
        for (const unit of product.units) {
          // Vérifier si l'unité a des mouvements de stock pending
          const hasStockPending = outboxRepo.hasStockMovePending(code, unit.unit_level, unit.unit_mark);
          
          if (hasStockPending && !isNew) {
            // RÈGLE IMPORTANTE: Stock ne doit jamais être écrasé si des mouvements pending existent
            // On doit recalculer le stock correct en appliquant les deltas pending sur le stock Sheets
            const existingUnit = existing?.units?.find(
              u => u.unit_level === unit.unit_level && u.unit_mark === unit.unit_mark
            );
            
            if (existingUnit) {
              // Récupérer le total des deltas pending
              const pendingDelta = outboxRepo.getPendingStockDelta(code, unit.unit_level, unit.unit_mark);
              
              // Le stock correct = stock Sheets + deltas pending locaux
              // Car les deltas locaux n'ont pas encore été appliqués côté Sheets
              const correctedStock = (unit.stock_current || 0) + pendingDelta;
              
              syncLogger.warn(`      ⏸️  Unité "${unit.unit_level}/${unit.unit_mark}" a des mouvements stock pending`);
              syncLogger.warn(`         📊 Stock Sheets: ${unit.stock_current}, Deltas pending: ${pendingDelta > 0 ? '+' : ''}${pendingDelta}`);
              syncLogger.warn(`         📊 Stock corrigé: ${correctedStock} (sera utilisé)`);
              
              unitsToUpsert.push({
                ...unit,
                stock_current: correctedStock,
                stock_initial: correctedStock
              });
            } else {
              // Unité nouvelle, utiliser les données de Sheets
              unitsToUpsert.push(unit);
            }
          } else {
            // Vérifier aussi les patches d'unité en pending (prix, etc.)
            const hasUnitPatchPending = syncRepo.isUnitPending(code, unit.unit_level, unit.unit_mark);
            
            if (hasUnitPatchPending && !isNew) {
              const existingUnit = existing?.units?.find(
                u => u.unit_level === unit.unit_level && u.unit_mark === unit.unit_mark
              );
              
              if (existingUnit) {
                // Préserver les prix locaux si en pending
                syncLogger.warn(`      ⏸️  Unité "${unit.unit_level}/${unit.unit_mark}" a des modifications pending`);
                syncLogger.warn(`         💰 Prix local préservé: ${existingUnit.sale_price_usd} USD`);
                unitsToUpsert.push({
                  ...unit,
                  sale_price_usd: existingUnit.sale_price_usd, // Préserver le prix local
                  purchase_price_usd: existingUnit.purchase_price_usd,
                  stock_current: existingUnit.stock_current, // Préserver le stock local aussi
                  stock_initial: existingUnit.stock_initial || existingUnit.stock_current
                });
              } else {
                unitsToUpsert.push(unit);
              }
            } else {
              // Aucune opération pending, utiliser les données de Sheets normalement
              unitsToUpsert.push(unit);
            }
          }
        }
        
        const upsertItemStart = Date.now();
        productsRepo.upsert({
          ...product,
          units: unitsToUpsert,
          is_active: 1,
          _origin: 'SHEETS'
        });
        const upsertItemDuration = Date.now() - upsertItemStart;
        
        if (isNew) {
          insertedCount++;
          syncLogger.info(`      ✅ Produit "${code}" INSÉRÉ en ${upsertItemDuration}ms`);
        } else {
          updatedCount++;
          syncLogger.info(`      ✅ Produit "${code}" MIS À JOUR en ${upsertItemDuration}ms`);
        }
      } catch (error) {
        errorCount++;
        syncLogger.error(`      ❌ Erreur upsert produit ${code}:`);
        syncLogger.error(`         Message: ${error.message}`);
        syncLogger.error(`         Stack: ${error.stack?.substring(0, 300)}`);
      }
    }
    
    const totalDuration = Date.now() - startTime;
    syncLogger.info(`✅ [PRODUCTS] Application SQL terminée en ${totalDuration}ms`);
    syncLogger.info(`   📊 [SQL] Résumé SQL:`);
    syncLogger.info(`      ✅ ${insertedCount} produit(s) INSÉRÉ(S) (INSERT INTO products + product_units)`);
    syncLogger.info(`      ✅ ${updatedCount} produit(s) MIS À JOUR (UPDATE products + product_units)`);
    if (skippedPendingCount > 0) {
      syncLogger.info(`      ⏸️  ${skippedPendingCount} produit(s) IGNORÉ(S) (modifications locales en pending)`);
    }
    syncLogger.info(`      ❌ ${errorCount} produit(s) EN ERREUR`);
    syncLogger.info(`   ⏱️  [SQL] Temps moyen par produit: ${(insertedCount + updatedCount) > 0 ? Math.round(totalDuration / (insertedCount + updatedCount)) : 0}ms`);
    
    if (insertedCount + updatedCount > 0) {
      syncLogger.info(`   🎉 [SQL] ${insertedCount + updatedCount} produit(s) maintenant STOCKÉ(S) dans SQLite et DISPONIBLE(S) dans la page Produits!`);
      syncLogger.info(`   📊 [SQL] Vérification: SELECT COUNT(*) FROM products WHERE is_active = 1; devrait retourner au moins ${insertedCount + updatedCount} ligne(s)`);
    }
    
    return { inserted: insertedCount, updated: updatedCount, skipped: skippedPendingCount };
  }

  /**
   * Applique les mises à jour de ventes
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applySalesUpdates(data) {
    const startTime = Date.now();
    syncLogger.info(`💰 [SALES] ==========================================`);
    syncLogger.info(`💰 [SALES] DÉBUT SYNCHRONISATION DES VENTES`);
    syncLogger.info(`💰 [SALES] ==========================================`);
    syncLogger.info(`   📥 SOURCE: Google Sheets (feuille "Ventes")`);
    syncLogger.info(`   📦 RÉCEPTION: ${data.length} ligne(s) téléchargée(s) depuis Sheets`);
    syncLogger.info(`   🔄 DESTINATION: Base de données SQLite locale (tables: sales + sale_items)`);
    syncLogger.info(`💰 [SALES] ==========================================`);
    
    // Vérification initiale du nombre de ventes dans SQLite AVANT traitement
    let salesCountBefore = 0;
    let itemsCountBefore = 0;
    try {
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      const salesCountResult = db.prepare('SELECT COUNT(*) as count FROM sales WHERE origin = ?').get('SHEETS');
      const itemsCountResult = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
      salesCountBefore = salesCountResult?.count || 0;
      itemsCountBefore = itemsCountResult?.count || 0;
      syncLogger.info(`   🔍 [SALES] ÉTAT INITIAL SQLite: ${salesCountBefore} vente(s) avec origin='SHEETS', ${itemsCountBefore} item(s)`);
    } catch (initError) {
      syncLogger.error(`   ❌ [SALES] Erreur lors de la vérification initiale: ${initError.message}`);
      syncLogger.error(`   📋 [SALES] Stack: ${initError.stack?.substring(0, 500)}`);
    }
    
    if (!data || data.length === 0) {
      syncLogger.warn(`⚠️  [SALES] Aucune donnée vente à appliquer dans SQLite`);
      syncLogger.warn(`   💡 [SALES] Vérifier que la feuille "Ventes" contient des données dans Google Sheets`);
      syncLogger.warn(`   🔍 [SALES] Diagnostic: data=${data ? 'existe mais vide' : 'null/undefined'}, length=${data?.length || 0}`);
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    
    // Log détaillé des premières lignes pour diagnostic
    syncLogger.info(`   📋 [SALES] Analyse des données reçues:`);
    syncLogger.info(`      ✅ Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
    syncLogger.info(`      ✅ Longueur: ${data.length} ligne(s)`);
    if (data.length > 0) {
      const firstItem = data[0];
      syncLogger.info(`      📋 [SALES] Premier item (échantillon):`);
      syncLogger.info(`         - invoice_number: ${firstItem.invoice_number || 'MANQUANT'}`);
      syncLogger.info(`         - client_name: ${firstItem.client_name || 'N/A'}`);
      syncLogger.info(`         - product_code: ${firstItem.product_code || 'N/A'}`);
      syncLogger.info(`         - qty: ${firstItem.qty !== undefined ? firstItem.qty : 'MANQUANT'}`);
      syncLogger.info(`         - uuid: ${firstItem.uuid || 'MANQUANT'}`);
      syncLogger.info(`         - sold_at: ${firstItem.sold_at || 'MANQUANT'}`);
    }
    
    syncLogger.info(`   📥 [SALES] ${data.length} ligne(s) reçue(s) depuis Google Sheets (feuille "Ventes")`);
    syncLogger.info(`   🔄 [SALES] SYNCHRONISATION EN COURS: Sheets → SQLite local`);
    syncLogger.info(`   📋 [SALES] Structure des données:`);
    if (data.length > 0) {
      const firstItem = data[0];
      syncLogger.info(`      ✅ invoice_number: ${firstItem.invoice_number ? '✓' : '✗'}`);
      syncLogger.info(`      ✅ client_name: ${firstItem.client_name ? '✓' : '✗'}`);
      syncLogger.info(`      ✅ product_code: ${firstItem.product_code ? '✓' : '✗'}`);
      syncLogger.info(`      ✅ qty: ${firstItem.qty !== undefined ? '✓' : '✗'}`);
      syncLogger.info(`      ✅ unit_price_fc: ${firstItem.unit_price_fc !== undefined ? '✓' : '✗'}`);
      syncLogger.info(`      ✅ uuid: ${firstItem.uuid ? '✓' : '✗'}`);
    }
    
    // Grouper les lignes par facture (une facture peut avoir plusieurs lignes)
    const salesByInvoice = {};
    let skippedLinesCount = 0;
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const invoiceNumber = item.invoice_number;
      
      if (!invoiceNumber || invoiceNumber.toString().trim() === '') {
        skippedLinesCount++;
        if (i < 5) { // Log les 5 premiers pour debug
          syncLogger.warn(`   ⚠️  [SALES] Ligne ${i + 1}/${data.length} ignorée: pas de numéro de facture`);
        }
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
        syncLogger.debug(`   📋 [SALES] Nouvelle facture détectée: ${invoiceNumber}`);
      }
      
      // Utiliser le UUID de la première ligne si disponible (pour la vente elle-même)
      // Note: Chaque item peut avoir son propre UUID, mais la vente (sales) a aussi un UUID
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
        if (!product) {
          syncLogger.debug(`   ⚠️  [SALES] Produit non trouvé localement: code="${item.product_code}" (sera stocké avec product_id=null)`);
        }
      }
      
      // Normaliser l'unité depuis Sheets (colonne H = unité réelle)
      // IMPORTANT: Utiliser l'unité de Sheets telle quelle, ne pas la remplacer par celle du produit
      let unitLevel = null;
      let unitLevelFromSheets = null; // Conserver l'unité originale de Sheets
      
      // Récupérer l'unité depuis Sheets (peut être dans unit_level ou vide)
      const rawUnit = item.unit_level ? String(item.unit_level).trim() : '';
      
      if (rawUnit) {
        // Log toujours pour diagnostiquer les problèmes d'unité
        syncLogger.info(`   🔍 [SALES] Unité brute depuis Sheets: "${rawUnit}" pour produit ${item.product_code} (facture: ${invoiceNumber})`);
        
        // Normaliser l'unité depuis Sheets (peut être "millier", "carton", "piece" en minuscules)
        unitLevelFromSheets = normalizeUnitFromSheets(rawUnit);
        
        if (!unitLevelFromSheets) {
          // Si normalisation échoue, utiliser la valeur telle quelle (peut être déjà normalisée)
          const upperValue = rawUnit.toUpperCase();
          // Vérifier que c'est une valeur valide
          if (upperValue === 'MILLIER' || upperValue === 'CARTON' || upperValue === 'PIECE' || upperValue === 'MILLIERS') {
            unitLevelFromSheets = upperValue === 'MILLIERS' ? 'MILLIER' : upperValue;
            syncLogger.info(`   ✅ [SALES] Unité normalisée depuis majuscules: "${unitLevelFromSheets}" pour produit ${item.product_code}`);
          } else {
            syncLogger.warn(`   ⚠️ [SALES] Unité non reconnue depuis Sheets: "${rawUnit}" (upper: "${upperValue}") pour produit ${item.product_code}`);
          }
        } else {
          syncLogger.info(`   ✅ [SALES] Unité normalisée depuis Sheets: "${unitLevelFromSheets}" (brut: "${rawUnit}") pour produit ${item.product_code}`);
        }
      } else {
        syncLogger.warn(`   ⚠️ [SALES] Pas d'unité dans Sheets pour produit ${item.product_code} (facture: ${invoiceNumber}) - item.unit_level="${item.unit_level}"`);
      }
      
      // Utiliser l'unité de Sheets si elle est valide (PRIORITAIRE - ne jamais remplacer)
      if (unitLevelFromSheets) {
        unitLevel = unitLevelFromSheets;
        syncLogger.info(`   ✅ [SALES] Unité depuis Sheets: "${unitLevel}" pour produit ${item.product_code} (PRÉSERVÉE)`);
      }
      
      let unitMark = item.unit_mark || '';
      
      // Si unitLevel n'est pas spécifié dans Sheets, chercher dans le produit
      if (!unitLevel && product?.id && product.units && product.units.length > 0) {
        // Utiliser la première unité disponible du produit
        const foundUnit = product.units[0];
        unitLevel = foundUnit.unit_level;
        unitMark = foundUnit.unit_mark || '';
        syncLogger.debug(`   🔍 [SALES] Unité non spécifiée dans Sheets, utilisation de la première unité disponible "${unitLevel}/${unitMark}" pour produit ${item.product_code}`);
      } else if (unitLevel && product?.id && product.units && product.units.length > 0) {
        // Chercher l'unité exacte dans le produit pour récupérer le unit_mark si nécessaire
        let foundUnit = product.units.find(
          u => u.unit_level === unitLevel && u.unit_mark === unitMark
        );
        
        // Si pas trouvée exactement, chercher une unité avec le même unit_level pour récupérer le mark
        if (!foundUnit) {
          foundUnit = product.units.find(u => u.unit_level === unitLevel);
          if (foundUnit && !unitMark) {
            // Utiliser le mark du produit seulement si pas de mark dans Sheets
            unitMark = foundUnit.unit_mark || '';
            syncLogger.debug(`   🔍 [SALES] Mark récupéré depuis produit: "${unitMark}" pour unité "${unitLevel}" du produit ${item.product_code}`);
          }
        } else {
          // Utiliser le mark du produit si trouvé
          unitMark = foundUnit.unit_mark || unitMark;
        }
        
        // IMPORTANT: Ne PAS remplacer unitLevel par celle du produit si elle vient de Sheets
        // L'unité de Sheets est la source de vérité pour les ventes historiques
      }
      
      // Fallback final: si toujours pas d'unité, utiliser PIECE (seulement en dernier recours)
      if (!unitLevel) {
        unitLevel = 'PIECE';
        syncLogger.warn(`   ⚠️  [SALES] Aucune unité trouvée pour produit ${item.product_code}, utilisation de PIECE par défaut`);
      }
      
      // VÉRIFICATION FINALE: S'assurer que l'unité de Sheets est préservée
      // Si unitLevelFromSheets existe, l'utiliser même si le produit n'a pas cette unité
      if (unitLevelFromSheets && unitLevel !== unitLevelFromSheets) {
        syncLogger.warn(`   ⚠️ [SALES] CORRECTION: Unité remplacée incorrectement, restauration de "${unitLevelFromSheets}" pour produit ${item.product_code}`);
        unitLevel = unitLevelFromSheets;
      }
      
      // Calculer subtotal si non fourni
      const qty = item.qty || 0;
      const unitPriceFC = item.unit_price_fc || 0;
      const unitPriceUSD = item.unit_price_usd || 0;
      const subtotalFC = item.subtotal_fc !== undefined ? item.subtotal_fc : (qty * unitPriceFC);
      const subtotalUSD = item.subtotal_usd !== undefined ? item.subtotal_usd : (qty * unitPriceUSD);
      
      syncLogger.debug(`   📝 [SALES] Item final: produit=${item.product_code}, unité="${unitLevel}", mark="${unitMark}", qty=${qty}`);
      
      // IMPORTANT: S'assurer que product_id est défini avant d'ajouter l'item
      // Si le produit n'existe pas, on ne peut pas créer l'item (erreur de validation)
      if (!product?.id) {
        syncLogger.warn(`   ⚠️ [SALES] Produit non trouvé pour code "${item.product_code}" (facture: ${invoiceNumber}) - item ignoré`);
        skippedLinesCount++;
        continue; // Ignorer cet item
      }
      
      salesByInvoice[invoiceNumber].items.push({
        uuid: item.uuid || null, // UUID de l'item de vente (sale_items)
        product_id: product.id, // IMPORTANT: Toujours défini (vérifié ci-dessus)
        product_code: item.product_code || '',
        product_name: productName,
        unit_level: unitLevel, // IMPORTANT: Utiliser l'unité de Sheets (préservée)
        unit_mark: unitMark,
        qty: qty,
        qty_label: item.qty_label || (qty ? qty.toString() : '0'),
        unit_price_fc: unitPriceFC,
        subtotal_fc: subtotalFC,
        unit_price_usd: unitPriceUSD,
        subtotal_usd: subtotalUSD
      });
      
      // Utiliser les données de la dernière ligne pour les métadonnées de la vente
      // (client_name, client_phone, seller_name peuvent varier entre lignes, on prend la dernière)
      if (item.client_name) salesByInvoice[invoiceNumber].client_name = item.client_name;
      if (item.client_phone) salesByInvoice[invoiceNumber].client_phone = item.client_phone;
      if (item.seller_name) salesByInvoice[invoiceNumber].seller_name = item.seller_name;
      if (item.sold_at) salesByInvoice[invoiceNumber].sold_at = item.sold_at;
    }
    
    if (skippedLinesCount > 0) {
      syncLogger.warn(`   ⚠️  [SALES] ${skippedLinesCount} ligne(s) ignorée(s) (sans numéro de facture)`);
    }
    
    const uniqueInvoicesCount = Object.keys(salesByInvoice).length;
    syncLogger.info(`   📊 [SALES] GROUPEMENT: ${data.length} ligne(s) → ${uniqueInvoicesCount} facture(s) unique(s)`);
    
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Traiter chaque facture
    let invoiceIndex = 0;
    for (const invoiceNumber in salesByInvoice) {
      invoiceIndex++;
      try {
        const saleData = salesByInvoice[invoiceNumber];
        
        syncLogger.info(`   🔄 [SALES] Traitement facture #${invoiceIndex}/${uniqueInvoicesCount}: ${invoiceNumber}`);
        syncLogger.info(`      📋 Items: ${saleData.items.length}, Client: ${saleData.client_name || 'N/A'}`);
        
        // Calculer les totaux de la facture
        let totalFC = 0;
        let totalUSD = 0;
        for (const item of saleData.items) {
          totalFC += item.subtotal_fc || 0;
          totalUSD += item.subtotal_usd || 0;
        }
        
        syncLogger.info(`      💰 Total FC: ${totalFC.toLocaleString()}, Total USD: ${totalUSD.toLocaleString()}`);
        
        // Vérifier si la vente existe déjà dans SQLite
        const existing = salesRepo.findByInvoice(invoiceNumber);
        const isNew = !existing;
        
        syncLogger.info(`      🔍 [SALES] Recherche dans SQLite: ${isNew ? 'Nouvelle facture (sera créée)' : 'Facture existante trouvée (sera mise à jour si nécessaire)'}`);
        
        // IMPORTANT: Toujours mettre à jour les ventes depuis Sheets pour s'assurer que les unités sont correctes
        // Même si la vente existe déjà, on la met à jour pour garantir la cohérence avec Sheets
        if (existing) {
          const existingTotalFC = existing.total_fc || 0;
          const existingItemsCount = existing.items ? existing.items.length : 0;
          
          // Vérifier si les unités ont changé (comparer les unit_level des items)
          let unitsChanged = false;
          if (existing.items && existing.items.length === saleData.items.length) {
            for (let i = 0; i < existing.items.length; i++) {
              const existingItem = existing.items[i];
              const newItem = saleData.items[i];
              if (existingItem.unit_level !== newItem.unit_level) {
                unitsChanged = true;
                syncLogger.info(`   🔍 [SALES] Unité changée pour item ${i+1}: "${existingItem.unit_level}" → "${newItem.unit_level}"`);
                break;
              }
            }
          }
          
          const hasChanges = Math.abs(existingTotalFC - totalFC) > 0.01 || 
                            existingItemsCount !== saleData.items.length ||
                            unitsChanged;
          
          // Toujours mettre à jour pour s'assurer que les unités sont correctes
          // Même si les données semblent identiques, Sheets est la source de vérité
          syncLogger.info(`   🔄 [SALES] Facture ${invoiceNumber} existe → MISE À JOUR FORCÉE (Sheets = source de vérité)`);
          if (hasChanges) {
            syncLogger.debug(`      📊 Changements détectés: Total FC ${existingTotalFC} → ${totalFC}, Items ${existingItemsCount} → ${saleData.items.length}, Unités changées: ${unitsChanged}`);
          } else {
            syncLogger.debug(`      📊 Pas de changements détectés mais mise à jour forcée pour garantir la cohérence des unités`);
          }
        }
        
        // Générer UUID pour la vente si non fourni
        if (!saleData.uuid) {
          saleData.uuid = existing?.uuid || generateUUID();
        }
        
        syncLogger.info(`   💰 [SALES] Facture ${invoiceNumber}: ${isNew ? 'CRÉATION' : 'MISE À JOUR'}`);
        syncLogger.info(`      📋 Client: ${saleData.client_name || 'N/A'}, Vendeur: ${saleData.seller_name || 'N/A'}`);
        syncLogger.info(`      📦 ${saleData.items.length} article(s), Total: ${totalFC.toLocaleString()} FC`);
        syncLogger.info(`      💾 [SQL] ${isNew ? 'INSERT' : 'UPDATE'} dans SQLite (table: sales + sale_items)`);
        syncLogger.info(`      📥 [SQL] Source: Google Sheets → Local SQLite`);
        
        // Validation des données avant upsert
        if (!saleData.sold_at) {
          syncLogger.warn(`      ⚠️  [SALES] ATTENTION: Facture ${invoiceNumber} sans date (sold_at) - utilisation de la date actuelle`);
          saleData.sold_at = new Date().toISOString();
        }
        
        // Utiliser upsert (qui ne décrémente PAS le stock car vente déjà effectuée dans Sheets)
        syncLogger.info(`      🔄 [SQL] Appel salesRepo.upsert() pour facture ${invoiceNumber}...`);
        syncLogger.info(`         📋 Données à stocker: ${saleData.items.length} item(s), Total FC: ${totalFC}, Total USD: ${totalUSD}`);
        syncLogger.info(`         🔍 [SQL] UUID vente: ${saleData.uuid || 'sera généré'}`);
        syncLogger.info(`         🔍 [SQL] Date vente: ${saleData.sold_at}`);
        
        const upsertStartTime = Date.now();
        let savedSale = null;
        let upsertError = null;
        
        try {
          savedSale = salesRepo.upsert({
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
            rate_fc_per_usd: 2800, // Par défaut
            items: saleData.items
          });
        } catch (error) {
          upsertError = error;
          syncLogger.error(`      ❌ [SQL] ERREUR lors de l'upsert de la facture ${invoiceNumber}:`);
          syncLogger.error(`         Message: ${error.message || 'Erreur inconnue'}`);
          syncLogger.error(`         Stack: ${error.stack?.substring(0, 500)}`);
          throw error; // Re-lancer pour être capturé par le catch externe
        }
        
        const upsertDuration = Date.now() - upsertStartTime;
        
        if (savedSale && savedSale.id) {
          syncLogger.info(`      ✅ [SQL] Facture ${invoiceNumber} ${isNew ? 'CRÉÉE' : 'MISE À JOUR'} dans SQLite en ${upsertDuration}ms`);
          syncLogger.info(`         📍 Sale ID: ${savedSale.id}, UUID: ${savedSale.uuid || 'N/A'}`);
          syncLogger.info(`         📊 Items stockés: ${saleData.items.length}, Total FC: ${totalFC.toLocaleString()}`);
          syncLogger.info(`         💾 Stockage confirmé: Table "sales" → ID=${savedSale.id}, Table "sale_items" → ${saleData.items.length} ligne(s)`);
          
          // Vérification post-stockage IMMÉDIATE pour confirmer
          try {
            const verifySale = salesRepo.findByInvoice(invoiceNumber);
            if (verifySale && verifySale.id === savedSale.id) {
              const itemsCount = verifySale.items ? verifySale.items.length : 0;
              syncLogger.info(`      ✅ [SQL] VÉRIFICATION IMMÉDIATE: Facture ${invoiceNumber} trouvée dans SQLite`);
              syncLogger.info(`         📍 ID: ${verifySale.id}, UUID: ${verifySale.uuid || 'N/A'}`);
              syncLogger.info(`         📊 Items: ${itemsCount} item(s) trouvé(s) dans sale_items`);
              syncLogger.info(`         💰 Total FC: ${verifySale.total_fc || 0}`);
              syncLogger.info(`      ✅ [SQL] ✅ CONFIRMÉ: Les données sont bien écrites dans la base SQLite locale`);
              
              // Vérification supplémentaire: compter les items dans sale_items
              try {
                const { getDb } = await import('../../db/sqlite.js');
                const db = getDb();
                const itemsInDb = db.prepare('SELECT COUNT(*) as count FROM sale_items WHERE sale_id = ?').get(savedSale.id);
                syncLogger.info(`      ✅ [SQL] Vérification table sale_items: ${itemsInDb.count} item(s) lié(s) à cette facture`);
                if (itemsInDb.count !== saleData.items.length) {
                  syncLogger.warn(`      ⚠️  [SQL] ATTENTION: Nombre d'items différent (attendu: ${saleData.items.length}, trouvé: ${itemsInDb.count})`);
                }
              } catch (itemsCheckError) {
                syncLogger.warn(`      ⚠️  [SQL] Erreur lors de la vérification des items: ${itemsCheckError.message}`);
              }
            } else {
              syncLogger.error(`      ❌ [SQL] VÉRIFICATION ÉCHOUÉE: Facture ${invoiceNumber} non trouvée après stockage`);
              syncLogger.error(`         📋 Recherche effectuée avec invoice_number="${invoiceNumber}"`);
              syncLogger.error(`         🔍 Résultat: ${verifySale ? 'trouvée mais ID différent' : 'non trouvée'}`);
            }
          } catch (verifyError) {
            syncLogger.error(`      ❌ [SQL] Erreur lors de la vérification post-stockage: ${verifyError.message}`);
            syncLogger.error(`         Stack: ${verifyError.stack?.substring(0, 300)}`);
          }
        } else {
          syncLogger.error(`      ❌ [SQL] ÉCHEC: Impossible de stocker la facture ${invoiceNumber} dans SQLite`);
          syncLogger.error(`         📋 Résultat upsert: ${savedSale ? JSON.stringify(savedSale).substring(0, 200) : 'null/undefined'}`);
          if (!savedSale || !savedSale.id) {
            syncLogger.error(`         💡 Diagnostic: salesRepo.upsert() n'a pas retourné de vente avec un ID`);
            syncLogger.error(`         💡 Vérifier que la transaction SQLite s'est bien exécutée`);
          }
        }
        
        if (isNew) {
          insertedCount++;
        } else {
          updatedCount++;
        }
      } catch (error) {
        errorCount++;
        syncLogger.error(`   ❌ [SALES] Erreur lors du stockage de la facture ${invoiceNumber}:`, error.message || error);
        if (error.stack) {
          syncLogger.error(`      Stack: ${error.stack.substring(0, 300)}...`);
        }
      }
    }
    
    const duration = Date.now() - startTime;
    const totalProcessed = insertedCount + updatedCount;
    
    // Vérification finale dans SQLite pour confirmer le stockage
    let totalSalesInDb = 0;
    try {
      // Utiliser salesRepo pour vérifier le nombre de ventes dans SQLite
      const allSales = salesRepo.findAll({}); // Récupérer toutes les ventes
      totalSalesInDb = allSales.filter(s => s.origin === 'SHEETS').length;
      syncLogger.info(`   🔍 [SQL] VÉRIFICATION SQLite: ${totalSalesInDb} facture(s) avec origin='SHEETS' trouvée(s) dans la table "sales"`);
      syncLogger.info(`   ✅ [SQL] Les ventes sont bien stockées dans la base de données SQLite locale`);
    } catch (verifyError) {
      syncLogger.warn(`   ⚠️  [SQL] Erreur lors de la vérification SQLite: ${verifyError.message}`);
    }
    
    syncLogger.info(`💰 [SALES] ==========================================`);
    syncLogger.info(`💰 [SALES] RÉSULTAT FINAL DE LA SYNCHRONISATION:`);
    syncLogger.info(`💰 [SALES] ==========================================`);
    syncLogger.info(`   📥 SOURCE: Google Sheets (feuille "Ventes")`);
    syncLogger.info(`   📦 RÉCEPTION: ${data.length} ligne(s) téléchargée(s) depuis Sheets`);
    syncLogger.info(`   🔄 GROUPEMENT: ${uniqueInvoicesCount} facture(s) unique(s) détectée(s)`);
    syncLogger.info(`   💾 STOCKAGE SQLite:`);
    syncLogger.info(`      ✅ ${insertedCount} facture(s) CRÉÉE(S) (INSERT INTO sales)`);
    syncLogger.info(`      ✅ ${updatedCount} facture(s) MIS(E) À JOUR (UPDATE sales)`);
    if (skippedCount > 0) {
      syncLogger.info(`      ⏭️  ${skippedCount} facture(s) IGNORÉE(S) (déjà synchronisées et identiques)`);
      syncLogger.info(`         💡 Ces ventes existent déjà dans SQLite avec les mêmes données → Pas de retéléchargement nécessaire`);
    }
    if (errorCount > 0) {
      syncLogger.warn(`      ❌ ${errorCount} facture(s) EN ERREUR (non stockées)`);
    }
    syncLogger.info(`   📊 TOTAL TRAITÉ: ${totalProcessed} facture(s) traitée(s) (${insertedCount} créée(s) + ${updatedCount} mise(s) à jour) dans SQLite`);
    syncLogger.info(`   ✅ VÉRIFICATION SQLite: ${totalSalesInDb} facture(s) avec origin='SHEETS' dans la base de données`);
    
    // Vérification des items dans sale_items
    let totalItemsInDb = 0;
    try {
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      const itemsCountResult = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
      totalItemsInDb = itemsCountResult?.count || 0;
      syncLogger.info(`   ✅ VÉRIFICATION SQLite: ${totalItemsInDb} item(s) dans la table "sale_items"`);
    } catch (itemsError) {
      syncLogger.warn(`   ⚠️  Erreur lors de la vérification des items: ${itemsError.message}`);
    }
    
    // LOG FINAL TRÈS VISIBLE POUR CONFIRMER LE STOCKAGE
    syncLogger.info(`   🎉 [SALES] ==========================================`);
    syncLogger.info(`   🎉 [SALES] ✅ CONFIRMATION FINALE DU STOCKAGE:`);
    syncLogger.info(`   🎉 [SALES] ==========================================`);
    
    // Calculer les nouvelles ventes ajoutées
    const newSalesAdded = totalSalesInDb - salesCountBefore;
    const newItemsAdded = totalItemsInDb - itemsCountBefore;
    
    syncLogger.info(`   📊 [SALES] COMPARAISON AVANT/APRÈS:`);
    syncLogger.info(`      📥 AVANT: ${salesCountBefore} vente(s), ${itemsCountBefore} item(s)`);
    syncLogger.info(`      📥 APRÈS: ${totalSalesInDb} vente(s), ${totalItemsInDb} item(s)`);
    syncLogger.info(`      ➕ AJOUTÉ: ${newSalesAdded} nouvelle(s) vente(s), ${newItemsAdded} nouvel(aux) item(s)`);
    
    if (totalSalesInDb > 0 && totalItemsInDb > 0) {
      syncLogger.info(`   ✅ [SALES] ✅ LES VENTES SONT BIEN STOCKÉES DANS SQLITE!`);
      syncLogger.info(`   ✅ [SALES] ✅ ${totalSalesInDb} vente(s) dans la table "sales" (origin='SHEETS')`);
      syncLogger.info(`   ✅ [SALES] ✅ ${totalItemsInDb} item(s) dans la table "sale_items"`);
      
      if (newSalesAdded > 0 || newItemsAdded > 0) {
        syncLogger.info(`   🎉 [SALES] ✅ ${newSalesAdded} nouvelle(s) vente(s) ajoutée(s) avec succès!`);
        syncLogger.info(`   🎉 [SALES] ✅ ${newItemsAdded} nouvel(aux) item(s) ajouté(s) avec succès!`);
      } else if (insertedCount > 0 || updatedCount > 0) {
        syncLogger.warn(`   ⚠️  [SALES] ATTENTION: Des ventes ont été traitées (${insertedCount} créée(s), ${updatedCount} mise(s) à jour) mais le nombre total n'a pas changé`);
        syncLogger.warn(`   💡 [SALES] Raison possible: Les ventes existaient déjà et ont été mises à jour`);
      }
      
      syncLogger.info(`   ✅ [SALES] ✅ Les ventes sont disponibles dans la page "Historique des ventes"`);
      syncLogger.info(`   ✅ [SALES] ✅ URL: /sales/history (Menu → Historique)`);
    } else {
      syncLogger.error(`   ❌ [SALES] ERREUR CRITIQUE: Aucune vente trouvée dans SQLite après traitement!`);
      syncLogger.error(`   📊 [SALES] Statistiques de traitement:`);
      syncLogger.error(`      ✅ Traitées: ${insertedCount} créée(s), ${updatedCount} mise(s) à jour, ${skippedCount} ignorée(s)`);
      syncLogger.error(`      ❌ Erreurs: ${errorCount}`);
      syncLogger.error(`   💡 [SALES] Diagnostic:`);
      syncLogger.error(`      1. Vérifier que salesRepo.upsert() fonctionne correctement`);
      syncLogger.error(`      2. Vérifier que la transaction SQLite s'exécute sans erreur`);
      syncLogger.error(`      3. Vérifier les logs d'erreur ci-dessus pour chaque facture`);
      syncLogger.error(`      4. Vérifier que la base de données SQLite est accessible`);
      
      // Tentative de diagnostic supplémentaire
      try {
        const { getDb } = await import('../../db/sqlite.js');
        const db = getDb();
        const allSales = db.prepare('SELECT COUNT(*) as count FROM sales').get();
        const allItems = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
        syncLogger.error(`   🔍 [SALES] Diagnostic SQLite:`);
        syncLogger.error(`      📊 Total ventes (toutes origines): ${allSales.count}`);
        syncLogger.error(`      📊 Total items (toutes origines): ${allItems.count}`);
        if (allSales.count > 0) {
          const sampleSale = db.prepare('SELECT invoice_number, origin FROM sales LIMIT 1').get();
          syncLogger.error(`      📋 Exemple de vente: ${sampleSale?.invoice_number || 'N/A'}, origin=${sampleSale?.origin || 'N/A'}`);
        }
      } catch (diagError) {
        syncLogger.error(`   ❌ [SALES] Erreur lors du diagnostic: ${diagError.message}`);
      }
    }
    syncLogger.info(`   🎉 [SALES] ==========================================`);
    
    syncLogger.info(`   ⏱️  Durée totale: ${duration}ms`);
    syncLogger.info(`💰 [SALES] ==========================================`);
    
    if (totalProcessed > 0) {
      syncLogger.info(`   🎉 [SALES] ✅ SYNCHRONISATION RÉUSSIE!`);
      syncLogger.info(`   📱 [SALES] Les ventes sont maintenant disponibles dans l'application:`);
      syncLogger.info(`      📄 Page "Historique des ventes" (Menu → Historique)`);
      syncLogger.info(`      🔗 URL: /sales/history`);
      syncLogger.info(`      💡 Note: Ajustez les dates (Du/Au) pour voir toutes les ventes synchronisées`);
    }
    
    if (skippedCount > 0 && totalProcessed === 0) {
      syncLogger.info(`   ℹ️  [SALES] Toutes les ventes téléchargées étaient déjà synchronisées → Aucune modification nécessaire`);
      syncLogger.info(`   ✅ [SALES] Les ventes sont déjà présentes dans SQLite et visibles dans l'interface`);
    }
    
    // Log final de confirmation
    syncLogger.info(`   ✅ [SALES] SYNCHRONISATION TERMINÉE: Les ventes de Sheets sont bien synchronisées vers SQLite local`);
    syncLogger.info(`   📍 [SALES] LOCALISATION: Base de données SQLite → Tables "sales" et "sale_items"`);
    
    return { 
      inserted: insertedCount, 
      updated: updatedCount, 
      skipped: skippedCount,
      errorCount: errorCount
    };
  }
  
  /**
   * Vérifie que les ventes sont bien synchronisées depuis Sheets vers SQLite
   * Compare la structure et le contenu des tables
   */
  async verifySalesSync() {
    try {
      syncLogger.info(`🔍 [VERIFY-SALES] ==========================================`);
      syncLogger.info(`🔍 [VERIFY-SALES] VÉRIFICATION DE LA SYNCHRONISATION DES VENTES`);
      syncLogger.info(`🔍 [VERIFY-SALES] ==========================================`);
      
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      
      // 1. Compter les ventes dans SQLite
      const allSalesInDb = salesRepo.findAll({});
      const salesFromSheets = allSalesInDb.filter(s => s.origin === 'SHEETS');
      const totalSalesInDb = allSalesInDb.length;
      const salesFromSheetsCount = salesFromSheets.length;
      
      syncLogger.info(`   📊 [VERIFY-SALES] SQLite (table 'sales'):`);
      syncLogger.info(`      ✅ Total ventes: ${totalSalesInDb}`);
      syncLogger.info(`      ✅ Ventes depuis Sheets (origin='SHEETS'): ${salesFromSheetsCount}`);
      
      // 2. Compter les items dans SQLite
      const itemsCountResult = db.prepare('SELECT COUNT(*) as count FROM sale_items').get();
      const totalItemsInDb = itemsCountResult?.count || 0;
      
      syncLogger.info(`   📊 [VERIFY-SALES] SQLite (table 'sale_items'):`);
      syncLogger.info(`      ✅ Total items: ${totalItemsInDb}`);
      
      // 4. Afficher quelques exemples de ventes stockées
      if (salesFromSheets.length > 0) {
        syncLogger.info(`   📋 [VERIFY-SALES] Exemples de ventes stockées (5 dernières):`);
        const recentSales = salesFromSheets
          .sort((a, b) => new Date(b.sold_at || 0) - new Date(a.sold_at || 0))
          .slice(0, 5);
        
        for (const sale of recentSales) {
          const itemsCount = sale.items ? sale.items.length : 0;
          syncLogger.info(`      📄 Facture: ${sale.invoice_number || 'N/A'}`);
          syncLogger.info(`         Client: ${sale.client_name || 'N/A'}, Total: ${(sale.total_fc || 0).toLocaleString()} FC`);
          syncLogger.info(`         Date: ${sale.sold_at || 'N/A'}, Items: ${itemsCount}, UUID: ${sale.uuid || 'N/A'}`);
        }
      } else {
        syncLogger.warn(`      ⚠️  Aucune vente depuis Sheets trouvée dans SQLite`);
        syncLogger.warn(`      💡 Vérifier que getSalesPage() dans Code.gs retourne des données`);
      }
      
      // 5. Récupérer un échantillon depuis Sheets pour comparer
      syncLogger.info(`   📥 [VERIFY-SALES] Vérification de la disponibilité des données dans Sheets...`);
      
      try {
        // Récupérer quelques lignes depuis Sheets (première page seulement pour vérification)
        const sampleResult = await sheetsClient.pullAllPaged('sales', new Date(0).toISOString(), {
          full: true,
          startCursor: 2, // Commencer à la ligne 2 (après header)
          maxRetries: 2,
          timeout: 15000,
          limit: 50 // Récupérer les 50 premières lignes pour vérification
        });
        
        if (sampleResult.success && sampleResult.data && sampleResult.data.length > 0) {
          const sampleLinesFromSheets = sampleResult.data.length;
          syncLogger.info(`   📥 [VERIFY-SALES] Google Sheets (feuille "Ventes"):`);
          syncLogger.info(`      ✅ Échantillon récupéré: ${sampleLinesFromSheets} ligne(s) (sur probablement beaucoup plus)`);
          syncLogger.info(`      ✅ Les données sont disponibles dans Google Sheets`);
          
          // Vérifier la structure des données
          const firstItem = sampleResult.data[0];
          if (firstItem) {
            syncLogger.info(`   📋 [VERIFY-SALES] Structure des données Sheets vérifiée:`);
            syncLogger.info(`      ✅ invoice_number: ${firstItem.invoice_number ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ sold_at: ${firstItem.sold_at ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ product_code: ${firstItem.product_code ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ client_name: ${firstItem.client_name ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ qty: ${firstItem.qty !== undefined ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ unit_price_fc: ${firstItem.unit_price_fc !== undefined ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ seller_name: ${firstItem.seller_name ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ unit_level: ${firstItem.unit_level ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ client_phone: ${firstItem.client_phone !== undefined ? '✓ Présent' : '✗ Manquant'}`);
            syncLogger.info(`      ✅ uuid: ${firstItem.uuid ? '✓ Présent' : '✗ Manquant'}`);
          }
          
          // Grouper par facture pour compter les factures uniques
          const invoicesInSample = new Set();
          sampleResult.data.forEach(item => {
            if (item.invoice_number) {
              invoicesInSample.add(item.invoice_number);
            }
          });
          
          syncLogger.info(`   📊 [VERIFY-SALES] Échantillon Sheets: ${invoicesInSample.size} facture(s) unique(s) dans les ${sampleLinesFromSheets} ligne(s)`);
          
          // Vérifier si ces factures existent dans SQLite
          let foundInDb = 0;
          let missingInDb = 0;
          const missingInvoices = [];
          
          for (const invoiceNumber of invoicesInSample) {
            const saleInDb = salesRepo.findByInvoice(invoiceNumber);
            if (saleInDb) {
              foundInDb++;
            } else {
              missingInDb++;
              if (missingInDb <= 10) { // Logger les 10 premiers manquants
                missingInvoices.push(invoiceNumber);
              }
            }
          }
          
          syncLogger.info(`   ✅ [VERIFY-SALES] Factures de l'échantillon vérifiées dans SQLite:`);
          syncLogger.info(`      ✅ Trouvées: ${foundInDb}/${invoicesInSample.size}`);
          if (missingInDb > 0) {
            syncLogger.warn(`      ⚠️  Manquantes: ${missingInDb}/${invoicesInSample.size}`);
            if (missingInvoices.length > 0) {
              syncLogger.warn(`      ⚠️  Exemples de factures manquantes: ${missingInvoices.slice(0, 5).join(', ')}${missingInvoices.length > 5 ? '...' : ''}`);
            }
            syncLogger.info(`      💡 [VERIFY-SALES] Ces factures seront synchronisées au prochain cycle (dans 10s)`);
          }
        } else {
          syncLogger.warn(`   ⚠️  [VERIFY-SALES] Impossible de récupérer l'échantillon depuis Sheets: ${sampleResult.error || 'Aucune donnée'}`);
        }
      } catch (verifyError) {
        syncLogger.warn(`   ⚠️  [VERIFY-SALES] Erreur lors de la récupération de l'échantillon depuis Sheets: ${verifyError.message}`);
      }
      
      // 6. Vérification de l'intégrité des données
      syncLogger.info(`   🔍 [VERIFY-SALES] Vérification de l'intégrité des données...`);
      
      // Vérifier les ventes sans items
      const salesWithoutItems = db.prepare(`
        SELECT s.id, s.invoice_number, s.origin
        FROM sales s
        LEFT JOIN sale_items si ON s.id = si.sale_id
        WHERE si.id IS NULL AND s.origin = 'SHEETS'
        LIMIT 10
      `).all();
      
      if (salesWithoutItems.length > 0) {
        syncLogger.warn(`      ⚠️  ${salesWithoutItems.length} vente(s) synchronisée(s) sans items détectée(s) (exemples):`);
        for (const sale of salesWithoutItems.slice(0, 5)) {
          syncLogger.warn(`         - Facture ${sale.invoice_number} (ID: ${sale.id})`);
        }
      } else {
        syncLogger.info(`      ✅ Toutes les ventes synchronisées ont des items associés`);
      }
      
      // Vérifier les items sans vente (ne devrait jamais arriver)
      const itemsWithoutSale = db.prepare(`
        SELECT COUNT(*) as count
        FROM sale_items si
        LEFT JOIN sales s ON si.sale_id = s.id
        WHERE s.id IS NULL
      `).get();
      
      if (itemsWithoutSale.count > 0) {
        syncLogger.error(`      ❌ ${itemsWithoutSale.count} item(s) orphelin(s) (sans vente associée) - CORRECTION NÉCESSAIRE`);
      } else {
        syncLogger.info(`      ✅ Tous les items sont associés à une vente`);
      }
      
      // 7. Statistiques détaillées par période
      const last7Days = new Date();
      last7Days.setDate(last7Days.getDate() - 7);
      const salesLast7Days = db.prepare(`
        SELECT COUNT(*) as count, SUM(total_fc) as total_fc
        FROM sales
        WHERE origin = 'SHEETS' AND sold_at >= ?
      `).get(last7Days.toISOString());
      
      syncLogger.info(`   📊 [VERIFY-SALES] Statistiques des 7 derniers jours:`);
      syncLogger.info(`      ✅ Ventes synchronisées: ${salesLast7Days.count || 0}`);
      syncLogger.info(`      ✅ Total FC: ${(salesLast7Days.total_fc || 0).toLocaleString()}`);
      
      // 8. Vérification finale et résumé
      syncLogger.info(`   ✅ [VERIFY-SALES] RÉSUMÉ DE LA VÉRIFICATION:`);
      syncLogger.info(`      📊 Ventes dans SQLite: ${totalSalesInDb} total (${salesFromSheetsCount} depuis Sheets)`);
      syncLogger.info(`      📦 Items dans SQLite: ${totalItemsInDb}`);
      syncLogger.info(`      ✅ Intégrité: ${salesWithoutItems.length === 0 ? 'OK' : 'ATTENTION - Ventes sans items détectées'}`);
      
      if (salesFromSheetsCount > 0 && totalItemsInDb > 0) {
        syncLogger.info(`      🎉 [VERIFY-SALES] ✅ CONFIRMÉ: Les ventes sont bien téléchargées et stockées dans SQLite!`);
        syncLogger.info(`      📍 [VERIFY-SALES] Tables: "sales" (${totalSalesInDb} ventes) + "sale_items" (${totalItemsInDb} items)`);
        syncLogger.info(`      📄 [VERIFY-SALES] Les ventes sont disponibles dans la page "Historique des ventes"`);
        syncLogger.info(`      🔗 [VERIFY-SALES] URL: /sales/history (Menu → Historique)`);
      } else if (salesFromSheetsCount === 0) {
        syncLogger.warn(`      ⚠️  [VERIFY-SALES] Aucune vente avec origin='SHEETS' trouvée dans SQLite`);
        syncLogger.info(`      💡 [VERIFY-SALES] La synchronisation continue... Les ventes seront téléchargées progressivement`);
        syncLogger.info(`      💡 [VERIFY-SALES] Vérifier les logs précédents pour voir si des ventes sont en cours de téléchargement`);
      } else {
        syncLogger.warn(`      ⚠️  [VERIFY-SALES] Items manquants: ${salesFromSheetsCount} ventes mais seulement ${totalItemsInDb} items`);
        syncLogger.warn(`      💡 [VERIFY-SALES] Vérifier que les items sont bien créés lors de l'upsert`);
      }
      
      syncLogger.info(`🔍 [VERIFY-SALES] ==========================================`);
      
    } catch (error) {
      syncLogger.error(`   ❌ [VERIFY-SALES] Erreur lors de la vérification: ${error.message}`);
      if (error.stack) {
        syncLogger.error(`      Stack: ${error.stack.substring(0, 300)}...`);
      }
    }
  }

  /**
   * Applique les mises à jour de dettes
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applyDebtsUpdates(data) {
    const startTime = Date.now();
    syncLogger.info(`💳 [DEBTS] Début application de ${data.length} dette(s) dans SQLite...`);
    syncLogger.info(`   💾 [SQL] Table: debts, Opération: INSERT/UPDATE`);
    
    if (!data || data.length === 0) {
      syncLogger.warn(`⚠️  [DEBTS] Aucune donnée dette à appliquer dans SQL`);
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    
    syncLogger.info(`   📊 [SQL] Type de données: ${Array.isArray(data) ? 'array' : typeof data}, ${data.length} ligne(s) à traiter`);
    if (data.length > 0) {
      syncLogger.info(`   🔍 [SQL] Premier item: ${JSON.stringify(data[0]).substring(0, 300)}...`);
    }
    
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const itemStartTime = Date.now();
      
      try {
        if (!item.invoice_number) {
          syncLogger.warn(`   ⚠️  [${i+1}/${data.length}] Dette ignorée: pas de numéro de facture`);
          skippedCount++;
          continue;
        }
        
        // Vérifier si la dette existe déjà
        const existing = debtsRepo.findByInvoice(item.invoice_number);
        const isNew = !existing;
        
        // Créer ou mettre à jour la dette
        syncLogger.info(`   💳 [${i+1}/${data.length}] ${isNew ? 'INSERT' : 'UPDATE'} SQL pour dette ${item.invoice_number}`);
        syncLogger.info(`      📋 [SQL] Client: ${item.client_name || 'N/A'}`);
        syncLogger.info(`      📋 [SQL] Total: ${item.total_fc || 0} FC`);
        syncLogger.info(`      📋 [SQL] Payé: ${item.paid_fc || 0} FC`);
        syncLogger.info(`      📋 [SQL] Reste: ${item.remaining_fc !== undefined ? item.remaining_fc : (item.total_fc || 0) - (item.paid_fc || 0)} FC`);
        syncLogger.info(`      📋 [SQL] Status: ${item.status || 'open'}`);
        
        // Générer un UUID si non fourni
        const debtUuid = item.uuid || null;
        
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
        
        syncLogger.debug(`      📋 Données complètes: ${JSON.stringify(debtData).substring(0, 400)}...`);
        
        const upsertResult = debtsRepo.upsert(debtData);
        
        const itemDuration = Date.now() - itemStartTime;
        if (isNew) {
          insertedCount++;
          syncLogger.info(`      ✅ [SQL] INSERT réussie: Dette "${item.invoice_number}" INSÉRÉE dans SQL en ${itemDuration}ms`);
          syncLogger.info(`      📊 [SQL] ID SQLite: ${upsertResult?.id || 'N/A'}, UUID: ${upsertResult?.uuid || 'N/A'}`);
          syncLogger.info(`      ✅ [SQL] Dette maintenant DISPONIBLE dans la page Dettes`);
        } else {
          updatedCount++;
          syncLogger.info(`      ✅ [SQL] UPDATE réussie: Dette "${item.invoice_number}" MIS À JOUR dans SQL en ${itemDuration}ms`);
          syncLogger.info(`      📊 [SQL] ID SQLite: ${upsertResult?.id || 'N/A'}, UUID: ${upsertResult?.uuid || 'N/A'}`);
          syncLogger.info(`      ✅ [SQL] Dette maintenant À JOUR dans la page Dettes`);
        }
      } catch (error) {
        errorCount++;
        const errorDuration = Date.now() - itemStartTime;
        syncLogger.error(`      ❌ [${i+1}/${data.length}] Erreur après ${errorDuration}ms`);
        syncLogger.error(`         Invoice: ${item.invoice_number || 'N/A'}`);
        syncLogger.error(`         Message: ${error.message}`);
        syncLogger.error(`         Code: ${error.code || 'N/A'}`);
        
        if (error.message && (error.message.includes('uuid') || error.message.includes('client_phone'))) {
          syncLogger.error(`         ⚠️  Problème de schéma détecté: ${error.message}`);
          syncLogger.error(`         💡 La migration devrait corriger cela au prochain redémarrage`);
        }
        
        syncLogger.error(`         Stack: ${error.stack?.substring(0, 400)}...`);
      }
    }
    
    const totalDuration = Date.now() - startTime;
    syncLogger.info(`✅ [DEBTS] Application SQL terminée en ${totalDuration}ms`);
    syncLogger.info(`   📊 [SQL] Résumé SQL:`);
    syncLogger.info(`      ✅ ${insertedCount} dette(s) INSÉRÉE(S) (INSERT INTO debts)`);
    syncLogger.info(`      ✅ ${updatedCount} dette(s) MIS(E) À JOUR (UPDATE debts)`);
    syncLogger.info(`      ⏭️  ${skippedCount} dette(s) IGNORÉE(S) (déjà existantes)`);
    syncLogger.info(`      ❌ ${errorCount} dette(s) EN ERREUR`);
    syncLogger.info(`   ⏱️  [SQL] Temps moyen par dette: ${(insertedCount + updatedCount) > 0 ? Math.round(totalDuration / (insertedCount + updatedCount)) : 0}ms`);
    
    if (insertedCount + updatedCount > 0) {
      syncLogger.info(`   🎉 [SQL] ${insertedCount + updatedCount} dette(s) maintenant STOCKÉE(S) dans SQLite et DISPONIBLE(S) dans la page Dettes!`);
      syncLogger.info(`   📊 [SQL] Vérification: SELECT COUNT(*) FROM debts; devrait retourner au moins ${insertedCount + updatedCount} ligne(s)`);
    }
    
    if (errorCount > 0) {
      syncLogger.warn(`   ⚠️  [SQL] ${errorCount} dette(s) n'ont pas pu être synchronisée(s) dans SQL`);
      syncLogger.warn(`   💡 [SQL] Vérifier les logs ci-dessus pour plus de détails`);
    }
    
    return { inserted: insertedCount, updated: updatedCount, skipped: skippedCount };
  }

  /**
   * Applique les mises à jour de taux
   */
  async applyRatesUpdates(data) {
    syncLogger.info(`💱 Application de ${data.length} taux de change...`);
    
    // Prendre le taux le plus récent
    if (data.length > 0) {
      const latestRate = data[data.length - 1]; // Déjà trié par date
      try {
        syncLogger.info(`   💱 Mise à jour taux de change: ${latestRate.rate_fc_per_usd} FC/USD`);
        ratesRepo.updateCurrent(latestRate.rate_fc_per_usd, null);
        syncLogger.info(`✅ Taux de change mis à jour avec succès`);
      } catch (error) {
        syncLogger.error(`   ❌ Erreur mise à jour taux:`, error.message || error);
      }
    } else {
      syncLogger.info(`   ℹ️  Aucun taux de change à appliquer`);
    }
  }

  /**
   * Applique les mises à jour d'utilisateurs (basé sur UUID)
   */
  async applyUsersUpdates(data) {
    if (!data || data.length === 0) {
      syncLogger.warn('⚠️  [USERS] Aucune donnée utilisateur à appliquer');
      return;
    }

    syncLogger.info(`👥 [USERS] ==========================================`);
    syncLogger.info(`👥 [USERS] Début application de ${data.length} utilisateur(s)...`);
    syncLogger.info(`👥 [USERS] ==========================================`);
    
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
    
    syncLogger.info(`   📊 [USERS] Index local: ${byUuid.size} avec UUID, ${byUsername.size} par username`);
    
    // Log du premier utilisateur pour voir la structure
    if (data.length > 0) {
      syncLogger.info(`👥 [USERS] Exemple de données reçues (premier utilisateur):`);
      syncLogger.info(`   📋 UUID: ${data[0].uuid || data[0]._uuid || 'N/A (VIDE)'}`);
      syncLogger.info(`   📋 Username: ${data[0].username || data[0].nom || 'N/A'}`);
      syncLogger.info(`   📋 Phone: ${data[0].phone || data[0].numero || 'N/A'}`);
      syncLogger.info(`   📋 Password: ${data[0].password ? '*** (présent)' : 'N/A (VIDE)'}`);
      syncLogger.info(`   📋 Is Active: ${data[0].is_active}`);
      syncLogger.info(`   📋 Is Admin: ${data[0].is_admin}`);
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

        syncLogger.info(`   🔍 [USERS] Traitement utilisateur #${i + 1}/${data.length}: ${username}`);

        // Extraire UUID (peut être dans uuid ou _uuid)
        const remoteUuid = (userData.uuid || userData._uuid || '').trim();
        
        // A) Si UUID existe → UPSERT par UUID
        if (remoteUuid) {
          syncLogger.info(`   🔑 [USERS] UUID présent: ${remoteUuid}`);
          
          const existing = byUuid.get(remoteUuid);
          
          if (existing) {
            syncLogger.info(`   📝 [USERS] Utilisateur existant trouvé par UUID: ID=${existing.id}, Username=${existing.username}`);
            
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
            
            // CRITIQUE: Toujours mettre à jour le mot de passe depuis Sheets (même si l'utilisateur existe déjà)
            // Cela garantit que les mots de passe sont synchronisés même pour les utilisateurs existants
            syncLogger.debug(`   🔑 [USERS] Vérification mot de passe pour: ${username}, password dans Sheets: ${userData.password ? '*** (présent)' : 'VIDE'}`);
            
            if (userData.password && userData.password.trim() !== '') {
              updateData.password = userData.password;
              syncLogger.info(`   🔑 [USERS] ✅ Mise à jour du mot de passe depuis Sheets pour: ${username}`);
            } else {
              // Si pas de mot de passe dans Sheets, vérifier si l'utilisateur existe sans password_hash
              const db = getDb();
              const userWithHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existing.id);
              syncLogger.debug(`   🔑 [USERS] Vérification password_hash pour: ${username}, has_hash: ${!!userWithHash?.password_hash}`);
              
              if (!userWithHash || !userWithHash.password_hash || userWithHash.password_hash.trim() === '') {
                // Utiliser le mot de passe par défaut si l'utilisateur n'a pas de password_hash
                updateData.password = 'changeme123';
                syncLogger.info(`   🔑 [USERS] ✅ Pas de mot de passe dans Sheets, utilisation défaut pour: ${username} (utilisateur sans password_hash)`);
              } else {
                syncLogger.debug(`   🔑 [USERS] ⏭️  Pas de mot de passe dans Sheets mais utilisateur a déjà un password_hash, conservation pour: ${username}`);
              }
            }
            
            // Log pour debug: vérifier que password est bien dans updateData
            if (updateData.password) {
              syncLogger.debug(`   🔑 [USERS] ✅ updateData.password est défini pour: ${username}, sera hashé lors de l'update`);
            } else {
              syncLogger.debug(`   🔑 [USERS] ⚠️  updateData.password est VIDE pour: ${username}`);
            }
            
            syncLogger.debug(`   🔑 [USERS] Appel usersRepo.update() pour: ${username}, updateData contient password: ${!!updateData.password}`);
            const updatedUser = await usersRepo.update(existing.id, updateData);
            
            // Vérifier que le password_hash a bien été mis à jour
            const db = getDb();
            const verifyHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existing.id);
            syncLogger.info(`   🔑 [USERS] Après update - password_hash pour ${username}: ${verifyHash?.password_hash ? '✅ HASHÉ' : '❌ VIDE'}`);
            
            updated++;
            syncLogger.info(`   ✅ [USERS] Utilisateur mis à jour par UUID: ${username}`);
          } else {
            // UUID existe mais utilisateur non trouvé par UUID → vérifier par username
            syncLogger.info(`   🔍 [USERS] UUID présent mais utilisateur non trouvé par UUID, recherche par username: ${username}`);
            
            const normalized = usersRepo.normalizeUsername(username);
            const existingByUsername = byUsername.get(normalized);
            
            if (existingByUsername) {
              // Utilisateur existe par username mais UUID différent → UPDATE avec réparation UUID
              syncLogger.info(`   🔧 [USERS] Utilisateur trouvé par username mais UUID différent: ID=${existingByUsername.id}, UUID local=${existingByUsername.uuid || 'VIDE'}, UUID Sheets=${remoteUuid}`);
              
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
              
              // CRITIQUE: Toujours mettre à jour le mot de passe depuis Sheets
              if (userData.password && userData.password.trim() !== '') {
                updateData.password = userData.password;
                syncLogger.info(`   🔑 [USERS] Mise à jour du mot de passe avec réparation UUID pour: ${username}`);
              } else {
                // Si pas de mot de passe dans Sheets mais utilisateur existe sans password_hash, utiliser défaut
                const db = getDb();
                const userWithHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existingByUsername.id);
                if (!userWithHash || !userWithHash.password_hash || userWithHash.password_hash.trim() === '') {
                  updateData.password = 'changeme123';
                  syncLogger.info(`   🔑 [USERS] Pas de mot de passe dans Sheets, utilisation défaut avec réparation UUID pour: ${username}`);
                }
              }
              
              await usersRepo.update(existingByUsername.id, updateData);
              updated++;
              syncLogger.info(`   ✅ [USERS] Utilisateur mis à jour avec réparation UUID: ${username} (UUID=${remoteUuid})`);
            } else {
              // Vraiment nouveau : créer
              syncLogger.info(`   ➕ [USERS] Nouvel utilisateur avec UUID: ${username}`);
              
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
                syncLogger.info(`   ✅ [USERS] Nouvel utilisateur créé avec UUID: ${username} (UUID=${remoteUuid})`);
              } catch (createError) {
                // Fallback : si erreur UNIQUE sur username, essayer update
                if (createError?.code === 'SQLITE_CONSTRAINT_UNIQUE' && String(createError.message || '').includes('users.username')) {
                  syncLogger.warn(`   ⚠️  [USERS] Erreur UNIQUE username lors de la création, tentative UPDATE par username: ${username}`);
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
                    
                    // CRITIQUE: Toujours mettre à jour le mot de passe depuis Sheets
                    if (userData.password && userData.password.trim() !== '') {
                      updateDataFallback.password = userData.password;
                      syncLogger.info(`   🔑 [USERS] Mise à jour du mot de passe (fallback après erreur UNIQUE) pour: ${username}`);
                    } else {
                      // Si pas de mot de passe dans Sheets mais utilisateur existe sans password_hash, utiliser défaut
                      const db = getDb();
                      const userWithHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existingByUsernameFallback.id);
                      if (!userWithHash || !userWithHash.password_hash || userWithHash.password_hash.trim() === '') {
                        updateDataFallback.password = 'changeme123';
                        syncLogger.info(`   🔑 [USERS] Pas de mot de passe dans Sheets, utilisation défaut (fallback) pour: ${username}`);
                      }
                    }
                    
                    await usersRepo.update(existingByUsernameFallback.id, updateDataFallback);
                    updated++;
                    repaired++;
                    syncLogger.info(`   ✅ [USERS] Utilisateur mis à jour (fallback après erreur UNIQUE): ${username} (UUID=${remoteUuid})`);
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
        syncLogger.info(`   ⚠️  [USERS] UUID vide, recherche par username: ${username}`);
        
        const normalized = usersRepo.normalizeUsername(username);
        const existing = byUsername.get(normalized);
        
        if (existing) {
          syncLogger.info(`   🔧 [USERS] Utilisateur trouvé par username: ID=${existing.id}, UUID local=${existing.uuid || 'VIDE'}`);
          
          // Réparer : assigner UUID local si absent, puis mettre à jour
          let userUuid = existing.uuid;
          if (!userUuid || userUuid.trim() === '') {
            userUuid = generateUUID();
            usersRepo.setUuid(existing.id, userUuid);
            existing.uuid = userUuid;
            byUuid.set(userUuid, existing);
            repaired++;
            syncLogger.info(`   🔧 [USERS] UUID réparé: ${userUuid} pour ${username}`);
            
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
          
          // CRITIQUE: Toujours mettre à jour le mot de passe depuis Sheets
          if (userData.password && userData.password.trim() !== '') {
            updateData.password = userData.password;
            syncLogger.info(`   🔑 [USERS] Mise à jour du mot de passe (username match) pour: ${username}`);
          } else {
            // Si pas de mot de passe dans Sheets mais utilisateur existe sans password_hash, utiliser défaut
            const db = getDb();
            const userWithHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(existing.id);
            if (!userWithHash || !userWithHash.password_hash || userWithHash.password_hash.trim() === '') {
              updateData.password = 'changeme123';
              syncLogger.info(`   🔑 [USERS] Pas de mot de passe dans Sheets, utilisation défaut (username match) pour: ${username}`);
            }
          }
          
          await usersRepo.update(existing.id, updateData);
          updated++;
          syncLogger.info(`   ✅ [USERS] Utilisateur mis à jour (username match): ${username}`);
        } else {
          // C) Nouvel utilisateur sans UUID
          syncLogger.info(`   ➕ [USERS] Nouvel utilisateur sans UUID: ${username}`);
          
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
          
          syncLogger.info(`   ✅ [USERS] Nouvel utilisateur créé avec UUID généré: ${username} (UUID=${newUuid})`);
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

    syncLogger.info(`👥 [USERS] ==========================================`);
    syncLogger.info(`✅ [USERS] Synchronisation terminée: ${inserted} créé(s), ${updated} mis à jour, ${repaired} UUID réparé(s), ${skipped} ignoré(s)`);
    syncLogger.info(`👥 [USERS] ==========================================`);

    // Vérifier la validité de tous les utilisateurs connectés après sync
    await this.checkConnectedUsersValidity();
  }

  /**
   * Vérifie que tous les utilisateurs actuellement connectés sont toujours valides
   * Déconnecte automatiquement ceux qui sont devenus invalides
   */
  async checkConnectedUsersValidity() {
    try {
      syncLogger.info(`🔍 [USERS-VALIDITY] Vérification de la validité des utilisateurs connectés...`);
      
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
          syncLogger.warn(`   ⚠️ [USERS-VALIDITY] Utilisateur inactif détecté: ${user.username} (ID: ${user.id}, Phone: ${user.phone})`);
          invalidUsers.push(user);
          
          // Notifier via socket que cet utilisateur doit être déconnecté
          io.emit('user:deactivated', {
            user_id: user.id,
            username: user.username,
            phone: user.phone,
            reason: 'Compte désactivé lors de la synchronisation'
          });
          
          syncLogger.info(`   📢 [USERS-VALIDITY] Notification envoyée pour déconnexion: ${user.username}`);
        }
      }

      if (invalidUsers.length > 0) {
        syncLogger.warn(`   ⚠️ [USERS-VALIDITY] ${invalidUsers.length} utilisateur(s) inactif(s) détecté(s) et notifié(s)`);
      } else {
        syncLogger.info(`   ✅ [USERS-VALIDITY] Tous les utilisateurs sont valides`);
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
}

export const syncWorker = new SyncWorker();


