import express from 'express';
import fs from 'fs';
import path from 'path';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { getDb } from '../../db/sqlite.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { getPrintDir, getProjectRoot } from '../../core/paths.js';

const router = express.Router();

/**
 * POST /api/sales
 * Crée une nouvelle vente
 */
router.post('/', optionalAuth, (req, res) => {
  try {
    const saleData = {
      ...req.body,
      seller_user_id: req.user?.id || null,
      seller_name: req.user?.username || req.body.seller_name || 'System',
    };

    const sale = salesRepo.create(saleData);

    // Ajouter à l'outbox
    syncRepo.addToOutbox('sales', sale.invoice_number, 'upsert', sale);

    // Audit log
    if (req.user) {
      auditRepo.log(req.user.id, 'sale_create', {
        invoice_number: sale.invoice_number,
        total_fc: sale.total_fc,
      });
    }

    res.json({ success: true, sale });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sales
 * Liste les ventes avec filtres
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const filters = {
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
    };

    const sales = salesRepo.findAll(filters);
    res.json(sales);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sales/:invoice
 * Récupère une vente par numéro de facture
 */
router.get('/:invoice', optionalAuth, (req, res) => {
  try {
    const sale = salesRepo.findByInvoice(req.params.invoice);
    if (!sale) {
      return res.status(404).json({ success: false, error: 'Vente non trouvée' });
    }
    res.json(sale);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sales/:invoice/void
 * Annule une vente
 */
router.post('/:invoice/void', authenticate, (req, res) => {
  try {
    const { reason } = req.body;
    const sale = salesRepo.voidSale(req.params.invoice, reason, req.user.id);

    // Ajouter à l'outbox
    syncRepo.addToOutbox('sales', sale.invoice_number, 'void', {
      invoice_number: sale.invoice_number,
      reason,
    });

    // Audit log
    auditRepo.log(req.user.id, 'sale_void', {
      invoice_number: sale.invoice_number,
      reason,
    });

    res.json({ success: true, sale });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sales/:invoice/print
 * Génère un job d'impression
 */
router.post('/:invoice/print', optionalAuth, (req, res) => {
  try {
    const sale = salesRepo.findByInvoice(req.params.invoice);
    if (!sale) {
      return res.status(404).json({ success: false, error: 'Vente non trouvée' });
    }

    // Récupérer les items de la vente
    const db = getDb();
    const saleItems = db.prepare(`
      SELECT si.*, p.code as product_code, p.name as product_name
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `).all(sale.id);

    // Préparer le job d'impression
    const printJob = {
      template: req.body.template || 'receipt-80',
      copies: req.body.copies || 1,
      data: {
        factureNum: sale.invoice_number,
        numero: sale.invoice_number,
        client: sale.client_name || '',
        taux: sale.rate_fc_per_usd || 2800,
        dateISO: sale.sold_at,
        lignes: saleItems.map(item => ({
          code: item.product_code,
          nom: item.product_name,
          unite: item.unit_level,
          mark: item.unit_mark || '',
          qty: item.qty,
          qteLabel: item.qty_label || item.qty.toString(),
          puFC: item.unit_price_fc,
          totalFC: item.subtotal_fc,
          puUSD: item.unit_price_usd || 0,
          totalUSD: item.subtotal_usd || 0,
        })),
        totalFC: sale.total_fc,
        totalUSD: sale.total_usd,
        printCurrency: req.body.currency || (sale.payment_mode === 'usd' ? 'USD' : 'FC'),
        entreprise: {
          nom: "ALIMENTATION LA GRACE",
          rccm: "CD/KIS/RCCM 22-A-00172",
          impot: "A220883T",
          tel: "+243 896 885 373 / +243 819 082 637",
          adresse: "Avenue Lac Tanganyika, Makiso, Kisangani, R.D.Congo"
        },
        meta: {
          vendeur: sale.seller_name || '',
          payment_mode: sale.payment_mode,
          autoDette: req.body.autoDette || false,
        }
      }
    };

    // Écrire le job dans le dossier d'impression
    const printDir = getPrintDir();
    const jobFile = path.join(printDir, `job-${Date.now()}.json`);
    fs.writeFileSync(jobFile, JSON.stringify(printJob, null, 2), 'utf-8');

    res.json({
      success: true,
      message: 'Job d\'impression créé',
      invoice: sale.invoice_number,
      file: path.basename(jobFile),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

