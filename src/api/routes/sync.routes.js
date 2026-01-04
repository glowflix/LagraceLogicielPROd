import express from 'express';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { syncWorker } from '../../services/sync/sync.instance.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';

const router = express.Router();

/**
 * GET /api/sync/status
 * Récupère le statut de synchronisation (ancien + nouveau système)
 */
router.get('/status', optionalAuth, (req, res) => {
  try {
    const legacyStatus = syncRepo.getStatus();
    const outboxStats = outboxRepo.getStats();
    
    res.json({
      ...legacyStatus,
      outbox: outboxStats,
      hasPendingChanges: outboxStats.totalPending > 0 || outboxStats.stockMovesPending > 0
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

export default router;

