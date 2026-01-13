import express from 'express';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
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

    // ✅ PRO: Ajouter à l'outbox pour sync vers Sheets (feuille "Dettes")
    outboxRepo.enqueueDebt(debt);

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
 * ✅ SYNC COMPLÈTE: Met à jour la dette dans Google Sheets (colonnes "prix payer deja", "reste", status)
 */
router.post('/:id/payments', authenticate, (req, res) => {
  try {
    const debtId = parseInt(req.params.id);
    const amountFC = parseFloat(req.body.amount_fc) || 0;
    
    if (amountFC <= 0) {
      return res.status(400).json({ success: false, error: 'Montant invalide' });
    }
    
    if (isNaN(debtId) || debtId <= 0) {
      return res.status(400).json({ success: false, error: 'ID de dette invalide' });
    }
    
    logger.info(`💰 [PAYMENT] Début paiement dette ID=${debtId}, montant=${amountFC} FC`);
    
    // ✅ FIX: Vérifier d'abord si la dette existe
    const existingDebt = debtsRepo.findById(debtId);
    if (!existingDebt) {
      logger.error(`❌ [PAYMENT] Dette ID=${debtId} non trouvée dans la base locale`);
      return res.status(404).json({ 
        success: false, 
        error: `Dette non trouvée (ID: ${debtId}). Veuillez rafraîchir la page et réessayer.` 
      });
    }
    
    logger.info(`   📋 [PAYMENT] Dette trouvée: Client="${existingDebt.client_name}", Invoice="${existingDebt.invoice_number}"`);
    
    // 1. Ajouter le paiement et mettre à jour la dette localement
    const debt = debtsRepo.addPayment(debtId, {
      ...req.body,
      paid_by: req.user.id,
    });
    
    if (!debt) {
      logger.error(`❌ [PAYMENT] addPayment a retourné null pour dette ID=${debtId}`);
      return res.status(500).json({ success: false, error: 'Erreur lors de l\'enregistrement du paiement' });
    }
    
    logger.info(`   ✅ [PAYMENT] Dette mise à jour: paid_fc=${debt.paid_fc}, remaining_fc=${debt.remaining_fc}, status=${debt.status}`);
    
    // 2. ✅ SYNC SHEETS: Ajouter opération DEBT complète pour mise à jour dans Sheets
    // Envoie les données complètes de la dette pour que handleDebtUpsert puisse
    // mettre à jour les colonnes "prix payer deja", "reste" et le statut
    const syncPayload = {
      uuid: debt.uuid,
      invoice_number: debt.invoice_number,
      client_name: debt.client_name,
      client_phone: debt.client_phone || '',
      product_description: debt.product_description || '',
      total_fc: debt.total_fc,
      paid_fc: debt.paid_fc,
      remaining_fc: debt.remaining_fc,
      total_usd: debt.total_usd || 0,
      debt_fc_in_usd: debt.debt_fc_in_usd || 0,
      status: debt.status,
      note: debt.note || '',
      created_at: debt.created_at,
      updated_at: new Date().toISOString(),
      // Métadonnées paiement
      last_payment_amount: amountFC,
      last_payment_date: new Date().toISOString(),
    };
    
    // ✅ PRO: Ajouter à l'outbox pour sync vers Sheets (feuille "Dettes")
    outboxRepo.enqueueDebt(syncPayload);
    logger.info(`   📤 [PAYMENT] Opération SYNC ajoutée pour mise à jour Sheets`);

    // 3. Audit log
    auditRepo.log(req.user.id, 'debt_payment', {
      debt_id: debt.id,
      debt_uuid: debt.uuid,
      amount_fc: amountFC,
      new_paid_fc: debt.paid_fc,
      new_remaining_fc: debt.remaining_fc,
      new_status: debt.status,
    });

    res.json({ 
      success: true, 
      debt,
      message: debt.status === 'closed' 
        ? '🎉 Dette entièrement payée!' 
        : `Paiement de ${amountFC.toLocaleString()} FC enregistré`
    });
  } catch (error) {
    logger.error('❌ [PAYMENT] Erreur:', error);
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

