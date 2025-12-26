import express from 'express';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { syncWorker } from '../../services/sync/sync.worker.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /api/sync/status
 * Récupère le statut de synchronisation
 */
router.get('/status', optionalAuth, (req, res) => {
  try {
    const status = syncRepo.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/push-now
 * Force un push vers Google Sheets
 */
router.post('/push-now', authenticate, async (req, res) => {
  try {
    await syncWorker.pushPending();
    const status = syncRepo.getStatus();
    res.json({
      success: true,
      message: 'Push terminé',
      status,
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

export default router;

