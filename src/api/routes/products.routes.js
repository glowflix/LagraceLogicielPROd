import express from 'express';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';

const router = express.Router();

/**
 * GET /api/products
 * Liste tous les produits
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const products = productsRepo.findAll();
    logger.debug(`📤 GET /api/products: ${products.length} produit(s) retourné(s)`);
    res.json(products);
  } catch (error) {
    logger.error('Erreur GET /api/products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/products/:code
 * Récupère un produit par code
 */
router.get('/:code', optionalAuth, (req, res) => {
  try {
    const product = productsRepo.findByCode(req.params.code);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/products
 * Crée ou met à jour un produit
 */
router.post('/', authenticate, (req, res) => {
  try {
    const product = productsRepo.upsert(req.body);
    
    // Ajouter à l'outbox de synchronisation
    syncRepo.addToOutbox('products', product.code, 'upsert', req.body);
    if (req.body.units) {
      req.body.units.forEach((unit) => {
        syncRepo.addToOutbox('product_units', `${product.code}-${unit.unit_level}`, 'upsert', {
          ...req.body,
          ...unit,
        });
      });
    }

    // Audit log
    auditRepo.log(req.user.id, 'product_upsert', { code: product.code });

    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/products/:code
 * Met à jour un produit
 */
router.put('/:code', authenticate, (req, res) => {
  try {
    const product = productsRepo.upsert({ ...req.body, code: req.params.code });
    
    // Ajouter à l'outbox
    syncRepo.addToOutbox('products', req.params.code, 'upsert', req.body);

    // Audit log
    auditRepo.log(req.user.id, 'product_update', { code: req.params.code });

    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

