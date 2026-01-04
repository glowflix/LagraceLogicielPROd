import express from 'express';
import { autoSyncService } from '../services/autoSync.service.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /api/autosync/stats
 * Retourne les stats du dernier cycle de sync automatique
 */
router.get('/stats', optionalAuth, (req, res) => {
  try {
    const stats = autoSyncService.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/autosync/trigger
 * Force un cycle de sync immédiat
 */
router.post('/trigger', authenticate, (req, res) => {
  try {
    autoSyncService.performSync();
    res.json({
      success: true,
      message: 'Synchronisation déclenchée',
      stats: autoSyncService.getStats()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
