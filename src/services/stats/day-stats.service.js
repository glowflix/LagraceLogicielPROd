import { getDb } from '../../db/sqlite.js';
import { logger } from '../../core/logger.js';

/**
 * Service de statistiques du jour
 * 
 * RÈGLES MÉTIER IMPORTANTES:
 * 
 * 1. Vente normale (sans dette):
 *    - Comptabilisée dans "argent des ventes du jour"
 *    - total_fc/total_usd ajouté aux stats
 * 
 * 2. Vente en mode dette (crédit):
 *    - Le TOTAL de la dette n'est PAS dans "argent des ventes du jour"
 *    - SEULEMENT le paiement initial (si fourni) est comptabilisé
 * 
 * 3. Paiement d'une dette ultérieur:
 *    - Le montant payé est comptabilisé dans les stats du JOUR DU PAIEMENT
 *    - Même si la dette a été créée un autre jour
 * 
 * FORMULE:
 * Cash du jour = Ventes normales du jour + Paiements de dettes du jour
 */
export class DayStatsService {
  /**
   * Récupère les statistiques complètes d'un jour
   * @param {string} dateISO - Date au format ISO (YYYY-MM-DD ou full ISO)
   * @param {Object} options - Options { rateForFc }
   * @returns {Object} - Statistiques du jour
   */
  getDayStats(dateISO, options = {}) {
    const db = getDb();
    const dateOnly = dateISO.substring(0, 10);
    const rateForFc = options.rateForFc || this.getCurrentRate();
    
    try {
      logger.info(`📊 [DayStats] Calcul statistiques pour ${dateOnly}`);
      
      // 1. Ventes normales du jour (payment_mode != 'dette' et pas de dette associée)
      const normalSales = this._getNormalSalesStats(db, dateOnly);
      
      // 2. Paiements de dettes du jour (tous les paiements effectués ce jour)
      const debtPayments = this._getDebtPaymentsStats(db, dateOnly);
      
      // 3. Dettes créées le jour (pour info, pas dans le cash)
      const debtsCreated = this._getDebtsCreatedStats(db, dateOnly);
      
      // 4. Totaux combinés (cash réel encaissé)
      const totalCashUsd = (normalSales.total_usd || 0) + (debtPayments.total_usd || 0);
      const totalCashFc = (normalSales.total_fc || 0) + (debtPayments.total_fc || 0);
      
      const stats = {
        date: dateOnly,
        rate_fc_per_usd: rateForFc,
        
        // Cash réel encaissé (ce qui compte vraiment)
        total_cash_usd: Math.round(totalCashUsd * 100) / 100,
        total_cash_fc: Math.round(totalCashFc * 100) / 100,
        
        // Détail: Ventes normales
        normal_sales: {
          count: normalSales.count || 0,
          total_usd: normalSales.total_usd || 0,
          total_fc: normalSales.total_fc || 0,
          items_count: normalSales.items_count || 0
        },
        
        // Détail: Paiements de dettes
        debt_payments: {
          count: debtPayments.count || 0,
          total_usd: debtPayments.total_usd || 0,
          total_fc: debtPayments.total_fc || 0,
          debts_concerned: debtPayments.debts_count || 0
        },
        
        // Info: Dettes créées (pas dans le cash)
        debts_created: {
          count: debtsCreated.count || 0,
          total_amount_usd: debtsCreated.total_usd || 0,
          total_amount_fc: debtsCreated.total_fc || 0,
          initial_payments_usd: debtsCreated.initial_payments_usd || 0
        },
        
        // Résumé rapide
        summary: {
          transactions_count: (normalSales.count || 0) + (debtPayments.count || 0),
          total_usd: totalCashUsd,
          total_fc: totalCashFc,
          // Équivalent FC au taux du jour
          total_usd_in_fc: Math.round(totalCashUsd * rateForFc * 100) / 100
        }
      };
      
      logger.info(`   ✅ Stats calculées: ${stats.summary.total_usd} USD (${stats.summary.transactions_count} transactions)`);
      
      return stats;
    } catch (error) {
      logger.error('❌ [DayStats] Erreur getDayStats:', error);
      throw error;
    }
  }
  
  /**
   * Récupère les statistiques de plusieurs jours (période)
   * @param {string} fromISO - Date de début
   * @param {string} toISO - Date de fin
   * @returns {Object} - Statistiques de la période
   */
  getPeriodStats(fromISO, toISO) {
    const db = getDb();
    const fromDate = fromISO.substring(0, 10);
    const toDate = toISO.substring(0, 10);
    
    try {
      logger.info(`📊 [DayStats] Calcul période ${fromDate} → ${toDate}`);
      
      // 1. Ventes normales de la période
      const normalSales = db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(total_usd), 0) as total_usd,
          COALESCE(SUM(total_fc), 0) as total_fc,
          COALESCE(SUM(paid_usd), 0) as paid_usd,
          COALESCE(SUM(paid_fc), 0) as paid_fc
        FROM sales
        WHERE date(sold_at) BETWEEN ? AND ?
          AND status != 'void'
          AND payment_mode != 'dette'
      `).get(fromDate, toDate);
      
      // 2. Paiements de dettes de la période
      const debtPayments = db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(amount_usd), 0) as total_usd,
          COALESCE(SUM(amount_fc), 0) as total_fc,
          COUNT(DISTINCT debt_id) as debts_count
        FROM debt_payments
        WHERE date(paid_at) BETWEEN ? AND ?
      `).get(fromDate, toDate);
      
      // 3. Dettes créées dans la période
      const debtsCreated = db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(total_usd), 0) as total_usd,
          COALESCE(SUM(total_fc), 0) as total_fc,
          COALESCE(SUM(remaining_usd), 0) as remaining_usd
        FROM debts
        WHERE date(created_at) BETWEEN ? AND ?
      `).get(fromDate, toDate);
      
      // 4. Statistiques par jour
      const dailyStats = db.prepare(`
        SELECT 
          date(sold_at) as day,
          COUNT(*) as sales_count,
          COALESCE(SUM(total_usd), 0) as sales_usd,
          COALESCE(SUM(total_fc), 0) as sales_fc
        FROM sales
        WHERE date(sold_at) BETWEEN ? AND ?
          AND status != 'void'
          AND payment_mode != 'dette'
        GROUP BY date(sold_at)
        ORDER BY day
      `).all(fromDate, toDate);
      
      const dailyPayments = db.prepare(`
        SELECT 
          date(paid_at) as day,
          COUNT(*) as payments_count,
          COALESCE(SUM(amount_usd), 0) as payments_usd,
          COALESCE(SUM(amount_fc), 0) as payments_fc
        FROM debt_payments
        WHERE date(paid_at) BETWEEN ? AND ?
        GROUP BY date(paid_at)
        ORDER BY day
      `).all(fromDate, toDate);
      
      // Fusionner les statistiques par jour
      const dailyMap = new Map();
      
      for (const d of dailyStats) {
        dailyMap.set(d.day, {
          date: d.day,
          sales_count: d.sales_count,
          sales_usd: d.sales_usd,
          sales_fc: d.sales_fc,
          payments_count: 0,
          payments_usd: 0,
          payments_fc: 0,
          total_cash_usd: d.sales_usd,
          total_cash_fc: d.sales_fc
        });
      }
      
      for (const p of dailyPayments) {
        if (dailyMap.has(p.day)) {
          const existing = dailyMap.get(p.day);
          existing.payments_count = p.payments_count;
          existing.payments_usd = p.payments_usd;
          existing.payments_fc = p.payments_fc;
          existing.total_cash_usd += p.payments_usd;
          existing.total_cash_fc += p.payments_fc;
        } else {
          dailyMap.set(p.day, {
            date: p.day,
            sales_count: 0,
            sales_usd: 0,
            sales_fc: 0,
            payments_count: p.payments_count,
            payments_usd: p.payments_usd,
            payments_fc: p.payments_fc,
            total_cash_usd: p.payments_usd,
            total_cash_fc: p.payments_fc
          });
        }
      }
      
      // Trier par date
      const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      
      // Totaux combinés
      const totalCashUsd = (normalSales.total_usd || 0) + (debtPayments.total_usd || 0);
      const totalCashFc = (normalSales.total_fc || 0) + (debtPayments.total_fc || 0);
      
      return {
        period: { from: fromDate, to: toDate },
        
        total_cash_usd: Math.round(totalCashUsd * 100) / 100,
        total_cash_fc: Math.round(totalCashFc * 100) / 100,
        
        normal_sales: {
          count: normalSales.count || 0,
          total_usd: normalSales.total_usd || 0,
          total_fc: normalSales.total_fc || 0
        },
        
        debt_payments: {
          count: debtPayments.count || 0,
          total_usd: debtPayments.total_usd || 0,
          total_fc: debtPayments.total_fc || 0,
          debts_count: debtPayments.debts_count || 0
        },
        
        debts_created: {
          count: debtsCreated.count || 0,
          total_usd: debtsCreated.total_usd || 0,
          remaining_usd: debtsCreated.remaining_usd || 0
        },
        
        daily
      };
    } catch (error) {
      logger.error('❌ [DayStats] Erreur getPeriodStats:', error);
      throw error;
    }
  }
  
  /**
   * Récupère les statistiques des ventes normales du jour
   */
  _getNormalSalesStats(db, dateOnly) {
    try {
      // Ventes normales: pas en mode dette et non void
      const result = db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(s.total_usd), 0) as total_usd,
          COALESCE(SUM(s.total_fc), 0) as total_fc,
          COALESCE(SUM(s.paid_usd), 0) as paid_usd,
          COALESCE(SUM(s.paid_fc), 0) as paid_fc,
          (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id IN (
            SELECT id FROM sales 
            WHERE date(sold_at) = ? AND status != 'void' AND payment_mode != 'dette'
          )) as items_count
        FROM sales s
        WHERE date(s.sold_at) = ?
          AND s.status != 'void'
          AND s.payment_mode != 'dette'
      `).get(dateOnly, dateOnly);
      
      return result || { count: 0, total_usd: 0, total_fc: 0, items_count: 0 };
    } catch (error) {
      logger.error('Erreur _getNormalSalesStats:', error);
      return { count: 0, total_usd: 0, total_fc: 0, items_count: 0 };
    }
  }
  
  /**
   * Récupère les statistiques des paiements de dettes du jour
   */
  _getDebtPaymentsStats(db, dateOnly) {
    try {
      const result = db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(amount_usd), 0) as total_usd,
          COALESCE(SUM(amount_fc), 0) as total_fc,
          COUNT(DISTINCT debt_id) as debts_count
        FROM debt_payments
        WHERE date(paid_at) = ?
      `).get(dateOnly);
      
      return result || { count: 0, total_usd: 0, total_fc: 0, debts_count: 0 };
    } catch (error) {
      logger.error('Erreur _getDebtPaymentsStats:', error);
      return { count: 0, total_usd: 0, total_fc: 0, debts_count: 0 };
    }
  }
  
  /**
   * Récupère les statistiques des dettes créées le jour
   */
  _getDebtsCreatedStats(db, dateOnly) {
    try {
      const result = db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(total_usd), 0) as total_usd,
          COALESCE(SUM(total_fc), 0) as total_fc,
          COALESCE(SUM(paid_usd), 0) as initial_payments_usd
        FROM debts
        WHERE date(created_at) = ?
      `).get(dateOnly);
      
      return result || { count: 0, total_usd: 0, total_fc: 0, initial_payments_usd: 0 };
    } catch (error) {
      logger.error('Erreur _getDebtsCreatedStats:', error);
      return { count: 0, total_usd: 0, total_fc: 0, initial_payments_usd: 0 };
    }
  }
  
  /**
   * Récupère le taux de change actuel
   */
  getCurrentRate() {
    const db = getDb();
    try {
      const setting = db.prepare("SELECT value FROM settings WHERE key = 'exchange_rate_fc_per_usd'").get();
      return parseFloat(setting?.value) || 2800;
    } catch (error) {
      return 2800;
    }
  }
  
  /**
   * Récupère un résumé rapide pour le dashboard
   */
  getDashboardSummary() {
    const db = getDb();
    const today = new Date().toISOString().substring(0, 10);
    
    try {
      // Stats du jour
      const dayStats = this.getDayStats(today);
      
      // Dettes ouvertes totales
      const openDebts = db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(remaining_usd), 0) as total_usd
        FROM debts
        WHERE status IN ('open', 'partial')
      `).get();
      
      // Top 5 clients avec dettes
      const topDebtors = db.prepare(`
        SELECT 
          client_name,
          client_uuid,
          COUNT(*) as debts_count,
          COALESCE(SUM(remaining_usd), 0) as total_remaining_usd
        FROM debts
        WHERE status IN ('open', 'partial')
        GROUP BY client_uuid, client_name
        ORDER BY total_remaining_usd DESC
        LIMIT 5
      `).all();
      
      return {
        today: {
          date: today,
          total_cash_usd: dayStats.total_cash_usd,
          total_cash_fc: dayStats.total_cash_fc,
          sales_count: dayStats.normal_sales.count,
          payments_count: dayStats.debt_payments.count
        },
        open_debts: {
          count: openDebts.count || 0,
          total_remaining_usd: openDebts.total_usd || 0
        },
        top_debtors: topDebtors
      };
    } catch (error) {
      logger.error('❌ [DayStats] Erreur getDashboardSummary:', error);
      throw error;
    }
  }
}

export const dayStatsService = new DayStatsService();
