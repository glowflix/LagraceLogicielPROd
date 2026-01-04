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
    const today = new Date().toISOString().split('T')[0];
    const sales = salesRepo.findAll({
      from: `${today}T00:00:00`,
      to: `${today}T23:59:59`,
    });

    // Agréger par produit
    const productSales = {};
    sales.forEach((sale) => {
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach((item) => {
          const key = item.product_code || item.product_id;
          if (!productSales[key]) {
            productSales[key] = {
              code: item.product_code,
              name: item.product_name,
              totalQty: 0,
              totalFC: 0,
              totalUSD: 0,
              count: 0,
            };
          }
          productSales[key].totalQty += item.qty || 0;
          productSales[key].totalFC += item.subtotal_fc || 0;
          productSales[key].totalUSD += item.subtotal_usd || 0;
          productSales[key].count += 1;
        });
      }
    });

    // Convertir en tableau et trier par totalFC
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.totalFC - a.totalFC)
      .slice(0, 10);

    res.json(topProducts);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/hourly
 * Données de ventes par heure (aujourd'hui)
 */
router.get('/hourly', optionalAuth, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sales = salesRepo.findAll({
      from: `${today}T00:00:00`,
      to: `${today}T23:59:59`,
    });

    // Initialiser les 24 heures
    const hourlyData = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      hourLabel: `${String(i).padStart(2, '0')}:00`,
      salesFC: 0,
      salesUSD: 0,
      invoices: 0,
      count: 0,
    }));

    // Remplir les données
    sales.forEach((sale) => {
      if (sale.status === 'void') return;
      
      const saleDate = new Date(sale.created_at);
      const hour = saleDate.getHours();
      
      if (hour >= 0 && hour < 24) {
        hourlyData[hour].salesFC += sale.total_fc || 0;
        hourlyData[hour].salesUSD += sale.total_usd || 0;
        hourlyData[hour].invoices += 1;
        hourlyData[hour].count += 1;
      }
    });

    res.json(hourlyData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/summary
 * Résumé complet pour la page analytics
 */
router.get('/summary', optionalAuth, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sales = salesRepo.findAll({
      from: `${today}T00:00:00`,
      to: `${today}T23:59:59`,
    });

    // Total du jour
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

    // Calcul du taux de conversion (invoices payées / total)
    const conversionRate = todayInvoices > 0 
      ? (sales.filter((s) => s.status === 'paid' && s.status !== 'void').length / todayInvoices) * 100
      : 0;

    // Panier moyen
    const averageCart = todayInvoices > 0 ? todaySalesFC / todayInvoices : 0;

    res.json({
      todaySalesFC,
      todaySalesUSD,
      todayInvoices,
      todayCollected,
      conversionRate,
      averageCart,
      lastUpdate: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

