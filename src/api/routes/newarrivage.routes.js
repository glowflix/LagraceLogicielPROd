/**
 * New Arrivage Routes
 * API pour la gestion des nouveaux arrivages (modifications de stock)
 */

import express from 'express';
import { stockModificationsRepo } from '../../db/repositories/stock-modifications.repo.js';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { optionalAuth, authenticate } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';
import { getDb } from '../../db/sqlite.js';

const router = express.Router();

/**
 * GET /api/newarrivage
 * Liste toutes les modifications de stock (New Arrivage)
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const { limit, offset, startDate, endDate, unitLevel, modType, showAllStock } = req.query;
    
    const modifications = stockModificationsRepo.findAll({
      limit: parseInt(limit) || 500,
      offset: parseInt(offset) || 0,
      startDate: startDate || null,
      endDate: endDate || null,
      unitLevel: unitLevel || null,
      modType: modType || null,
      showAllStock: showAllStock === 'true'
    });
    
    res.json(modifications);
  } catch (error) {
    logger.error('Erreur GET /api/newarrivage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/newarrivage/stats
 * Statistiques des modifications de stock
 */
router.get('/stats', optionalAuth, (req, res) => {
  try {
    const stats = stockModificationsRepo.getStats();
    res.json(stats);
  } catch (error) {
    logger.error('Erreur GET /api/newarrivage/stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/newarrivage/export
 * Exporter les données pour impression A4
 */
router.get('/export', optionalAuth, (req, res) => {
  try {
    const { unitLevel, withStock, format = 'json' } = req.query;
    
    let withStockBool = null;
    if (withStock === 'true') withStockBool = true;
    if (withStock === 'false') withStockBool = false;
    
    const data = stockModificationsRepo.exportForPrint({
      unitLevel: unitLevel || null,
      withStock: withStockBool
    });
    
    if (format === 'csv') {
      // Export CSV
      const headers = ['Code', 'Nom', 'Unité', 'Mark', 'Stock', 'Prix FC', 'Prix USD', 'Prix Achat', 'Date', 'Total FC'];
      const csvLines = [headers.join(';')];
      
      for (const row of data) {
        csvLines.push([
          row.code,
          `"${(row.nom || '').replace(/"/g, '""')}"`,
          row.unit_level,
          row.unit_mark,
          row.stock,
          row.prix_fc,
          row.prix_usd,
          row.prix_achat,
          row.date_modification,
          row.total_fc
        ].join(';'));
      }
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="new-arrivage.csv"');
      res.send('\uFEFF' + csvLines.join('\n')); // BOM pour Excel
    } else {
      res.json(data);
    }
  } catch (error) {
    logger.error('Erreur GET /api/newarrivage/export:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/newarrivage/products
 * Obtenir tous les produits pour export A4
 */
router.get('/products', optionalAuth, (req, res) => {
  try {
    const { unitLevel, withStock } = req.query;
    const db = getDb();
    
    let query = `
      SELECT 
        p.code,
        p.name as nom,
        pu.unit_level,
        pu.unit_mark,
        pu.stock_current as stock,
        pu.sale_price_fc as prix_fc,
        pu.sale_price_usd as prix_usd,
        pu.purchase_price_usd as prix_achat,
        (pu.stock_current * pu.sale_price_fc) as total_fc,
        p.updated_at as date_modification
      FROM products p
      INNER JOIN product_units pu ON p.id = pu.product_id
      WHERE p.is_active = 1
    `;
    
    const params = [];
    
    if (unitLevel) {
      query += ` AND pu.unit_level = ?`;
      params.push(unitLevel);
    }
    
    if (withStock === 'true') {
      query += ` AND pu.stock_current > 0`;
    } else if (withStock === 'false') {
      query += ` AND pu.stock_current = 0`;
    }
    
    query += ` ORDER BY p.code ASC`;
    
    const products = db.prepare(query).all(...params);
    res.json(products);
  } catch (error) {
    logger.error('Erreur GET /api/newarrivage/products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/newarrivage/:id
 * Supprimer une modification
 */
router.delete('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const success = stockModificationsRepo.delete(parseInt(id));
    
    if (success) {
      res.json({ success: true, message: 'Modification supprimée' });
    } else {
      res.status(404).json({ success: false, error: 'Modification non trouvée' });
    }
  } catch (error) {
    logger.error('Erreur DELETE /api/newarrivage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/newarrivage
 * Supprimer toutes les modifications (vider New Arrivage)
 */
router.delete('/', authenticate, (req, res) => {
  try {
    const count = stockModificationsRepo.deleteAll();
    res.json({ success: true, message: `${count} modification(s) supprimée(s)` });
  } catch (error) {
    logger.error('Erreur DELETE /api/newarrivage (all):', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/newarrivage/clean-duplicates
 * Nettoyer les doublons
 */
router.post('/clean-duplicates', authenticate, (req, res) => {
  try {
    const count = stockModificationsRepo.cleanDuplicates();
    res.json({ success: true, message: `${count} doublon(s) nettoyé(s)` });
  } catch (error) {
    logger.error('Erreur POST /api/newarrivage/clean-duplicates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
