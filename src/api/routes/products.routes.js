import express from 'express';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';
import { getDb } from '../../db/sqlite.js';
import { getSocketIO } from '../socket.js';

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
 * 
 * Utilise le nouveau système d'outbox PRO avec:
 * - Déduplication des patches (last-write-wins)
 * - Idempotence via op_id
 */
router.post('/', authenticate, (req, res) => {
  try {
    const product = productsRepo.upsert(req.body);
    
    // IMPORTANT: Récupérer le produit complet depuis la base pour avoir toutes les données à jour
    const fullProduct = productsRepo.findByCode(product.code);
    
    // Utiliser le nouveau système d'outbox avec déduplication
    // Si on modifie plusieurs fois le même produit offline, seule la dernière valeur sera pushée
    
    // 1. Enqueue le patch produit (nom, etc.) avec déduplication
    outboxRepo.enqueueProductPatch(
      fullProduct.uuid,
      fullProduct.code,
      {
        name: fullProduct.name,
        is_active: fullProduct.is_active !== undefined ? fullProduct.is_active : 1
      }
    );
    
    // 2. Enqueue chaque unité avec déduplication (prix, stock, qty_step, etc.)
    // IMPORTANT: Inclure TOUS les champs nécessaires pour Sheets (sale_price_fc, stock_current)
    if (fullProduct.units && Array.isArray(fullProduct.units)) {
      for (const unit of fullProduct.units) {
        outboxRepo.enqueueUnitPatch(
          fullProduct.uuid,
          fullProduct.code,
          unit.unit_level,
          unit.unit_mark || '',
          {
            purchase_price_usd: unit.purchase_price_usd || 0,
            sale_price_usd: unit.sale_price_usd || 0,
            // CRITIQUE: Inclure sale_price_fc pour les feuilles Milliers et Piece
            sale_price_fc: unit.sale_price_fc || 0,
            // CRITIQUE: Inclure stock_current pour synchronisation stock
            stock_current: unit.stock_current || unit.stock_initial || 0,
            stock_initial: unit.stock_initial || unit.stock_current || 0,
            auto_stock_factor: unit.auto_stock_factor || 1,
            qty_step: unit.qty_step || 1
          }
        );
      }
    }
    
    // Garder aussi l'ancien système pour compatibilité (sera supprimé plus tard)
    syncRepo.addToOutbox('products', product.code, 'upsert', {
      code: fullProduct.code,
      name: fullProduct.name,
      uuid: fullProduct.uuid,
      is_active: fullProduct.is_active !== undefined ? fullProduct.is_active : 1,
      units: (fullProduct.units || []).map(unit => ({
        uuid: unit.uuid,
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark || '',
        stock_initial: unit.stock_initial || 0,
        stock_current: unit.stock_current || 0,
        purchase_price_usd: unit.purchase_price_usd || 0,
        sale_price_usd: unit.sale_price_usd || 0,
        auto_stock_factor: unit.auto_stock_factor || 1,
        qty_step: unit.qty_step || 1,
        last_update: unit.last_update || new Date().toISOString()
      }))
    });

    // Audit log
    auditRepo.log(req.user.id, 'product_upsert', { code: product.code });

    // Émettre l'événement WebSocket pour synchronisation temps réel
    const io = getSocketIO();
    if (io) {
      io.emit('product:updated', fullProduct);
    }

    res.json({ success: true, product: fullProduct });
  } catch (error) {
    logger.error('Erreur POST /api/products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/products/:code
 * Met à jour un produit
 * 
 * Utilise le nouveau système d'outbox PRO avec:
 * - Déduplication des patches (last-write-wins)
 * - Idempotence via op_id
 */
router.put('/:code', authenticate, (req, res) => {
  try {
    const product = productsRepo.upsert({ ...req.body, code: req.params.code });
    
    // Récupérer le produit complet depuis la base pour avoir toutes les données à jour
    const fullProduct = productsRepo.findByCode(req.params.code);
    
    // Utiliser le nouveau système d'outbox avec déduplication
    
    // 1. Enqueue le patch produit (nom, etc.) avec déduplication
    outboxRepo.enqueueProductPatch(
      fullProduct.uuid,
      fullProduct.code,
      {
        name: fullProduct.name,
        is_active: fullProduct.is_active !== undefined ? fullProduct.is_active : 1
      }
    );
    
    // 2. Enqueue chaque unité avec déduplication (prix, stock, qty_step, etc.)
    // IMPORTANT: Inclure TOUS les champs nécessaires pour Sheets (sale_price_fc, stock_current)
    if (fullProduct.units && Array.isArray(fullProduct.units)) {
      for (const unit of fullProduct.units) {
        outboxRepo.enqueueUnitPatch(
          fullProduct.uuid,
          fullProduct.code,
          unit.unit_level,
          unit.unit_mark || '',
          {
            purchase_price_usd: unit.purchase_price_usd || 0,
            sale_price_usd: unit.sale_price_usd || 0,
            // CRITIQUE: Inclure sale_price_fc pour les feuilles Milliers et Piece
            sale_price_fc: unit.sale_price_fc || 0,
            // CRITIQUE: Inclure stock_current pour synchronisation stock
            stock_current: unit.stock_current || unit.stock_initial || 0,
            stock_initial: unit.stock_initial || unit.stock_current || 0,
            auto_stock_factor: unit.auto_stock_factor || 1,
            qty_step: unit.qty_step || 1
          }
        );
      }
    }
    
    // Garder aussi l'ancien système pour compatibilité (sera supprimé plus tard)
    syncRepo.addToOutbox('products', req.params.code, 'upsert', {
      code: fullProduct.code,
      name: fullProduct.name,
      uuid: fullProduct.uuid,
      is_active: fullProduct.is_active !== undefined ? fullProduct.is_active : 1,
      units: (fullProduct.units || []).map(unit => ({
        uuid: unit.uuid,
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark || '',
        stock_initial: unit.stock_initial || 0,
        stock_current: unit.stock_current || 0,
        purchase_price_usd: unit.purchase_price_usd || 0,
        sale_price_usd: unit.sale_price_usd || 0,
        auto_stock_factor: unit.auto_stock_factor || 1,
        qty_step: unit.qty_step || 1,
        last_update: unit.last_update || new Date().toISOString()
      }))
    });

    // Audit log
    auditRepo.log(req.user.id, 'product_update', { code: req.params.code });

    // Émettre l'événement WebSocket
    const io = getSocketIO();
    if (io) {
      io.emit('product:updated', fullProduct);
    }

    res.json({ success: true, product: fullProduct });
  } catch (error) {
    logger.error('Erreur PUT /api/products/:code:', error);
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
 * 
 * IMPORTANT: Cette route supporte deux modes:
 * 1. Mode valeur absolue: { stock_current: 100 } - Met le stock à 100
 * 2. Mode delta (recommandé): { delta: 50, reason: 'adjustment' } - Ajoute 50 au stock
 * 
 * Le mode delta est préféré car il évite les conflits lors de la sync offline
 */
router.put('/:code/units/:unitId/stock', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { code, unitId } = req.params;
    const { stock_current, delta, reason } = req.body;
    
    // Vérifier que l'unité appartient au produit
    const unit = db.prepare(`
      SELECT pu.*, p.uuid as product_uuid
      FROM product_units pu
      JOIN products p ON pu.product_id = p.id
      WHERE pu.id = ? AND p.code = ?
    `).get(unitId, code);
    
    if (!unit) {
      return res.status(404).json({ success: false, error: 'Unité non trouvée pour ce produit' });
    }
    
    let stockDelta = 0;
    let newStock = unit.stock_current;
    
    // Mode delta (recommandé pour offline-first)
    if (delta !== undefined && delta !== null) {
      stockDelta = parseFloat(delta);
      newStock = unit.stock_current + stockDelta;
      
      // Enregistrer le mouvement de stock pour synchronisation
      // IMPORTANT: On envoie des deltas, pas des valeurs absolues
      outboxRepo.enqueueStockMove(
        unit.product_uuid,
        code,
        unit.unit_level,
        unit.unit_mark || '',
        stockDelta,
        reason || 'adjustment',
        null // pas de référence spécifique
      );
      
      logger.info(`📊 [STOCK-MOVE] Mouvement enregistré: ${code}/${unit.unit_level} ${stockDelta > 0 ? '+' : ''}${stockDelta} (${reason || 'adjustment'})`);
    } 
    // Mode valeur absolue (legacy, calcule le delta)
    else if (stock_current !== undefined && stock_current !== null) {
      stockDelta = parseFloat(stock_current) - unit.stock_current;
      newStock = parseFloat(stock_current);
      
      if (stockDelta !== 0) {
        // Enregistrer le mouvement calculé
        outboxRepo.enqueueStockMove(
          unit.product_uuid,
          code,
          unit.unit_level,
          unit.unit_mark || '',
          stockDelta,
          reason || 'correction',
          null
        );
        
        logger.info(`📊 [STOCK-MOVE] Mouvement calculé: ${code}/${unit.unit_level} ${stockDelta > 0 ? '+' : ''}${stockDelta} (correction depuis ${unit.stock_current} vers ${newStock})`);
      }
    } else {
      return res.status(400).json({ 
        success: false, 
        error: 'stock_current ou delta est requis. Préférez utiliser delta pour les ajustements.' 
      });
    }
    
    // Mettre à jour le stock localement
    const result = db.prepare(`
      UPDATE product_units
      SET stock_current = ?,
          stock_initial = ?,
          updated_at = datetime('now'),
          last_update = datetime('now')
      WHERE id = ?
    `).run(newStock, newStock, unitId);
    
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Unité non trouvée' });
    }
    
    // Récupérer l'unité mise à jour
    const updatedUnit = db.prepare('SELECT * FROM product_units WHERE id = ?').get(unitId);
    
    // Audit log
    auditRepo.log(req.user.id, 'stock_update', {
      code,
      unit_id: unitId,
      unit_level: unit.unit_level,
      unit_mark: unit.unit_mark,
      stock_before: unit.stock_current,
      stock_after: newStock,
      delta: stockDelta,
      reason: reason || (delta !== undefined ? 'adjustment' : 'correction')
    });
    
    logger.info(`📦 Stock mis à jour: ${code}/${unit.unit_level} ${unit.stock_current} → ${newStock} (delta: ${stockDelta > 0 ? '+' : ''}${stockDelta})`);
    
    // Émettre l'événement WebSocket pour synchronisation temps réel
    const io = getSocketIO();
    if (io) {
      io.emit('stock:updated', {
        product_code: code,
        unit_id: unitId,
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark,
        stock_before: unit.stock_current,
        stock_current: newStock,
        delta: stockDelta
      });
    }
    
    res.json({
      success: true,
      unit: updatedUnit,
      delta: stockDelta,
      stock_before: unit.stock_current,
      stock_after: newStock
    });
  } catch (error) {
    logger.error('Erreur PUT /api/products/:code/units/:unitId/stock:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

