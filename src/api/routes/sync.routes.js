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
router.post('/pull-now', authenticate, async (req, res) => {
  try {
    await syncWorker.pullUpdates();
    const status = syncRepo.getStatus();
    res.json({
      success: true,
      message: 'Pull terminé',
      status,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync/now
 * Force une synchronisation complète (push + pull)
 */
router.post('/now', authenticate, async (req, res) => {
  try {
    await syncWorker.syncNow();
    const status = syncRepo.getStatus();
    res.json({
      success: true,
      message: 'Synchronisation terminée',
      status,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

