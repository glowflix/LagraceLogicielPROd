import express from 'express';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';
import { getDb } from '../../db/sqlite.js';

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

/**
 * GET /api/products/diagnostic/info
 * Endpoint de diagnostic pour comprendre pourquoi les produits ne s'affichent pas
 */
router.get('/diagnostic/info', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    
    // Compter les produits
    const productsCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get();
    const allProductsCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
    const unitsCount = db.prepare('SELECT COUNT(*) as count FROM product_units').get();
    
    // Vérifier la dernière synchronisation
    const lastPullDate = syncRepo.getLastPullDate('products');
    const initialImportDone = syncRepo.isInitialImportDone();
    
    // Vérifier les produits sans unités
    const productsWithoutUnits = db.prepare(`
      SELECT p.code, p.name, COUNT(pu.id) as units_count
      FROM products p
      LEFT JOIN product_units pu ON p.id = pu.product_id
      WHERE p.is_active = 1
      GROUP BY p.id
      HAVING units_count = 0
    `).all();
    
    // Vérifier les unités sans produit
    const unitsWithoutProduct = db.prepare(`
      SELECT COUNT(*) as count
      FROM product_units pu
      LEFT JOIN products p ON pu.product_id = p.id
      WHERE p.id IS NULL
    `).get();
    
    // Vérifier les produits avec codes vides
    const productsWithEmptyCode = db.prepare(`
      SELECT COUNT(*) as count
      FROM products
      WHERE (code IS NULL OR code = '' OR code = 'undefined' OR code = 'null')
    `).get();
    
    res.json({
      success: true,
      diagnostic: {
        products: {
          active: productsCount.count,
          total: allProductsCount.count,
          without_units: productsWithoutUnits.length,
          with_empty_code: productsWithEmptyCode.count
        },
        units: {
          total: unitsCount.count,
          without_product: unitsWithoutProduct.count
        },
        sync: {
          last_pull_date: lastPullDate || 'Jamais',
          initial_import_done: initialImportDone,
          webapp_url_configured: !!process.env.GOOGLE_SHEETS_WEBAPP_URL
        },
        issues: [
          ...(productsCount.count === 0 ? ['Aucun produit actif dans la base de données'] : []),
          ...(productsWithoutUnits.length > 0 ? [`${productsWithoutUnits.length} produit(s) sans unités`] : []),
          ...(productsWithEmptyCode.count > 0 ? [`${productsWithEmptyCode.count} produit(s) avec code vide`] : []),
          ...(!lastPullDate ? ['Aucune synchronisation effectuée'] : []),
          ...(!process.env.GOOGLE_SHEETS_WEBAPP_URL ? ['URL Google Sheets non configurée'] : [])
        ],
        recommendations: [
          ...(productsCount.count === 0 ? [
            '1. Vérifier que la synchronisation s\'est bien déclenchée',
            '2. Vérifier dans Google Sheets que les colonnes "Code produit" sont bien remplies dans les feuilles Carton, Milliers, Piece',
            '3. Vérifier les logs de synchronisation pour voir si des erreurs se sont produites',
            '4. Forcer une synchronisation manuelle depuis la page Sync'
          ] : []),
          ...(productsWithoutUnits.length > 0 ? [
            `${productsWithoutUnits.length} produit(s) n'ont pas d'unités associées. Vérifier la synchronisation.`
          ] : [])
        ]
      }
    });
  } catch (error) {
    logger.error('Erreur diagnostic produits:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/products/:code/units/:unitId/stock
 * Met à jour le stock d'une unité de produit
 */
router.put('/:code/units/:unitId/stock', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { code, unitId } = req.params;
    const { stock_current } = req.body;
    
    if (stock_current === undefined || stock_current === null) {
      return res.status(400).json({ success: false, error: 'stock_current est requis' });
    }
    
    // Vérifier que l'unité appartient au produit
    const unit = db.prepare(`
      SELECT pu.id, pu.product_id, p.code
      FROM product_units pu
      JOIN products p ON pu.product_id = p.id
      WHERE pu.id = ? AND p.code = ?
    `).get(unitId, code);
    
    if (!unit) {
      return res.status(404).json({ success: false, error: 'Unité non trouvée pour ce produit' });
    }
    
    // Mettre à jour le stock
    const result = db.prepare(`
      UPDATE product_units
      SET stock_current = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(stock_current, unitId);
    
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Unité non trouvée' });
    }
    
    // Ajouter à l'outbox pour synchronisation
    const updatedUnit = db.prepare('SELECT * FROM product_units WHERE id = ?').get(unitId);
    syncRepo.addToOutbox('product_units', `${code}-${updatedUnit.unit_level}`, 'upsert', {
      code,
      unit_level: updatedUnit.unit_level,
      unit_mark: updatedUnit.unit_mark,
      stock_current: updatedUnit.stock_current
    });
    
    // Audit log
    auditRepo.log(req.user.id, 'stock_update', {
      code,
      unit_id: unitId,
      stock_current
    });
    
    logger.info(`📦 Stock mis à jour: ${code} (unité ${unitId}) → ${stock_current}`);
    
    res.json({
      success: true,
      unit: updatedUnit
    });
  } catch (error) {
    logger.error('Erreur PUT /api/products/:code/units/:unitId/stock:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

