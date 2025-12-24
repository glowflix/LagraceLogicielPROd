import express from 'express';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';

const router = express.Router();

/**
 * GET /api/debts
 * Liste toutes les dettes
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const filters = {
      status: req.query.status,
    };
    const debts = debtsRepo.findAll(filters);
    logger.info(`📊 GET /api/debts: ${debts.length} dette(s) retournée(s)`);
    res.json(debts);
  } catch (error) {
    logger.error('Erreur GET /api/debts:', error);
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

export default router;

