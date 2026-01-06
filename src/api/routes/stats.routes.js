import express from 'express';
import { dayStatsService } from '../../services/stats/day-stats.service.js';
import { optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';

const router = express.Router();

/**
 * GET /api/stats/day/:date
 * Statistiques complètes d'un jour
 * 
 * IMPORTANT: Inclut les ventes normales ET les paiements de dettes
 * Le total représente le cash réellement encaissé le jour
 */
router.get('/day/:date', optionalAuth, (req, res) => {
  try {
    const dateISO = req.params.date;
    const rateForFc = req.query.rate ? parseFloat(req.query.rate) : undefined;
    
    logger.info(`📊 GET /api/stats/day/${dateISO}`);
    
    const stats = dayStatsService.getDayStats(dateISO, { rateForFc });
    
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('❌ GET /api/stats/day/:date:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stats/today
 * Statistiques du jour actuel (raccourci)
 */
router.get('/today', optionalAuth, (req, res) => {
  try {
    const today = new Date().toISOString().substring(0, 10);
    const rateForFc = req.query.rate ? parseFloat(req.query.rate) : undefined;
    
    logger.info(`📊 GET /api/stats/today (${today})`);
    
    const stats = dayStatsService.getDayStats(today, { rateForFc });
    
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('❌ GET /api/stats/today:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stats/period
 * Statistiques d'une période
 * Query params: from, to
 */
router.get('/period', optionalAuth, (req, res) => {
  try {
    const fromISO = req.query.from;
    const toISO = req.query.to;
    
    if (!fromISO || !toISO) {
      return res.status(400).json({ 
        success: false, 
        error: 'Paramètres from et to requis' 
      });
    }
    
    logger.info(`📊 GET /api/stats/period: ${fromISO} → ${toISO}`);
    
    const stats = dayStatsService.getPeriodStats(fromISO, toISO);
    
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('❌ GET /api/stats/period:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stats/dashboard
 * Résumé pour le dashboard (aujourd'hui + dettes ouvertes + top débiteurs)
 */
router.get('/dashboard', optionalAuth, (req, res) => {
  try {
    logger.info(`📊 GET /api/stats/dashboard`);
    
    const summary = dayStatsService.getDashboardSummary();
    
    res.json({ success: true, summary });
  } catch (error) {
    logger.error('❌ GET /api/stats/dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stats/week
 * Statistiques de la semaine en cours
 */
router.get('/week', optionalAuth, (req, res) => {
  try {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    
    const fromISO = monday.toISOString().substring(0, 10);
    const toISO = today.toISOString().substring(0, 10);
    
    logger.info(`📊 GET /api/stats/week: ${fromISO} → ${toISO}`);
    
    const stats = dayStatsService.getPeriodStats(fromISO, toISO);
    
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('❌ GET /api/stats/week:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stats/month
 * Statistiques du mois en cours
 */
router.get('/month', optionalAuth, (req, res) => {
  try {
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const fromISO = firstOfMonth.toISOString().substring(0, 10);
    const toISO = today.toISOString().substring(0, 10);
    
    logger.info(`📊 GET /api/stats/month: ${fromISO} → ${toISO}`);
    
    const stats = dayStatsService.getPeriodStats(fromISO, toISO);
    
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('❌ GET /api/stats/month:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
