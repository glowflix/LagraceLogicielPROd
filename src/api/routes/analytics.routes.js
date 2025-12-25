import express from 'express';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { stockRepo } from '../../db/repositories/stock.repo.js';
import { optionalAuth } from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /api/analytics/today
 * Statistiques du jour
 */
router.get('/today', optionalAuth, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sales = salesRepo.findAll({
      from: `${today}T00:00:00`,
      to: `${today}T23:59:59`,
    });

    const todaySalesFC = sales
      .filter((s) => s.status !== 'void')
      .reduce((sum, s) => sum + (s.total_fc || 0), 0);

    const todaySalesUSD = sales
      .filter((s) => s.status !== 'void')
      .reduce((sum, s) => sum + (s.total_usd || 0), 0);

    const todayInvoices = sales.filter((s) => s.status !== 'void').length;

    const todayCollected = sales
      .filter((s) => s.status === 'paid')
      .reduce((sum, s) => sum + (s.paid_fc || 0), 0);

    const allDebts = debtsRepo.findAll();
    const openDebts = allDebts.filter((d) => d.status === 'open' || d.status === 'partial');
    const openDebtsTotal = openDebts.reduce((sum, d) => sum + (d.remaining_fc || 0), 0);

    const lowStock = stockRepo.getLowStock(10);

    res.json({
      todaySalesFC,
      todaySalesUSD,
      todayInvoices,
      todayCollected,
      openDebts: openDebtsTotal,
      openDebtsCount: openDebts.length,
      lowStock: lowStock.map((item) => ({
        code: item.product_code,
        name: item.product_name,
        stock_current: item.stock_current,
        unit_mark: item.unit_mark,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/range
 * Statistiques sur une période
 */
router.get('/range', optionalAuth, (req, res) => {
  try {
    const { from, to } = req.query;
    
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres from et to requis',
      });
    }

    const sales = salesRepo.findAll({ from, to });

    res.json({
      sales,
      totalFC: sales.reduce((sum, s) => sum + (s.total_fc || 0), 0),
      totalUSD: sales.reduce((sum, s) => sum + (s.total_usd || 0), 0),
      count: sales.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/top-products
 * Top produits vendus
 */
router.get('/top-products', optionalAuth, (req, res) => {
  try {
    // TODO: Implémenter la logique des top produits
    res.json([]);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

