import express from 'express';
import { stockRepo } from '../../db/repositories/stock.repo.js';
import { optionalAuth } from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /api/stock
 * Récupère le stock par niveau (carton, millier, piece)
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const { level } = req.query;
    
    if (level) {
      const stock = stockRepo.findByLevel(level.toUpperCase());
      res.json(stock);
    } else {
      // Retourner tous les niveaux
      const carton = stockRepo.findByLevel('CARTON');
      const millier = stockRepo.findByLevel('MILLIER');
      const piece = stockRepo.findByLevel('PIECE');
      
      res.json({
        carton,
        millier,
        piece,
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stock/mark
 * Récupère le mark d'un produit
 */
router.get('/mark', optionalAuth, (req, res) => {
  try {
    const { code, level, mark } = req.query;
    
    if (!code || !level) {
      return res.status(400).json({
        success: false,
        error: 'Code produit et niveau requis',
      });
    }

    const productMark = stockRepo.getMark(code, level.toUpperCase(), mark || '');
    res.json({ mark: productMark || '' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stock/low
 * Récupère les produits avec stock faible
 */
router.get('/low', optionalAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const lowStock = stockRepo.getLowStock(limit);
    res.json(lowStock);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

