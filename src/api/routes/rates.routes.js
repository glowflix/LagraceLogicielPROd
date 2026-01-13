import express from 'express';
import { ratesRepo } from '../../db/repositories/rates.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { optionalAuth } from '../middlewares/auth.js';
import { getSocketIO } from '../socket.js';
import { logger } from '../../core/logger.js';

const router = express.Router();

/**
 * GET /api/rates/current
 * Récupère le taux de change actuel
 */
router.get('/current', optionalAuth, (req, res) => {
  try {
    const rate = ratesRepo.getCurrent();
    res.json({ success: true, rate });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/rates/current
 * Met à jour le taux de change (peut être utilisé sans authentification si licence activée)
 * ✅ Synchronise automatiquement avec Google Sheets (feuille "Taux")
 */
router.put('/current', optionalAuth, (req, res) => {
  try {
    const { rate } = req.body;
    
    if (!rate || isNaN(rate)) {
      return res.status(400).json({
        success: false,
        error: 'Taux invalide',
      });
    }

    // Utiliser l'ID utilisateur si disponible, sinon null (pour mode sans authentification)
    const userId = req.user?.id || null;
    const newRate = ratesRepo.updateCurrent(parseFloat(rate), userId);

    // ✅ Ajouter à l'outbox PRO pour synchronisation avec Sheets
    const opId = outboxRepo.enqueueRate(newRate, new Date().toISOString());
    logger.info(`💱 [RATES] Taux mis à jour: ${newRate} FC/USD, sync op_id=${opId}`);

    // Émettre l'événement WebSocket pour synchronisation temps réel
    const io = getSocketIO();
    if (io) {
      io.emit('rate:updated', { rate: newRate, effective_at: new Date().toISOString() });
    }

    res.json({ success: true, rate: newRate });
  } catch (error) {
    logger.error('❌ [RATES] Erreur mise à jour taux:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

