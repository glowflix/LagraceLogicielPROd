import express from 'express';
import { ratesRepo } from '../../db/repositories/rates.repo.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { optionalAuth } from '../middlewares/auth.js';
import { getSocketIO } from '../socket.js';

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

    // Ajouter à l'outbox pour synchronisation avec Sheets
    syncRepo.addToOutbox('rates', 'current', 'upsert', {
      rate_fc_per_usd: newRate,
      effective_at: new Date().toISOString(),
    });

    // Émettre l'événement WebSocket pour synchronisation temps réel
    const io = getSocketIO();
    if (io) {
      io.emit('rate:updated', { rate: newRate, effective_at: new Date().toISOString() });
    }

    res.json({ success: true, rate: newRate });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

