import express from 'express';
import { debtsRepo } from '../../db/repositories/debts.repo.new.js';
import { debtPaymentsRepo } from '../../db/repositories/debt-payments.repo.js';
import { clientsRepo } from '../../db/repositories/clients.repo.js';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';
import { pullDebtsFromSheets } from '../../services/sync/pull-debts-from-sheets.js';

const router = express.Router();

// ==========================================
// SYNCHRONISATION
// ==========================================

/**
 * POST /api/debts/sync/push
 * ✅ RESYNC ROBUSTE: Push TOUTES les dettes locales vers Google Sheets
 * Query params: force=true pour forcer même si déjà synced
 */
router.post('/sync/push', optionalAuth, (req, res) => {
  try {
    const forceAll = req.query.force === 'true' || req.body.force === true;
    
    logger.info(`🔄 [ENDPOINT] POST /api/debts/sync/push (force=${forceAll})`);
    
    const result = outboxRepo.resyncAllDebts(forceAll);
    
    logger.info(`✅ [ENDPOINT] PUSH: ${result.queued} queued, ${result.skipped} skipped, ${result.errors} errors`);
    
    res.json({ 
      success: true, 
      message: `${result.queued} dette(s) ajoutée(s) à la file de sync`,
      result 
    });
  } catch (error) {
    logger.error('❌ [ENDPOINT] Erreur sync/push:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/debts/cleanup-empty
 * Supprime les dettes vides (sans client ou sans montant)
 */
router.delete('/cleanup-empty', optionalAuth, (req, res) => {
  try {
    logger.info('🗑️ [ENDPOINT] DELETE /api/debts/cleanup-empty');
    
    const result = debtsRepo.cleanupEmptyDebts();
    
    logger.info(`✅ [ENDPOINT] ${result.deleted} dette(s) vide(s) supprimée(s)`);
    res.json({ success: true, deleted: result.deleted });
  } catch (error) {
    logger.error('❌ [ENDPOINT] Erreur cleanup-empty:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/debts/sync/pull
 * PULL dettes depuis Google Sheets → SQLite
 */
router.post('/sync/pull', authenticate, async (req, res) => {
  try {
    logger.info('🔄 [ENDPOINT] POST /api/debts/sync/pull');
    const result = await pullDebtsFromSheets();
    logger.info(`✅ [ENDPOINT] PULL: ${result.upserted}/${result.invoices} dettes`);
    res.json({ success: true, result });
  } catch (error) {
    logger.error('❌ [ENDPOINT] Erreur sync/pull:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// DETTES - CRUD
// ==========================================

/**
 * GET /api/debts
 * Liste toutes les dettes avec filtres
 * Query params: status, client_name, from_date, to_date, limit
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      client_name: req.query.client_name,
      client_uuid: req.query.client_uuid,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined
    };
    
    logger.info(`📊 GET /api/debts - Filtres: ${JSON.stringify(filters)}`);
    
    const debts = debtsRepo.findAll(filters);
    
    logger.info(`✅ GET /api/debts: ${debts.length} dette(s)`);
    res.json(debts);
  } catch (error) {
    logger.error('❌ GET /api/debts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/stats
 * Statistiques globales des dettes
 */
router.get('/stats', optionalAuth, (req, res) => {
  try {
    const filters = {
      from_date: req.query.from_date,
      to_date: req.query.to_date
    };
    
    const stats = debtsRepo.getStats(filters);
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('❌ GET /api/debts/stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/open
 * Liste les dettes ouvertes ou partielles (non soldées)
 */
router.get('/open', optionalAuth, (req, res) => {
  try {
    const debts = debtsRepo.findAll({ status: 'open_or_partial' });
    res.json(debts);
  } catch (error) {
    logger.error('❌ GET /api/debts/open:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/:id
 * Récupère une dette par ID (avec paiements et items)
 */
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const debt = debtsRepo.findById(parseInt(req.params.id));
    if (!debt) {
      return res.status(404).json({ success: false, error: 'Dette non trouvée' });
    }
    res.json(debt);
  } catch (error) {
    logger.error('❌ GET /api/debts/:id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/uuid/:uuid
 * Récupère une dette par UUID
 */
router.get('/uuid/:uuid', optionalAuth, (req, res) => {
  try {
    const debt = debtsRepo.findByUuid(req.params.uuid);
    if (!debt) {
      return res.status(404).json({ success: false, error: 'Dette non trouvée' });
    }
    res.json(debt);
  } catch (error) {
    logger.error('❌ GET /api/debts/uuid/:uuid:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/invoice/:invoice
 * Récupère une dette par numéro de facture
 */
router.get('/invoice/:invoice', optionalAuth, (req, res) => {
  try {
    const debt = debtsRepo.findByInvoice(req.params.invoice);
    if (!debt) {
      return res.status(404).json({ success: false, error: 'Dette non trouvée' });
    }
    res.json(debt);
  } catch (error) {
    logger.error('❌ GET /api/debts/invoice/:invoice:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/debts
 * Crée une dette directement (sans vente associée)
 */
router.post('/', authenticate, (req, res) => {
  try {
    const debtData = {
      ...req.body,
      device_id: req.body.device_id || req.headers['x-device-id']
    };
    
    // Si client_name fourni mais pas client_uuid, trouver/créer le client
    if (debtData.client_name && !debtData.client_uuid) {
      const client = clientsRepo.findOrCreate(debtData.client_name, {
        phone: debtData.client_phone
      });
      debtData.client_uuid = client.uuid;
    }
    
    const debt = debtsRepo.create(debtData);
    
    // Audit log
    auditRepo.log(req.user?.id, 'debt_create', {
      debt_id: debt.id,
      debt_uuid: debt.uuid,
      client_name: debt.client_name,
      total_usd: debt.total_usd
    });
    
    logger.info(`✅ POST /api/debts: Dette créée ID ${debt.id}`);
    res.json({ success: true, debt });
  } catch (error) {
    logger.error('❌ POST /api/debts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/debts/from-sale/:invoice
 * Crée une dette depuis une vente existante
 */
router.post('/from-sale/:invoice', authenticate, (req, res) => {
  try {
    const sale = salesRepo.findByInvoice(req.params.invoice);
    if (!sale) {
      return res.status(404).json({ success: false, error: 'Vente non trouvée' });
    }
    
    const options = {
      initialPaymentUsd: req.body.initial_payment_usd || 0,
      rateUsed: req.body.rate_fc_per_usd || sale.rate_fc_per_usd || 2800
    };
    
    // Préparer les données de la vente avec client_uuid si disponible
    const saleData = { ...sale };
    if (sale.client_name && !sale.client_uuid) {
      const client = clientsRepo.findOrCreate(sale.client_name, {
        phone: sale.client_phone
      });
      saleData.client_uuid = client.uuid;
    }
    
    const debt = debtsRepo.createFromSale(saleData, options);
    
    // Audit log
    auditRepo.log(req.user?.id, 'debt_create_from_sale', {
      debt_id: debt.id,
      invoice_number: sale.invoice_number,
      initial_payment_usd: options.initialPaymentUsd
    });
    
    logger.info(`✅ POST /api/debts/from-sale: Dette créée depuis facture ${sale.invoice_number}`);
    res.json({ success: true, debt });
  } catch (error) {
    logger.error('❌ POST /api/debts/from-sale:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// PAIEMENTS
// ==========================================

/**
 * POST /api/debts/:id/payments
 * Ajoute un paiement à une dette
 * Body: { amount_usd, amount_fc, payment_mode, note }
 */
router.post('/:id/payments', authenticate, (req, res) => {
  try {
    const debtId = parseInt(req.params.id);
    
    const paymentData = {
      amount_usd: req.body.amount_usd || 0,
      amount_fc: req.body.amount_fc || 0,
      rate_fc_per_usd: req.body.rate_fc_per_usd || 2800,
      payment_mode: req.body.payment_mode || 'cash',
      note: req.body.note,
      paid_by: req.user?.id,
      device_id: req.body.device_id || req.headers['x-device-id']
    };
    
    // Validation: au moins un montant doit être fourni
    if (paymentData.amount_usd <= 0 && paymentData.amount_fc <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Montant de paiement requis (amount_usd ou amount_fc)' 
      });
    }
    
    const debt = debtsRepo.addPayment(debtId, paymentData);
    
    // Audit log
    auditRepo.log(req.user?.id, 'debt_payment', {
      debt_id: debtId,
      amount_usd: paymentData.amount_usd,
      amount_fc: paymentData.amount_fc,
      new_status: debt.status
    });
    
    logger.info(`✅ POST /api/debts/:id/payments: Paiement ajouté, nouveau statut: ${debt.status}`);
    res.json({ success: true, debt });
  } catch (error) {
    logger.error('❌ POST /api/debts/:id/payments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/:id/payments
 * Liste les paiements d'une dette
 */
router.get('/:id/payments', optionalAuth, (req, res) => {
  try {
    const debtId = parseInt(req.params.id);
    const payments = debtPaymentsRepo.findByDebtId(debtId);
    res.json(payments);
  } catch (error) {
    logger.error('❌ GET /api/debts/:id/payments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/payments/day/:date
 * Liste les paiements d'un jour (pour stats)
 */
router.get('/payments/day/:date', optionalAuth, (req, res) => {
  try {
    const dateISO = req.params.date;
    const payments = debtPaymentsRepo.findByDate(dateISO);
    const totals = debtPaymentsRepo.getDayTotal(dateISO);
    
    res.json({
      success: true,
      date: dateISO,
      payments,
      totals
    });
  } catch (error) {
    logger.error('❌ GET /api/debts/payments/day/:date:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// CLIENTS
// ==========================================

/**
 * GET /api/debts/clients/search
 * Recherche de clients (autocomplete)
 */
router.get('/clients/search', optionalAuth, (req, res) => {
  try {
    const query = req.query.q || '';
    const limit = parseInt(req.query.limit) || 10;
    
    const clients = clientsRepo.search(query, limit);
    res.json(clients);
  } catch (error) {
    logger.error('❌ GET /api/debts/clients/search:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/debts/clients
 * Crée un nouveau client
 */
router.post('/clients', authenticate, (req, res) => {
  try {
    const clientData = {
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email,
      address: req.body.address,
      note: req.body.note,
      device_id: req.body.device_id || req.headers['x-device-id']
    };
    
    if (!clientData.name) {
      return res.status(400).json({ success: false, error: 'Nom du client requis' });
    }
    
    const client = clientsRepo.create(clientData);
    
    auditRepo.log(req.user?.id, 'client_create', {
      client_id: client.id,
      client_name: client.name
    });
    
    logger.info(`✅ POST /api/debts/clients: Client créé ${client.name}`);
    res.json({ success: true, client });
  } catch (error) {
    logger.error('❌ POST /api/debts/clients:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/clients/:id
 * Détails d'un client avec ses statistiques de dettes
 */
router.get('/clients/:id', optionalAuth, (req, res) => {
  try {
    const stats = clientsRepo.getStats(parseInt(req.params.id));
    if (!stats) {
      return res.status(404).json({ success: false, error: 'Client non trouvé' });
    }
    res.json(stats);
  } catch (error) {
    logger.error('❌ GET /api/debts/clients/:id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/debts/client/:uuid/debts
 * Liste les dettes d'un client
 */
router.get('/client/:uuid/debts', optionalAuth, (req, res) => {
  try {
    const debts = debtsRepo.findByClient(req.params.uuid);
    res.json(debts);
  } catch (error) {
    logger.error('❌ GET /api/debts/client/:uuid/debts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
