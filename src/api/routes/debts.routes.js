import express from 'express';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';
import { pullDebtsFromSheets } from '../../services/sync/pull-debts-from-sheets.js';

const router = express.Router();

/**
 * POST /api/debts/sync/pull
 * PULL dettes depuis Google Sheets → SQLite
 */
router.post('/sync/pull', authenticate, async (req, res) => {
  try {
    logger.info('🔄 [ENDPOINT] POST /api/debts/sync/pull - Démarrage PULL Sheets → SQLite');
    const result = await pullDebtsFromSheets();
    logger.info(`✅ [ENDPOINT] PULL complété: ${result.upserted}/${result.invoices} dettes upsertées`);
    res.json({ success: true, result });
  } catch (error) {
    logger.error('❌ [ENDPOINT] POST /api/debts/sync/pull error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts
 * Liste toutes les dettes
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const filters = {
      status: req.query.status,
    };
    
    logger.info(`📊 GET /api/debts - Début récupération des dettes`);
    logger.info(`   🔍 Filtres: ${JSON.stringify(filters)}`);
    
    const debts = debtsRepo.findAll(filters);
    
    logger.info(`✅ GET /api/debts: ${debts.length} dette(s) trouvée(s) dans la base`);
    
    if (debts.length > 0) {
      logger.info(`   📋 Première dette: ID=${debts[0].id}, Client="${debts[0].client_name}", Total=${debts[0].total_fc} FC`);
      logger.debug(`   📋 Détails: ${JSON.stringify(debts[0]).substring(0, 200)}...`);
    } else {
      logger.warn(`   ⚠️  Aucune dette trouvée dans la base de données`);
      logger.warn(`   💡 Vérifier si les dettes ont été synchronisées depuis Google Sheets`);
    }
    
    res.json(debts);
  } catch (error) {
    logger.error('❌ Erreur GET /api/debts:', error);
    logger.error(`   Message: ${error.message}`);
    logger.error(`   Stack: ${error.stack?.substring(0, 500)}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/:id
 * Récupère une dette par ID
 */
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const debt = debtsRepo.findById(parseInt(req.params.id));
    if (!debt) {
      return res.status(404).json({ success: false, error: 'Dette non trouvée' });
    }
    res.json(debt);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/debts/from-sale/:invoice
 * Crée une dette depuis une vente
 */
router.post('/from-sale/:invoice', authenticate, (req, res) => {
  try {
    const sale = salesRepo.findByInvoice(req.params.invoice);
    if (!sale) {
      return res.status(404).json({ success: false, error: 'Vente non trouvée' });
    }

    const debt = debtsRepo.createFromSale(sale.id, sale.invoice_number);

    // Ajouter à l'outbox
    syncRepo.addToOutbox('debts', debt.id.toString(), 'upsert', debt);

    // Audit log
    auditRepo.log(req.user.id, 'debt_create', {
      debt_id: debt.id,
      invoice_number: sale.invoice_number,
    });

    res.json({ success: true, debt });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/debts/:id/payments
 * Ajoute un paiement à une dette
 */
router.post('/:id/payments', authenticate, (req, res) => {
  try {
    const debt = debtsRepo.addPayment(parseInt(req.params.id), {
      ...req.body,
      paid_by: req.user.id,
    });

    // Ajouter à l'outbox
    syncRepo.addToOutbox('debt_payments', debt.id.toString(), 'payment', {
      debt_id: debt.id,
      amount_fc: req.body.amount_fc,
    });

    // Audit log
    auditRepo.log(req.user.id, 'debt_payment', {
      debt_id: debt.id,
      amount_fc: req.body.amount_fc,
    });

    res.json({ success: true, debt });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/debts/cleanup-duplicates
 * Nettoie les doublons dans la table debts
 * Garde la dette la plus récente pour chaque invoice_number
 */
router.post('/cleanup-duplicates', authenticate, (req, res) => {
  try {
    logger.info('🧹 [ENDPOINT] POST /api/debts/cleanup-duplicates - Début nettoyage');
    const deletedCount = debtsRepo.cleanupDuplicates();
    logger.info(`✅ [ENDPOINT] Nettoyage terminé: ${deletedCount} doublon(s) supprimé(s)`);
    
    // Audit log
    auditRepo.log(req.user.id, 'debts_cleanup', {
      deleted_count: deletedCount,
    });
    
    res.json({ 
      success: true, 
      deleted_count: deletedCount,
      message: `${deletedCount} doublon(s) supprimé(s)`
    });
  } catch (error) {
    logger.error('❌ [ENDPOINT] POST /api/debts/cleanup-duplicates error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

