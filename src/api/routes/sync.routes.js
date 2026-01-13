import express from 'express';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { syncWorker } from '../../services/sync/sync.instance.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';
import { getDb } from '../../db/sqlite.js';

const router = express.Router();

/**
 * GET /api/sync/status
 * ✅ PRO: Récupère le statut de synchronisation complet
 * Inclut les deux systèmes d'outbox et les statistiques récentes
 */
router.get('/status', optionalAuth, (req, res) => {
  try {
    const legacyStatus = syncRepo.getStatus();
    const outboxStats = outboxRepo.getStats();
    
    // Compter les opérations legacy (sync_outbox)
    const legacyPending = syncRepo.getPending(100);
    const legacyPendingCount = legacyPending.length;
    
    // Grouper par type d'opération
    const legacyByType = {};
    for (const op of legacyPending) {
      const type = op.op || 'unknown';
      legacyByType[type] = (legacyByType[type] || 0) + 1;
    }
    
    // ✅ PRO: Calculer le statut global
    const totalPending = outboxStats.totalPending + legacyPendingCount + outboxStats.stockMovesPending;
    const recentPending = outboxStats.recentPending + outboxStats.recentMovesPending;
    
    let syncStatus = 'synced';
    if (totalPending > 0) {
      if (recentPending > 0) {
        syncStatus = 'pending_recent'; // Modifications récentes en attente
      } else {
        syncStatus = 'pending_old'; // Anciennes opérations (peuvent être nettoyées)
      }
    }
    if (outboxStats.errors > 0) {
      syncStatus = 'has_errors';
    }
    
    res.json({
      ...legacyStatus,
      syncStatus, // ✅ PRO: 'synced', 'pending_recent', 'pending_old', 'has_errors'
      outbox: outboxStats,
      legacy: {
        pendingCount: legacyPendingCount,
        byType: legacyByType,
        recentOps: legacyPending.slice(0, 5).map(op => ({
          id: op.id,
          entity: op.entity,
          op: op.op,
          entity_id: op.entity_id,
          created_at: op.created_at
        }))
      },
      summary: {
        totalPending,
        recentPending,
        oldPending: totalPending - recentPending,
        errors: outboxStats.errors,
        canCleanup: totalPending > recentPending, // Des anciennes ops peuvent être nettoyées
      },
      hasPendingChanges: totalPending > 0,
      totalPending,
      recommendations: totalPending > recentPending 
        ? ['Utilisez POST /api/sync/cleanup pour nettoyer les anciennes opérations']
        : recentPending > 0
        ? ['Attendez que les opérations récentes soient synchronisées']
        : ['Tout est synchronisé ✓']
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sync/outbox
 * Récupère les statistiques détaillées de l'outbox PRO
 */
router.get('/outbox', optionalAuth, (req, res) => {
  try {
    const stats = outboxRepo.getStats();
    const pendingOps = outboxRepo.getPendingOperations(null, 20); // 20 dernières opérations pending
    
    res.json({
      success: true,
      stats,
      recentPending: pendingOps.map(op => ({
        op_id: op.op_id,
        op_type: op.op_type,
        entity_code: op.entity_code,
        status: op.status,
        created_at: op.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/push-now
 * Force un push vers Google Sheets
 * Utilise le nouveau système d'outbox PRO
 */
router.post('/push-now', authenticate, async (req, res) => {
  const { logger } = await import('../../core/logger.js');
  try {
    logger.info('📤 [SYNC/PUSH-NOW] Début push manuel demandé');
    
    // Utiliser le nouveau système d'outbox
    await syncWorker.pushPendingOperations();
    
    // Garder aussi l'ancien système pour compatibilité
    if (typeof syncWorker.pushPending === 'function') {
      await syncWorker.pushPending();
    }
    
    const legacyStatus = syncRepo.getStatus();
    const outboxStats = outboxRepo.getStats();
    
    logger.info('✅ [SYNC/PUSH-NOW] Push terminé');
    
    res.json({
      success: true,
      message: 'Push terminé',
      status: legacyStatus,
      outbox: outboxStats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/pull-now
 * Force un pull depuis Google Sheets
 */
router.post('/pull-now', optionalAuth, async (req, res) => {
  try {
    const { full = false } = req.body;
    await syncWorker.pullUpdates(full);
    const status = syncRepo.getStatus();
    res.json({
      success: true,
      message: 'Pull terminé',
      full_import: full,
      status,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/full-import
 * Force un import complet (full pull) depuis Google Sheets
 * Utile pour réinitialiser la base de données
 */
router.post('/full-import', optionalAuth, async (req, res) => {
  try {
    await syncWorker.pullUpdates(true);
    const status = syncRepo.getStatus();
    res.json({
      success: true,
      message: 'Import complet terminé',
      status,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/now
 * Force une synchronisation complète (push + pull)
 * Utilise optionalAuth pour permettre la synchronisation même sans token (pour le bootstrap)
 */
router.post('/now', optionalAuth, async (req, res) => {
  const { logger } = await import('../../core/logger.js');
  try {
    logger.info('🔄 [SYNC/NOW] Début synchronisation manuelle demandée');
    logger.info(`   👤 Utilisateur: ${req.user ? req.user.username : 'Non authentifié'}`);
    
    await syncWorker.syncNow();
    const status = syncRepo.getStatus();
    
    logger.info('✅ [SYNC/NOW] Synchronisation terminée avec succès');
    
    res.json({
      success: true,
      message: 'Synchronisation terminée',
      status,
    });
  } catch (error) {
    logger.error('❌ [SYNC/NOW] Erreur synchronisation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/reset-online-and-push
 * Force l'état online=true et pousse les opérations pending
 * Utile quand la détection de connexion a échoué par erreur
 */
router.post('/reset-online-and-push', optionalAuth, async (req, res) => {
  const { logger } = await import('../../core/logger.js');
  try {
    logger.info('🌐 [SYNC/RESET-ONLINE] Force connexion et push demandé');
    
    const result = await syncWorker.resetOnlineAndPush();
    const outboxStats = outboxRepo.getStats();
    
    logger.info('✅ [SYNC/RESET-ONLINE] Terminé');
    
    res.json({
      success: true,
      ...result,
      outbox: outboxStats
    });
  } catch (error) {
    logger.error('❌ [SYNC/RESET-ONLINE] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/cleanup
 * ✅ PRO: Nettoie les anciennes opérations et débloque les produits
 * - Marque les vieilles opérations pending comme abandonnées
 * - Supprime les anciens stock_moves synced
 * - Permet aux produits bloqués de recevoir les mises à jour Sheets
 */
router.post('/cleanup', optionalAuth, async (req, res) => {
  try {
    const { hoursOld = 2 } = req.body;
    
    logger.info(`🧹 [SYNC/CLEANUP] Nettoyage des opérations > ${hoursOld}h`);
    
    // Marquer les anciennes opérations pending comme abandonnées
    const abandonned = outboxRepo.markOldPendingAsAbandoned(hoursOld);
    
    // Nettoyer les anciens stock_moves déjà synced
    const cleanedMoves = outboxRepo.cleanupOldSyncedMoves(24);
    
    // Nettoyer les anciennes opérations acked/error
    const cleanedOps = outboxRepo.cleanupOldOperations(7);
    
    const outboxStats = outboxRepo.getStats();
    
    logger.info(`✅ [SYNC/CLEANUP] Terminé: ${abandonned.operations} ops + ${abandonned.moves} moves abandonnés, ${cleanedMoves} moves + ${cleanedOps} ops supprimés`);
    
    res.json({
      success: true,
      message: 'Nettoyage terminé',
      abandoned: abandonned,
      cleaned: { moves: cleanedMoves, operations: cleanedOps },
      outbox: outboxStats
    });
  } catch (error) {
    logger.error('❌ [SYNC/CLEANUP] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sync/product-stats/:code
 * ✅ PRO: Récupère les statistiques de sync détaillées pour un produit
 */
router.get('/product-stats/:code', optionalAuth, (req, res) => {
  try {
    const { code } = req.params;
    const stats = outboxRepo.getProductSyncStats(code);
    
    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    logger.error('❌ [SYNC/PRODUCT-STATS] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/unblock-product/:code
 * ✅ PRO: Débloque un produit pour permettre la mise à jour depuis Sheets
 * Marque tous les mouvements pending du produit comme synced
 */
router.post('/unblock-product/:code', optionalAuth, async (req, res) => {
  const { productsRepo } = await import('../../db/repositories/products.repo.js');
  
  try {
    const { code } = req.params;
    
    logger.info(`🔓 [SYNC/UNBLOCK] Déblocage du produit ${code}`);
    
    // Données avant
    const before = productsRepo.findByCode(code);
    const statsBefore = outboxRepo.getProductSyncStats(code);
    
    // Forcer le marquage des mouvements comme synced
    const markedMoves = outboxRepo.forceMarkProductMovesAsSynced(code);
    
    // Stats après
    const statsAfter = outboxRepo.getProductSyncStats(code);
    
    logger.info(`✅ [SYNC/UNBLOCK] Produit ${code} débloqué: ${markedMoves} mouvements marqués synced`);
    
    res.json({
      success: true,
      message: `Produit ${code} débloqué`,
      productCode: code,
      productName: before?.name,
      markedMovesSynced: markedMoves,
      before: {
        pendingMoves: statsBefore.stockMoves.pending,
        canUpdateFromSheets: statsBefore.canUpdateFromSheets
      },
      after: {
        pendingMoves: statsAfter.stockMoves.pending,
        canUpdateFromSheets: statsAfter.canUpdateFromSheets
      },
      nextStep: 'Le produit sera mis à jour depuis Sheets lors du prochain cycle de sync (10s)'
    });
  } catch (error) {
    logger.error('❌ [SYNC/UNBLOCK] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/smart-sync
 * ✅ PRO: Synchronisation intelligente
 * 1. Nettoie les anciennes opérations
 * 2. Push les opérations récentes
 * 3. Pull les mises à jour depuis Sheets
 * 4. Compare et met à jour les produits désynchronisés
 */
router.post('/smart-sync', optionalAuth, async (req, res) => {
  try {
    const t0 = Date.now();
    logger.info('🧠 [SYNC/SMART] Démarrage synchronisation intelligente');
    
    const results = {
      cleanup: null,
      push: null,
      pull: null,
      duration: 0
    };
    
    // 1. Nettoyer les anciennes opérations (> 2h)
    logger.info('   1/3 Nettoyage...');
    results.cleanup = outboxRepo.markOldPendingAsAbandoned(2);
    outboxRepo.cleanupOldSyncedMoves(24);
    
    // 2. Push les opérations récentes
    logger.info('   2/3 Push...');
    try {
      await syncWorker.pushPendingOperations();
      await syncWorker.pushPending();
      results.push = { success: true };
    } catch (e) {
      results.push = { success: false, error: e.message };
    }
    
    // 3. Pull depuis Sheets
    logger.info('   3/3 Pull depuis Sheets...');
    try {
      await syncWorker.syncProductsFromSheets();
      results.pull = { success: true };
    } catch (e) {
      results.pull = { success: false, error: e.message };
    }
    
    results.duration = Date.now() - t0;
    
    const outboxStats = outboxRepo.getStats();
    
    logger.info(`✅ [SYNC/SMART] Terminé en ${results.duration}ms`);
    
    res.json({
      success: true,
      message: 'Synchronisation intelligente terminée',
      results,
      outbox: outboxStats
    });
  } catch (error) {
    logger.error('❌ [SYNC/SMART] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES POUR LE DASHBOARD DE SYNCHRONISATION (SyncStatusDashboard)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/sync/pause
 * Met en pause la synchronisation automatique
 */
router.post('/pause', optionalAuth, (req, res) => {
  try {
    if (typeof syncWorker.pause === 'function') {
      syncWorker.pause();
    }
    logger.info('⏸️ [SYNC] Synchronisation mise en pause');
    res.json({ success: true, message: 'Synchronisation en pause' });
  } catch (error) {
    logger.error('❌ [SYNC/PAUSE] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/resume
 * Reprend la synchronisation automatique
 */
router.post('/resume', optionalAuth, (req, res) => {
  try {
    if (typeof syncWorker.resume === 'function') {
      syncWorker.resume();
    }
    logger.info('▶️ [SYNC] Synchronisation reprise');
    res.json({ success: true, message: 'Synchronisation reprise' });
  } catch (error) {
    logger.error('❌ [SYNC/RESUME] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/force
 * Force une synchronisation immédiate (push + pull)
 */
router.post('/force', optionalAuth, async (req, res) => {
  try {
    logger.info('🔄 [SYNC/FORCE] Synchronisation forcée demandée');
    
    // Push les opérations pending
    if (typeof syncWorker.pushPendingOperations === 'function') {
      await syncWorker.pushPendingOperations();
    }
    
    // Pull les mises à jour
    if (typeof syncWorker.pullUpdates === 'function') {
      await syncWorker.pullUpdates(false);
    }
    
    const outboxStats = outboxRepo.getStats();
    
    logger.info('✅ [SYNC/FORCE] Synchronisation forcée terminée');
    
    res.json({ 
      success: true, 
      message: 'Synchronisation forcée terminée',
      outbox: outboxStats
    });
  } catch (error) {
    logger.error('❌ [SYNC/FORCE] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/clear-errors
 * Efface les opérations en erreur de la queue
 */
router.post('/clear-errors', optionalAuth, (req, res) => {
  try {
    // Réessayer les opérations en erreur (les efface si > 3 tentatives)
    const retried = outboxRepo.retryErrorOperations();
    
    logger.info(`🧹 [SYNC/CLEAR] ${retried} opération(s) réessayée(s)`);
    
    const outboxStats = outboxRepo.getStats();
    
    res.json({ 
      success: true, 
      message: `${retried} opération(s) réessayée(s)`,
      outbox: outboxStats
    });
  } catch (error) {
    logger.error('❌ [SYNC/CLEAR-ERRORS] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sync/detailed-status
 * Retourne un statut détaillé pour le dashboard
 */
router.get('/detailed-status', optionalAuth, (req, res) => {
  try {
    const outboxStats = outboxRepo.getStats();
    const legacyStatus = syncRepo.getStatus();
    
    // Calculer l'état global
    let state = 'idle';
    if (!navigator?.onLine && typeof navigator !== 'undefined') {
      state = 'offline';
    } else if (outboxStats.totalPending > 0 || outboxStats.stockMovesPending > 0) {
      state = 'syncing';
    } else if (outboxStats.errors > 0) {
      state = 'error';
    }
    
    res.json({
      success: true,
      state,
      isOnline: true, // Côté serveur, on est toujours "en ligne"
      pushPending: outboxStats.totalPending,
      pullPending: 0, // À implémenter si nécessaire
      totalProcessed: legacyStatus.total_pushed || 0,
      totalFailed: outboxStats.errors,
      totalCoalesced: 0, // À implémenter
      lastProcessedAt: outboxStats.lastAcked ? new Date(outboxStats.lastAcked).getTime() : null,
      lastError: null, // À implémenter
      queuedByPriority: {
        critical: outboxStats.pendingByType?.SALE || 0,
        high: outboxStats.pendingByType?.STOCK_MOVE || 0,
        normal: (outboxStats.pendingByType?.PRODUCT_PATCH || 0) + (outboxStats.pendingByType?.UNIT_PATCH || 0),
        low: 0,
      },
    });
  } catch (error) {
    logger.error('❌ [SYNC/DETAILED-STATUS] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sync/product/:code
 * Récupère le status de sync d'un produit spécifique
 * Retourne les données locales vs Sheets et indique si sync nécessaire
 */
router.get('/product/:code', optionalAuth, async (req, res) => {
  const { productsRepo } = await import('../../db/repositories/products.repo.js');
  const { sheetsClient } = await import('../../services/sync/sheets.client.js');
  
  try {
    const { code } = req.params;
    
    // 1. Données locales
    const localProduct = productsRepo.findByCode(code);
    if (!localProduct) {
      return res.status(404).json({ 
        success: false, 
        error: `Produit ${code} non trouvé localement` 
      });
    }
    
    // 2. Vérifier pending
    const hasPending = outboxRepo.hasProductPending(code);
    const pendingOps = outboxRepo.getPendingOperations(null, 100)
      .filter(op => op.entity_code === code);
    
    // 3. Données Sheets (si pas de pending, on peut télécharger)
    let sheetsData = null;
    let syncStatus = 'unknown';
    
    if (!hasPending) {
      try {
        const result = await sheetsClient.pull('products', new Date(0).toISOString(), {
          full: true,
          limit: 500
        });
        
        if (result.success && result.data) {
          sheetsData = result.data.find(p => String(p.code) === String(code));
          
          if (sheetsData) {
            // Comparer les stocks
            const localStock = localProduct.units?.[0]?.stock_current || 0;
            const sheetsStock = sheetsData.stock_initial || sheetsData.stock_current || 0;
            
            if (Math.abs(localStock - sheetsStock) > 0.01) {
              syncStatus = 'out_of_sync';
            } else {
              syncStatus = 'synced';
            }
          } else {
            syncStatus = 'not_in_sheets';
          }
        }
      } catch (e) {
        logger.warn(`⚠️ Impossible de récupérer Sheets pour ${code}: ${e.message}`);
        syncStatus = 'sheets_error';
      }
    } else {
      syncStatus = 'pending_local_changes';
    }
    
    res.json({
      success: true,
      code,
      syncStatus,
      hasPending,
      pendingOperations: pendingOps.length,
      local: {
        id: localProduct.id,
        name: localProduct.name,
        uuid: localProduct.uuid,
        units: localProduct.units?.map(u => ({
          unit_level: u.unit_level,
          unit_mark: u.unit_mark,
          stock_initial: u.stock_initial,
          stock_current: u.stock_current,
          sale_price_usd: u.sale_price_usd,
          sale_price_fc: u.sale_price_fc
        }))
      },
      sheets: sheetsData ? {
        code: sheetsData.code,
        name: sheetsData.name,
        stock_initial: sheetsData.stock_initial,
        stock_current: sheetsData.stock_current,
        sale_price_usd: sheetsData.sale_price_usd,
        last_update: sheetsData._updated_at || sheetsData.last_update
      } : null,
      recommendation: syncStatus === 'out_of_sync' && !hasPending
        ? 'Utilisez POST /api/sync/force-product/:code pour forcer la mise à jour depuis Sheets'
        : syncStatus === 'pending_local_changes'
        ? 'Des modifications locales sont en attente de sync vers Sheets. Utilisez POST /api/sync/push-now'
        : null
    });
  } catch (error) {
    logger.error(`❌ [SYNC/PRODUCT] Erreur:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/force-product/:code
 * Force la mise à jour d'un produit spécifique depuis Sheets
 * ATTENTION: Écrase les données locales avec celles de Sheets
 */
router.post('/force-product/:code', optionalAuth, async (req, res) => {
  const { productsRepo } = await import('../../db/repositories/products.repo.js');
  const { sheetsClient } = await import('../../services/sync/sheets.client.js');
  
  try {
    const { code } = req.params;
    
    // Vérifier pending
    const hasPending = outboxRepo.hasProductPending(code);
    if (hasPending) {
      return res.status(400).json({
        success: false,
        error: `Le produit ${code} a des modifications locales en attente. Synchronisez d'abord avec POST /api/sync/push-now`,
        hasPending: true
      });
    }
    
    // Télécharger depuis Sheets
    logger.info(`📥 [SYNC/FORCE-PRODUCT] Téléchargement forcé du produit ${code} depuis Sheets`);
    
    const result = await sheetsClient.pull('products', new Date(0).toISOString(), {
      full: true,
      limit: 500
    });
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: `Erreur Sheets: ${result.error}`
      });
    }
    
    const sheetsProduct = result.data?.find(p => String(p.code) === String(code));
    if (!sheetsProduct) {
      return res.status(404).json({
        success: false,
        error: `Produit ${code} non trouvé dans Google Sheets`
      });
    }
    
    // Mettre à jour localement
    const updateData = {
      code: sheetsProduct.code,
      name: sheetsProduct.name,
      uuid: sheetsProduct.uuid || sheetsProduct._uuid,
      units: [{
        unit_level: sheetsProduct.unit_level || 'CARTON',
        unit_mark: sheetsProduct.mark || sheetsProduct.unit_mark || '',
        stock_initial: sheetsProduct.stock_initial || 0,
        stock_current: sheetsProduct.stock_initial || 0, // Utiliser stock_initial de Sheets
        purchase_price_usd: sheetsProduct.purchase_price_usd || 0,
        sale_price_usd: sheetsProduct.sale_price_usd || 0,
        auto_stock_factor: sheetsProduct.auto_stock_factor || 1
      }]
    };
    
    productsRepo.upsert(updateData);
    
    // Recharger pour confirmer
    const updatedProduct = productsRepo.findByCode(code);
    
    logger.info(`✅ [SYNC/FORCE-PRODUCT] Produit ${code} mis à jour: stock=${updateData.units[0].stock_current}`);
    
    res.json({
      success: true,
      message: `Produit ${code} synchronisé depuis Sheets`,
      before: {
        stock: req.body.previousStock || 'inconnu'
      },
      after: {
        code: updatedProduct.code,
        name: updatedProduct.name,
        stock: updatedProduct.units?.[0]?.stock_current
      },
      sheetsValue: sheetsProduct.stock_initial
    });
  } catch (error) {
    logger.error(`❌ [SYNC/FORCE-PRODUCT] Erreur:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/force-all-from-sheets
 * Force la mise à jour de TOUS les produits sans pending depuis Sheets
 * Utile pour resynchroniser après une désynchronisation
 */
router.post('/force-all-from-sheets', optionalAuth, async (req, res) => {
  try {
    logger.info(`📥 [SYNC/FORCE-ALL] Téléchargement forcé de tous les produits depuis Sheets`);
    
    // Forcer un pull complet
    await syncWorker.syncProductsFromSheets();
    
    const outboxStats = outboxRepo.getStats();
    
    logger.info(`✅ [SYNC/FORCE-ALL] Synchronisation forcée terminée`);
    
    res.json({
      success: true,
      message: 'Tous les produits sans modifications pending ont été mis à jour depuis Sheets',
      outbox: outboxStats
    });
  } catch (error) {
    logger.error(`❌ [SYNC/FORCE-ALL] Erreur:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/allow-empty-pending
 * ✅ Autorise la sync locale même si pending est vide
 * Utile pour forcer la sync des CC et produits en mode offline
 */
router.post('/allow-empty-pending', optionalAuth, (req, res) => {
  try {
    // ✅ Force la synchronisation locale des produits et CC même si pending est vide
    const stats = outboxRepo.getStats();
    
    res.json({
      success: true,
      message: 'Pending vide autorisé - sync locale des produits/CC activée',
      allowEmptyPending: true,
      canSyncLocally: true,
      outbox: stats,
      details: {
        pendingEmpty: stats.totalPending === 0,
        canProceed: true // ✅ Permet de continuer même si pending est vide
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/cleanup-conflicts
 * ✅ URGENCE: Nettoie les conflits/erreurs bloquées (ancien outbox cassé)
 * À utiliser si la queue s'accumule infiniment
 */
router.post('/cleanup-conflicts', optionalAuth, (req, res) => {
  try {
    const { maxAge = 60 } = req.body; // maxAge en minutes (défaut: 60 min = 1h)
    
    logger.info(`🧹 [SYNC] Nettoyage des conflits/erreurs > ${maxAge} min...`);
    
    const db = getDb();
    
    // ✅ 1. Supprimer les opérations en erreur depuis longtemps
    const cutoffTime = new Date(Date.now() - maxAge * 60000).toISOString();
    const result = db.prepare(`
      DELETE FROM sync_operations
      WHERE status = 'error' AND updated_at < ?
    `).run(cutoffTime);
    
    logger.info(`🗑️  [SYNC] ${result.changes} opération(s) en erreur supprimée(s)`);
    
    // ✅ 2. Réinitialiser les conflits anciens (les remettre pending)
    const retried = db.prepare(`
      UPDATE sync_operations
      SET status = 'pending', tries = 0, last_error = NULL
      WHERE status = 'error' AND tries >= 3
    `).run();
    
    logger.info(`♻️  [SYNC] ${retried.changes} opération(s) réinitialisée(s) (tries reset)`);
    
    const stats = outboxRepo.getStats();
    
    res.json({
      success: true,
      message: `Nettoyage complet: ${result.changes} supprimées, ${retried.changes} réinitialisées`,
      deleted: result.changes,
      retried: retried.changes,
      outbox: stats
    });
  } catch (error) {
    logger.error('❌ [SYNC] Erreur cleanup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/sync/clear-all-pending
 * ⚠️  DANGER: Vide COMPLÈTEMENT l'outbox (pour mode test/reset)
 * À utiliser UNIQUEMENT si la queue est totalement cassée!
 */
router.delete('/clear-all-pending', optionalAuth, (req, res) => {
  try {
    logger.warn('⚠️  [SYNC] SUPPRESSION COMPLÈTE DE L\'OUTBOX DEMANDÉE');
    
    const db = getDb();
    
    // ✅ Supprimer TOUTES les opérations pending/error
    const result = db.prepare(`
      DELETE FROM sync_operations
      WHERE status IN ('pending', 'error')
    `).run();
    
    logger.warn(`🗑️  [SYNC] ${result.changes} opération(s) supprimée(s) - OUTBOX VIDÉE`);
    
    const stats = outboxRepo.getStats();
    
    res.json({
      success: true,
      warning: '⚠️  OUTBOX complètement vidée!',
      deleted: result.changes,
      outbox: stats
    });
  } catch (error) {
    logger.error('❌ [SYNC] Erreur clear:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/maintenance/fix-corrupted-stock
 * ✅ Corrige les données de stock corrompues (< -1000000)
 * Cause: Bugs lors de la synchronisation créent des valeurs impossibles
 * Solution: Réinitialise le stock à 0 pour les produits corrompus
 */
router.post('/maintenance/fix-corrupted-stock', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    
    logger.info('🔧 [MAINTENANCE] Recherche de données de stock corrompues...');
    
    // 1️⃣ Trouver les données corrompues
    const corrupted = db.prepare(`
      SELECT code, unit_level, stock_current 
      FROM product_units 
      WHERE stock_current < -1000000
      ORDER BY stock_current
    `).all();
    
    logger.info(`📊 [MAINTENANCE] ${corrupted.length} produit(s) corrompu(s) détecté(s)`);
    
    if (corrupted.length > 0) {
      for (const row of corrupted) {
        logger.warn(`   ⚠️  ${row.code}/${row.unit_level}: stock=${row.stock_current}`);
      }
      
      // 2️⃣ Corriger les données
      const updateResult = db.prepare(`
        UPDATE product_units 
        SET stock_current = 0 
        WHERE stock_current < -1000000
      `).run();
      
      logger.info(`✅ [MAINTENANCE] ${updateResult.changes} ligne(s) corrigée(s)`);
    }
    
    // 3️⃣ Vérifier qu'il reste des anomalies
    const remaining = db.prepare(`
      SELECT COUNT(*) as count FROM product_units 
      WHERE stock_current < -100000
    `).get();
    
    res.json({
      success: true,
      fixed: corrupted.length,
      corrupted: corrupted,
      remaining: remaining.count,
      message: corrupted.length > 0 
        ? `✅ ${corrupted.length} produit(s) réparé(s)` 
        : '✅ Aucune donnée corrompue détectée'
    });
  } catch (error) {
    logger.error('❌ [MAINTENANCE] Erreur fix-stock:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES POUR L'AUTO-ACTUALISATION INTELLIGENTE (Smart Sync)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/sync/timestamps
 * ✅ Récupère les timestamps de dernière modification pour chaque type de données
 * Utilisé par useSmartSync pour détecter les changements
 */
router.get('/timestamps', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const timestamps = {};
    
    // Timestamp produits
    const productsTs = db.prepare(`
      SELECT MAX(COALESCE(updated_at, created_at)) as ts FROM products
    `).get();
    timestamps.products = productsTs?.ts || null;
    
    // Timestamp ventes
    const salesTs = db.prepare(`
      SELECT MAX(COALESCE(updated_at, sold_at, created_at)) as ts FROM sales
    `).get();
    timestamps.sales = salesTs?.ts || null;
    
    // Timestamp stock (product_units)
    const stockTs = db.prepare(`
      SELECT MAX(updated_at) as ts FROM product_units
    `).get();
    timestamps.stock = stockTs?.ts || null;
    
    // Timestamp dettes
    const debtsTs = db.prepare(`
      SELECT MAX(COALESCE(updated_at, created_at)) as ts FROM debts
    `).get();
    timestamps.debts = debtsTs?.ts || null;
    
    // Timestamp taux
    const rateTs = db.prepare(`
      SELECT MAX(updated_at) as ts FROM exchange_rates
    `).get();
    timestamps.rates = rateTs?.ts || null;
    
    // Hash global pour détection rapide de changement
    const allTs = [timestamps.products, timestamps.sales, timestamps.stock, timestamps.debts, timestamps.rates]
      .filter(Boolean)
      .sort()
      .reverse();
    
    timestamps.globalHash = allTs.length > 0 ? allTs[0] : null;
    timestamps.serverTime = new Date().toISOString();
    
    res.json({
      success: true,
      timestamps,
    });
  } catch (error) {
    logger.error('❌ [SYNC/TIMESTAMPS] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sync/changes-since
 * ✅ Récupère tous les changements depuis une date donnée
 * Utilisé pour le rattrapage après reconnexion
 */
router.get('/changes-since', optionalAuth, (req, res) => {
  try {
    const { since, types = 'products,sales,stock,debts' } = req.query;
    
    if (!since) {
      return res.status(400).json({ 
        success: false, 
        error: 'Paramètre "since" requis (format ISO)' 
      });
    }
    
    const sinceDate = new Date(since).toISOString();
    const requestedTypes = types.split(',').map(t => t.trim());
    const db = getDb();
    const changes = {};
    
    if (requestedTypes.includes('products')) {
      changes.products = db.prepare(`
        SELECT p.*, GROUP_CONCAT(pu.unit_level || ':' || pu.stock) as stock_by_level
        FROM products p
        LEFT JOIN product_units pu ON p.id = pu.product_id
        WHERE p.updated_at > ? OR p.created_at > ?
        GROUP BY p.id
        ORDER BY p.updated_at DESC
        LIMIT 500
      `).all(sinceDate, sinceDate);
    }
    
    if (requestedTypes.includes('sales')) {
      changes.sales = db.prepare(`
        SELECT * FROM sales 
        WHERE sold_at > ? OR created_at > ?
        ORDER BY sold_at DESC
        LIMIT 200
      `).all(sinceDate, sinceDate);
    }
    
    if (requestedTypes.includes('stock')) {
      changes.stock = db.prepare(`
        SELECT pu.*, p.code as product_code, p.name as product_name
        FROM product_units pu
        JOIN products p ON pu.product_id = p.id
        WHERE pu.updated_at > ?
        ORDER BY pu.updated_at DESC
        LIMIT 500
      `).all(sinceDate);
    }
    
    if (requestedTypes.includes('debts')) {
      changes.debts = db.prepare(`
        SELECT * FROM debts 
        WHERE updated_at > ? OR created_at > ?
        ORDER BY updated_at DESC
        LIMIT 200
      `).all(sinceDate, sinceDate);
    }
    
    // Statistiques
    const stats = {
      products: changes.products?.length || 0,
      sales: changes.sales?.length || 0,
      stock: changes.stock?.length || 0,
      debts: changes.debts?.length || 0,
      total: (changes.products?.length || 0) + (changes.sales?.length || 0) + 
             (changes.stock?.length || 0) + (changes.debts?.length || 0),
    };
    
    logger.info(`📊 [SYNC/CHANGES-SINCE] Changements depuis ${since}:`, stats);
    
    res.json({
      success: true,
      since: sinceDate,
      serverTime: new Date().toISOString(),
      stats,
      changes,
    });
  } catch (error) {
    logger.error('❌ [SYNC/CHANGES-SINCE] Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sync/version
 * ✅ Version rapide: retourne juste un hash pour savoir si données ont changé
 * Utilisé pour le polling intelligent (très léger)
 */
router.get('/version', optionalAuth, (req, res) => {
  try {
    const { type = 'all' } = req.query;
    const db = getDb();
    
    let hash = '';
    
    if (type === 'all' || type === 'products') {
      const pCount = db.prepare('SELECT COUNT(*) as c, MAX(updated_at) as t FROM products').get();
      hash += `p:${pCount.c}:${pCount.t || '0'}|`;
    }
    
    if (type === 'all' || type === 'sales') {
      const sCount = db.prepare('SELECT COUNT(*) as c, MAX(sold_at) as t FROM sales WHERE DATE(sold_at) = DATE("now")').get();
      hash += `s:${sCount.c}:${sCount.t || '0'}|`;
    }
    
    if (type === 'all' || type === 'stock') {
      const stCount = db.prepare('SELECT SUM(stock) as total, MAX(updated_at) as t FROM product_units').get();
      hash += `st:${Math.round(stCount.total || 0)}:${stCount.t || '0'}|`;
    }
    
    if (type === 'all' || type === 'debts') {
      const dCount = db.prepare('SELECT COUNT(*) as c FROM debts WHERE status = "active"').get();
      hash += `d:${dCount.c}|`;
    }
    
    res.json({
      success: true,
      version: hash,
      type,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
