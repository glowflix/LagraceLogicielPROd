import express from 'express';
import fs from 'fs';
import path from 'path';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { productsRepo } from '../../db/repositories/products.repo.js';
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
 * GET /api/sales/history/all
 * Liste TOUTES les ventes de l'historique (pour vérification)
 */
router.get('/history/all', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    
    // Récupérer toutes les ventes avec leurs items
    const allSales = db.prepare(`
      SELECT 
        s.*,
        COUNT(si.id) as items_count,
        GROUP_CONCAT(si.product_code || '|' || si.product_name || '|' || si.unit_level || '|' || si.qty) as items_summary
      FROM sales s
      LEFT JOIN sale_items si ON s.id = si.sale_id
      GROUP BY s.id
      ORDER BY s.sold_at DESC
    `).all();
    
    // Formater les résultats
    const formattedSales = allSales.map(sale => ({
      id: sale.id,
      uuid: sale.uuid,
      invoice_number: sale.invoice_number,
      sold_at: sale.sold_at,
      client_name: sale.client_name,
      client_phone: sale.client_phone,
      seller_name: sale.seller_name,
      total_fc: sale.total_fc,
      total_usd: sale.total_usd,
      status: sale.status,
      origin: sale.origin,
      items_count: sale.items_count || 0,
      items_summary: sale.items_summary || '',
      created_at: sale.created_at,
      updated_at: sale.updated_at,
      synced_at: sale.synced_at
    }));
    
    res.json({
      success: true,
      total: formattedSales.length,
      sales: formattedSales
    });
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

    // Fonction pour trouver le nom et mark du produit selon code et unité
    const findProductInfo = (code, unitLevel, unitMark) => {
      try {
        // Chercher le produit par code
        const product = productsRepo.findByCode(code);
        if (!product) {
          // Si produit non trouvé, chercher dans la base de données directement
          const db = getDb();
          const dbProduct = db.prepare('SELECT * FROM products WHERE code = ? AND is_active = 1').get(code);
          if (!dbProduct) return { nom: null, mark: null };
          
          // Récupérer les units
          const units = db.prepare('SELECT * FROM product_units WHERE product_id = ?').all(dbProduct.id);
          const productWithUnits = { ...dbProduct, units };
          
          // Utiliser le produit trouvé
          const matchingUnit = units.find(u => {
            if (unitLevel && u.unit_level === unitLevel) {
              if (unitMark) return u.unit_mark === unitMark;
              return true;
            }
            return false;
          });
          
          return {
            nom: dbProduct.name || null,
            mark: matchingUnit?.unit_mark || unitMark || ''
          };
        }

        // Chercher l'unité correspondante dans les units du produit
        let matchingUnit = null;
        
        // D'abord, chercher par unit_level ET unit_mark si spécifié
        if (unitLevel && unitMark) {
          matchingUnit = product.units?.find(u => 
            u.unit_level === unitLevel && u.unit_mark === unitMark
          );
        }
        
        // Si pas trouvé, chercher seulement par unit_level
        if (!matchingUnit && unitLevel) {
          matchingUnit = product.units?.find(u => u.unit_level === unitLevel);
        }
        
        // Si toujours pas trouvé, prendre la première unité disponible
        if (!matchingUnit && product.units && product.units.length > 0) {
          matchingUnit = product.units[0];
        }

        // Déterminer le mark final
        let finalMark = '';
        if (matchingUnit) {
          finalMark = matchingUnit.unit_mark || unitMark || '';
        } else {
          finalMark = unitMark || '';
        }

        return {
          nom: product.name || null,
          mark: finalMark || ''
        };
      } catch (error) {
        console.error('Erreur recherche produit:', error);
        return { nom: null, mark: null };
      }
    };

    // Préparer les lignes avec recherche automatique des produits
    const lignes = saleItems.map(item => {
      // Rechercher automatiquement le nom et mark du produit
      const productInfo = findProductInfo(item.product_code, item.unit_level, item.unit_mark);
      
      // Utiliser le nom trouvé ou celui stocké dans la vente
      const finalNom = productInfo.nom || item.product_name || item.product_code;
      const finalMark = productInfo.mark || item.unit_mark || '';

      // Déterminer l'unité canonique selon unit_level
      let uniteCanon = '';
      if (item.unit_level === 1) uniteCanon = 'millier';
      else if (item.unit_level === 2) uniteCanon = 'carton';
      else if (item.unit_level === 3) uniteCanon = 'piece';
      else uniteCanon = 'piece'; // Fallback

      return {
        code: item.product_code,
        nom: finalNom, // Remplacer le code par le nom trouvé automatiquement
        unite: uniteCanon,
        mark: finalMark, // Mark trouvé automatiquement selon l'unité
        qty: item.qty,
        qteLabel: item.qty_label || item.qty.toString(),
        puFC: item.unit_price_fc,
        totalFC: item.subtotal_fc,
        puUSD: item.unit_price_usd || 0,
        totalUSD: item.subtotal_usd || 0,
      };
    });

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
        lignes: lignes,
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
          currency: req.body.currency || 'FC',
          ventesUsd: req.body.currency === 'USD',
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

