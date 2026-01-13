import express from 'express';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { debtPaymentsRepo } from '../../db/repositories/debt-payments.repo.js';
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

    // Cash collecté sur les ventes créées aujourd'hui (inclut ventes en dette/partial si paid_* > 0)
    const todayCollectedFromSales = sales
      .filter((s) => s.status !== 'void')
      .reduce((sum, s) => {
        const paid = Number(s.paid_fc || 0);
        return paid > 0 ? sum + paid : sum;
      }, 0);

    const todayCollectedUSDFromSales = sales
      .filter((s) => s.status !== 'void')
      .reduce((sum, s) => {
        const paid = Number(s.paid_usd || 0);
        return paid > 0 ? sum + paid : sum;
      }, 0);

    // Paiements de dettes effectués aujourd'hui (doivent compter dans le cash du jour)
    const debtPaymentsToday = debtPaymentsRepo.getDayTotal(new Date().toISOString());
    const todayDebtPaymentsFC = Number(debtPaymentsToday?.total_fc || 0);
    const todayDebtPaymentsUSD = Number(debtPaymentsToday?.total_usd || 0);

    const todayCollected = todayCollectedFromSales + todayDebtPaymentsFC;
    const todayCollectedUSD = todayCollectedUSDFromSales + todayDebtPaymentsUSD;

    const allDebts = debtsRepo.findAll();
    const openDebts = allDebts.filter((d) => d.status === 'open' || d.status === 'partial');
    const openDebtsTotal = openDebts.reduce((sum, d) => sum + (d.remaining_fc || 0), 0);

    const lowStock = stockRepo.getLowStock(10);

    res.json({
      todaySalesFC,
      todaySalesUSD,
      todayInvoices,
      todayCollected,
      todayCollectedUSD,
      todayCollectedFromSales,
      todayCollectedUSDFromSales,
      todayDebtPaymentsFC,
      todayDebtPaymentsUSD,
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

    const todayCollectedFromSales = sales
      .filter((s) => s.status !== 'void')
      .reduce((sum, s) => {
        const paid = Number(s.paid_fc || 0);
        return paid > 0 ? sum + paid : sum;
      }, 0);

    const todayCollectedUSDFromSales = sales
      .filter((s) => s.status !== 'void')
      .reduce((sum, s) => {
        const paid = Number(s.paid_usd || 0);
        return paid > 0 ? sum + paid : sum;
      }, 0);

    const debtPaymentsToday = debtPaymentsRepo.getDayTotal(new Date().toISOString());
    const todayDebtPaymentsFC = Number(debtPaymentsToday?.total_fc || 0);
    const todayDebtPaymentsUSD = Number(debtPaymentsToday?.total_usd || 0);

    const todayCollected = todayCollectedFromSales + todayDebtPaymentsFC;
    const todayCollectedUSD = todayCollectedUSDFromSales + todayDebtPaymentsUSD;

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
      todayCollectedUSD,
      todayCollectedFromSales,
      todayCollectedUSDFromSales,
      todayDebtPaymentsFC,
      todayDebtPaymentsUSD,
      conversionRate,
      averageCart,
      lastUpdate: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/debts
 * Statistiques complètes des dettes pour la page Analytics
 */
router.get('/debts', optionalAuth, (req, res) => {
  try {
    const allDebts = debtsRepo.findAll();
    const today = new Date().toISOString().split('T')[0];
    
    // Dettes par statut
    const openDebts = allDebts.filter(d => d.status === 'open');
    const partialDebts = allDebts.filter(d => d.status === 'partial');
    const paidDebts = allDebts.filter(d => d.status === 'paid' || d.status === 'closed');
    
    // Totaux FC
    const totalDebtFC = allDebts.reduce((sum, d) => sum + (d.total_fc || 0), 0);
    const totalPaidFC = allDebts.reduce((sum, d) => sum + (d.paid_fc || 0), 0);
    const totalRemainingFC = allDebts.reduce((sum, d) => sum + (d.remaining_fc || 0), 0);
    
    // Totaux USD
    const totalDebtUSD = allDebts.reduce((sum, d) => sum + (d.total_usd || 0), 0);
    const totalRemainingUSD = allDebts.reduce((sum, d) => {
      // Si la dette a un taux, convertir le restant
      if (d.total_usd && d.total_fc) {
        const rate = d.total_fc / d.total_usd;
        return sum + (d.remaining_fc / rate);
      }
      return sum + (d.remaining_fc / 2800); // Taux par défaut
    }, 0);
    
    // Top 10 clients endettés
    const debtsByClient = {};
    allDebts.forEach(d => {
      const client = d.client_name || 'Inconnu';
      if (!debtsByClient[client]) {
        debtsByClient[client] = {
          client_name: client,
          total_fc: 0,
          paid_fc: 0,
          remaining_fc: 0,
          count: 0,
        };
      }
      debtsByClient[client].total_fc += d.total_fc || 0;
      debtsByClient[client].paid_fc += d.paid_fc || 0;
      debtsByClient[client].remaining_fc += d.remaining_fc || 0;
      debtsByClient[client].count += 1;
    });
    
    const topDebtors = Object.values(debtsByClient)
      .filter(c => c.remaining_fc > 0)
      .sort((a, b) => b.remaining_fc - a.remaining_fc)
      .slice(0, 10);
    
    // Dettes créées aujourd'hui
    const debtsToday = allDebts.filter(d => {
      const created = d.created_at || '';
      return created.startsWith(today);
    });
    
    // Paiements de dettes aujourd'hui
    const debtPaymentsToday = debtPaymentsRepo.getDayTotal(new Date().toISOString());
    
    // Évolution des dettes (7 derniers jours)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayLabel = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
      
      // Dettes créées ce jour
      const dayDebts = allDebts.filter(d => {
        const created = (d.created_at || '').split('T')[0];
        return created === dateStr;
      });
      
      last7Days.push({
        date: dateStr,
        label: dayLabel,
        newDebts: dayDebts.reduce((sum, d) => sum + (d.total_fc || 0), 0),
        newDebtsCount: dayDebts.length,
      });
    }
    
    res.json({
      // Compteurs
      totalDebts: allDebts.length,
      openDebtsCount: openDebts.length,
      partialDebtsCount: partialDebts.length,
      paidDebtsCount: paidDebts.length,
      
      // Montants FC
      totalDebtFC,
      totalPaidFC,
      totalRemainingFC,
      
      // Montants USD
      totalDebtUSD,
      totalRemainingUSD,
      
      // Aujourd'hui
      debtsTodayCount: debtsToday.length,
      debtsTodayFC: debtsToday.reduce((sum, d) => sum + (d.total_fc || 0), 0),
      paymentsToday: {
        fc: debtPaymentsToday?.total_fc || 0,
        usd: debtPaymentsToday?.total_usd || 0,
      },
      
      // Top clients endettés
      topDebtors,
      
      // Évolution 7 jours
      last7Days,
      
      // Taux de recouvrement
      recoveryRate: totalDebtFC > 0 ? ((totalPaidFC / totalDebtFC) * 100).toFixed(1) : 0,
      
      lastUpdate: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

