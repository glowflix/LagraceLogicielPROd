import express from 'express';
import { optionalAuth } from '../middlewares/auth.js';
import { printJobsRepo } from '../../db/repositories/print-jobs.repo.js';

const router = express.Router();

/**
 * GET /api/print/printers
 * Liste les imprimantes disponibles
 */
router.get('/printers', optionalAuth, (req, res) => {
  try {
    // TODO: Implémenter la détection des imprimantes
    res.json([]);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/print/templates
 * Liste les templates disponibles
 */
router.get('/templates', optionalAuth, (req, res) => {
  try {
    res.json([
      { id: 'receipt-80', name: 'Ticket 80mm' },
      { id: 'product-tag-vertical', name: 'Étiquette produit verticale' },
    ]);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/print/queue
 * Liste les jobs d'impression en attente
 */
router.get('/queue', optionalAuth, (req, res) => {
  try {
    // TODO: Implémenter la queue d'impression
    res.json([]);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/print/errors
 * Liste les erreurs d'impression
 */
router.get('/errors', optionalAuth, (req, res) => {
  try {
    // TODO: Implémenter la gestion des erreurs
    res.json([]);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/print/status/:invoice
 * Récupère le statut d'impression pour une facture
 */
router.get('/status/:invoice', optionalAuth, (req, res) => {
  try {
    const status = printJobsRepo.getStatus(req.params.invoice);
    // Retourner toujours un statut valide, même si aucun job n'existe
    res.json(status || { status: 'none', message: 'Aucun job trouvé' });
  } catch (error) {
    // En cas d'erreur, retourner un statut par défaut au lieu d'une erreur 500
    res.json({ status: 'none', message: 'Erreur lors de la récupération du statut', error: error.message });
  }
});

export default router;

