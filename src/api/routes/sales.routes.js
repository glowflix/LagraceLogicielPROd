import express from 'express';
import fs from 'fs';
import path from 'path';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { getDb } from '../../db/sqlite.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { printJobsRepo } from '../../db/repositories/print-jobs.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { getPrintDir, getProjectRoot } from '../../core/paths.js';
import { generateTimestampInvoiceNumber } from '../../core/invoice.js';
import { normalizeUnit, normalizeMark, validateQtyBackend } from '../../core/qty-rules.js';
import { getSocketIO } from '../socket.js';
import { logger } from '../../core/logger.js';

const router = express.Router();

/**
 * POST /api/sales
 * Crée une nouvelle vente (OFFLINE-FIRST)
 * Pipeline A : Validation + SQL local + sync_queue + print_job
 */
router.post('/', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const saleData = { ...req.body };

    // 1. Validation et normalisation des quantités selon les règles strictes
    // IMPORTANT: Récupérer product_id pour chaque item avant la création de la vente
    if (saleData.items && Array.isArray(saleData.items)) {
      for (const item of saleData.items) {
        // CRITIQUE: Normaliser la quantité (0.5 = 0.50 = 0,5 = 0,50)
        // Gérer tous les formats: convertir toutes les virgules en points
        let qty = item.qty;
        if (typeof qty === 'string') {
          // Remplacer TOUTES les virgules par des points (gérer 0,5, 0,50, etc.)
          qty = parseFloat(qty.replace(/,/g, '.')) || 0;
        }
        qty = Number(qty) || 0;
        
        // Vérification de sécurité: la quantité doit être > 0
        if (qty <= 0) {
          return res.status(400).json({ 
            success: false, 
            error: `Quantité invalide pour produit ${item.product_code}: ${item.qty} → ${qty}`,
            item: item 
          });
        }
        
        // Arrondir à 2 décimales pour éviter les problèmes de précision
        qty = Math.round(qty * 100) / 100;
        
        const unitNorm = normalizeUnit(item.unit_level);
        const markNorm = normalizeMark(item.unit_mark || '');
        const validation = validateQtyBackend(qty, unitNorm, markNorm);
        
        if (!validation.valid) {
          // Corriger automatiquement si possible
          if (validation.corrected !== undefined) {
            qty = validation.corrected;
          } else {
            return res.status(400).json({ 
              success: false, 
              error: validation.error,
              item: item 
            });
          }
        }
        
        // Récupérer product_id si non fourni
        if (!item.product_id && item.product_code) {
          const product = productsRepo.findByCode(item.product_code);
          if (product) {
            item.product_id = product.id;
          } else {
            // Chercher directement dans la base
            const dbProduct = db.prepare('SELECT id FROM products WHERE code = ? AND is_active = 1').get(item.product_code);
            if (dbProduct) {
              item.product_id = dbProduct.id;
            } else {
              return res.status(400).json({ 
                success: false, 
                error: `Produit non trouvé: ${item.product_code}`,
                item: item 
              });
            }
          }
        }
        
        // Mettre à jour la quantité normalisée
        item.qty = qty;
        // Recalculer le subtotal avec la quantité normalisée
        item.subtotal_fc = Math.round((item.unit_price_fc * qty) * 100) / 100;
        item.subtotal_usd = Math.round((item.unit_price_usd * qty) * 100) / 100;
      }
    }

    // CRITIQUE: Recalculer le total à partir des items pour garantir la cohérence
    // Le frontend peut envoyer total_fc=0 si le calcul n'est pas à jour
    let recalculatedTotalFC = 0;
    let recalculatedTotalUSD = 0;
    if (saleData.items && Array.isArray(saleData.items)) {
      recalculatedTotalFC = saleData.items.reduce((sum, item) => sum + (item.subtotal_fc || 0), 0);
      recalculatedTotalUSD = saleData.items.reduce((sum, item) => sum + (item.subtotal_usd || 0), 0);
      recalculatedTotalFC = Math.round(recalculatedTotalFC * 100) / 100;
      recalculatedTotalUSD = Math.round(recalculatedTotalUSD * 100) / 100;
    }
    
    // Utiliser le total recalculé si celui envoyé est 0 ou invalide
    const finalTotalFC = (saleData.total_fc && saleData.total_fc > 0) ? saleData.total_fc : recalculatedTotalFC;
    const finalTotalUSD = (saleData.total_usd && saleData.total_usd > 0) ? saleData.total_usd : recalculatedTotalUSD;
    
    logger.info(`💰 [sales.routes] Calcul des totaux:`);
    logger.info(`   Total FC envoyé: ${saleData.total_fc || 0}`);
    logger.info(`   Total USD envoyé: ${saleData.total_usd || 0}`);
    logger.info(`   Total FC recalculé: ${recalculatedTotalFC}`);
    logger.info(`   Total USD recalculé: ${recalculatedTotalUSD}`);
    logger.info(`   Total FC final utilisé: ${finalTotalFC}`);
    logger.info(`   Total USD final utilisé: ${finalTotalUSD}`);

    // 2. Générer numéro de facture au format YYYYMMDDHHmmss
    const invoiceNumber = saleData.invoice_number || generateTimestampInvoiceNumber();
    const dateISO = saleData.sold_at || new Date().toISOString();

    // 3. Préparer les données de vente
    const finalSaleData = {
      ...saleData,
      invoice_number: invoiceNumber,
      sold_at: dateISO,
      seller_user_id: req.user?.id || null,
      seller_name: req.user?.username || req.body.seller_name || 'System',
      total_fc: finalTotalFC,
      total_usd: finalTotalUSD,
      paid_fc: saleData.isDebt ? 0 : finalTotalFC,
      paid_usd: saleData.isDebt ? 0 : finalTotalUSD,
      origin: 'LOCAL',
    };

    // 4. Créer la vente en SQL local (transaction)
    const sale = salesRepo.create(finalSaleData);

    // 5. Créer les jobs de synchronisation (arrière-plan)
    // 5.1 Sync ventes → feuille "Ventes"
    syncRepo.addToOutbox('sales', sale.invoice_number, 'upsert', {
      invoice_number: sale.invoice_number,
      date_iso: dateISO,
      ...sale,
    });

    // 5.2 Sync stock → feuilles Carton/Milliers/Piece
    // CRITIQUE: Envoyer la valeur ABSOLUE du stock local pour écraser la colonne C dans Sheets
    // Au lieu d'un changement relatif, on envoie le stock exact après réduction (ex: 6.5 au lieu de -1)
    if (sale.items && Array.isArray(sale.items)) {
      for (const item of sale.items) {
        // CRITIQUE: Normaliser unit_level pour correspondre au format attendu par Sheets (CARTON, MILLIER, PIECE)
        const unitNorm = normalizeUnit(item.unit_level);
        let unitLevelForSync;
        if (unitNorm === 'carton') {
          unitLevelForSync = 'CARTON';
        } else if (unitNorm === 'milliers') {
          unitLevelForSync = 'MILLIER'; // Sheets utilise MILLIER (singulier) pour la feuille Milliers
        } else if (unitNorm === 'piece') {
          unitLevelForSync = 'PIECE';
        } else {
          // Fallback: utiliser tel quel si déjà en majuscules
          unitLevelForSync = (item.unit_level || '').toString().toUpperCase();
          // Normaliser MILLIERS → MILLIER
          if (unitLevelForSync === 'MILLIERS') {
            unitLevelForSync = 'MILLIER';
          }
        }
        
        const sheetName = unitNorm === 'carton' ? 'Carton' 
                        : unitNorm === 'milliers' ? 'Milliers'
                        : unitNorm === 'piece' ? 'Piece' : null;
        
        if (sheetName && unitLevelForSync) {
          // CRITIQUE: Récupérer le stock ABSOLU après la réduction depuis la base de données
          // Le stock a déjà été réduit dans sales.repo.js, on récupère la valeur finale
          logger.info(`📦 [sales.routes] Récupération du stock ABSOLU pour synchronisation:`);
          logger.info(`   Produit: ${item.product_code} (${item.product_name})`);
          logger.info(`   Product ID dans item: ${item.product_id || '(non fourni)'}`);
          logger.info(`   Unité normalisée: ${unitLevelForSync}, Mark: '${item.unit_mark || ''}'`);
          logger.info(`   Quantité vendue: ${item.qty}`);
          
          const db = getDb();
          
          // CRITIQUE: Récupérer product_id depuis la base si non fourni dans item
          let productId = item.product_id;
          if (!productId && item.product_code) {
            logger.info(`   🔍 Product ID manquant, recherche depuis product_code: ${item.product_code}`);
            const product = db.prepare('SELECT id FROM products WHERE code = ? AND is_active = 1 LIMIT 1').get(item.product_code);
            if (product) {
              productId = product.id;
              logger.info(`   ✅ Product ID trouvé: ${productId}`);
            } else {
              logger.error(`❌ [sales.routes] ERREUR: Produit non trouvé pour code: ${item.product_code}`);
              logger.error(`   ⚠️ Impossible d'ajouter update_stock à l'outbox pour ce produit`);
              continue; // Passer au produit suivant
            }
          }
          
          if (!productId) {
            logger.error(`❌ [sales.routes] ERREUR: Product ID non disponible pour ${item.product_code}`);
            logger.error(`   ⚠️ Impossible d'ajouter update_stock à l'outbox pour ce produit`);
            continue; // Passer au produit suivant
          }
          
          logger.info(`   🔍 Requête SQL: SELECT stock_initial FROM product_units WHERE product_id = ${productId} AND unit_level = '${unitLevelForSync}' AND unit_mark = '${item.unit_mark || ''}'`);
          
          const unitStock = db.prepare(`
            SELECT stock_initial, stock_current FROM product_units
            WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
          `).get(productId, unitLevelForSync, item.unit_mark || '');
          
          if (!unitStock) {
            logger.error(`❌ [sales.routes] ERREUR: Unité non trouvée dans product_units!`);
            logger.error(`   Product ID: ${productId}, Code produit: ${item.product_code}, Unité: ${unitLevelForSync}, Mark: '${item.unit_mark || ''}'`);
            logger.error(`   ⚠️ Impossible d'ajouter update_stock à l'outbox pour ce produit`);
            continue; // Passer au produit suivant
          }
          
          const stockAbsolute = unitStock.stock_initial || 0;
          const stockCurrent = unitStock.stock_current || 0;
          const stockAbsoluteRounded = Math.round(stockAbsolute * 100) / 100; // Arrondir à 2 décimales
          
          logger.info(`   ✅ Stock trouvé:`);
          logger.info(`      stock_initial (absolu): ${stockAbsolute} → arrondi: ${stockAbsoluteRounded}`);
          logger.info(`      stock_current: ${stockCurrent}`);
          
          // CRITIQUE: Convertir product_code en chaîne pour correspondre à Sheets (gérer nombre vs chaîne)
          const productCodeForSync = String(item.product_code || '').trim();
          
          const stockUpdatePayload = {
            product_code: productCodeForSync, // CRITIQUE: Toujours envoyer comme chaîne pour correspondre à Sheets
            unit_level: unitLevelForSync, // CRITIQUE: Utiliser la version normalisée (CARTON, MILLIER, PIECE)
            unit_mark: item.unit_mark || '',
            stock_absolute: stockAbsoluteRounded, // CRITIQUE: Valeur ABSOLUE du stock local (ex: 6.5)
            invoice_number: sale.invoice_number,
          };
          
          logger.info(`   Code produit pour sync: '${productCodeForSync}' (type: ${typeof productCodeForSync})`);
          
          // LOG: Ajout à l'outbox pour synchronisation
          logger.info(`📦 [sales.routes] Ajout update_stock à l'outbox:`);
          logger.info(`   Produit: ${item.product_code} (${item.product_name})`);
          logger.info(`   Unité: ${unitLevelForSync}, Mark: ${item.unit_mark || '(vide)'}`);
          logger.info(`   Feuille Sheets: ${sheetName}`);
          logger.info(`   Stock ABSOLU local: ${stockAbsoluteRounded} (sera écrit dans colonne C)`);
          logger.info(`   Invoice: ${sale.invoice_number}`);
          logger.info(`   ⚠️ Cette valeur ABSOLUE écrasera la colonne C dans Sheets`);
          
          syncRepo.addToOutbox('product_units', `${item.product_code}_${unitLevelForSync}_${item.unit_mark || ''}`, 'update_stock', stockUpdatePayload);
          
          logger.info(`   ✅ Opération ajoutée à l'outbox (sera synchronisée dans les 10 secondes)`);
        } else {
          logger.warn(`⚠️ [sales.routes] Impossible d'ajouter update_stock à l'outbox:`);
          logger.warn(`   Produit: ${item.product_code}, Unité: ${item.unit_level}`);
          logger.warn(`   sheetName: ${sheetName}, unitLevelForSync: ${unitLevelForSync}`);
        }
      }
    }

    // 5.3 Sync prix effectué → feuille "Stock de prix effectué"
    if (sale.items && Array.isArray(sale.items)) {
      for (const item of sale.items) {
        syncRepo.addToOutbox('price_logs', `${sale.invoice_number}_${item.product_code}`, 'append', {
          at: dateISO,
          product_code: item.product_code,
          unit_level: item.unit_level,
          unit_mark: item.unit_mark,
          unit_price_fc: item.unit_price_fc,
          line_total_fc: item.subtotal_fc,
          invoice_number: sale.invoice_number,
        });
      }
    }

    // 6. Créer le job d'impression (pending)
    const printPayload = {
      template: saleData.printCurrency === 'USD' ? 'receipt-80' : 'receipt-80',
      copies: 1,
      data: {
        factureNum: sale.invoice_number,
        numero: sale.invoice_number,
        client: sale.client_name || '',
        taux: sale.rate_fc_per_usd || 2800,
        dateISO: dateISO,
        lignes: (sale.items || []).map(item => ({
          code: item.product_code,
          nom: item.product_name,
          unite: normalizeUnit(item.unit_level) || 'piece',
          mark: normalizeMark(item.unit_mark || ''),
          qty: item.qty,
          qteLabel: item.qty_label || item.qty.toString(),
          puFC: item.unit_price_fc,
          totalFC: item.subtotal_fc,
          puUSD: item.unit_price_usd || 0,
          totalUSD: item.subtotal_usd || 0,
        })),
        totalFC: sale.total_fc,
        totalUSD: sale.total_usd,
        printCurrency: saleData.printCurrency || 'FC',
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
          autoDette: saleData.autoDette || sale.payment_mode === 'dette',
          currency: saleData.printCurrency || 'FC',
          ventesUsd: saleData.printCurrency === 'USD',
        }
      }
    };

    // Créer le job dans la base de données
    printJobsRepo.create({
      invoice_number: sale.invoice_number,
      template: 'receipt-80',
      payload_json: printPayload,
    });

    // Écrire aussi le fichier JSON pour le watcher (compatibilité avec print/module.js)
    // CRITIQUE: Écrire dans le dossier ROOT du printer (pas dans tmp/) pour que le watcher le détecte
    try {
      const printDir = getPrintDir();
      
      // LOG: Chemin utilisé pour l'impression
      logger.info('🖨️  [PRINT] ==========================================');
      logger.info('🖨️  [PRINT] DÉBUT CRÉATION JOB D\'IMPRESSION');
      logger.info('🖨️  [PRINT] ==========================================');
      logger.info(`📁 [PRINT] Dossier printer: ${printDir}`);
      logger.info(`📄 [PRINT] Facture: ${sale.invoice_number}`);
      
      // CRITIQUE: Créer les dossiers s'ils n'existent pas (indispensable en premier lancement)
      if (!fs.existsSync(printDir)) {
        logger.info(`📁 [PRINT] Création du dossier printer: ${printDir}`);
        fs.mkdirSync(printDir, { recursive: true });
      }
      
      // Créer aussi les sous-dossiers ok/err/tmp pour éviter erreurs du watcher
      const okDir = path.join(printDir, 'ok');
      const errDir = path.join(printDir, 'err');
      const tmpDir = path.join(printDir, 'tmp');
      const templatesDir = path.join(printDir, 'templates');
      
      [okDir, errDir, tmpDir, templatesDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          logger.info(`📁 [PRINT] Création du sous-dossier: ${path.basename(dir)}`);
          fs.mkdirSync(dir, { recursive: true });
        }
      });
      
      // Utiliser le numéro de facture pour un nom de fichier unique et identifiable
      const safeInvoiceNumber = sale.invoice_number.replace(/[^\w\-]/g, '_');
      const jobFile = path.join(printDir, `job-${safeInvoiceNumber}-${Date.now()}.json`);
      
      logger.info(`📄 [PRINT] Création du fichier job: ${path.basename(jobFile)}`);
      logger.info(`📄 [PRINT] Chemin complet: ${jobFile}`);
      
      // Écrire le fichier avec gestion d'erreur robuste
      fs.writeFileSync(jobFile, JSON.stringify(printPayload, null, 2), 'utf-8');
      
      // Vérifier que le fichier existe bien après écriture
      if (fs.existsSync(jobFile)) {
        const stats = fs.statSync(jobFile);
        logger.info(`✅ [PRINT] Job créé avec succès!`);
        logger.info(`   - Nom: ${path.basename(jobFile)}`);
        logger.info(`   - Taille: ${stats.size} bytes`);
        logger.info(`   - Chemin: ${jobFile}`);
        logger.info(`✅ [PRINT] Le watcher devrait détecter ce fichier dans quelques secondes...`);
        logger.info('🖨️  [PRINT] ==========================================');
      } else {
        logger.error(`❌ [PRINT] ERREUR: Fichier non créé après writeFileSync!`);
        logger.error(`   - Chemin attendu: ${jobFile}`);
        logger.error(`   - Vérifier les permissions du dossier`);
      }
    } catch (printError) {
      // Ne pas bloquer la vente si l'écriture du fichier échoue (OFFLINE-FIRST)
      logger.error('❌ [PRINT] ==========================================');
      logger.error('❌ [PRINT] ERREUR CRITIQUE LORS DE LA CRÉATION DU JOB');
      logger.error('❌ [PRINT] ==========================================');
      logger.error(`❌ [PRINT] Message: ${printError.message}`);
      logger.error(`❌ [PRINT] Code: ${printError.code || 'N/A'}`);
      logger.error(`❌ [PRINT] Stack: ${printError.stack}`);
      
      if (printError.code === 'ENOENT') {
        logger.error(`❌ [PRINT] Le dossier n'existe pas ou n'est pas accessible`);
      } else if (printError.code === 'EACCES' || printError.code === 'EPERM') {
        logger.error(`❌ [PRINT] Permissions insuffisantes pour écrire dans le dossier`);
      }
      
      logger.error('❌ [PRINT] L\'impression ne fonctionnera pas pour cette vente');
      logger.error('❌ [PRINT] ==========================================');
    }

    // 7. Audit log
    if (req.user) {
      auditRepo.log(req.user.id, 'sale_create', {
        invoice_number: sale.invoice_number,
        total_fc: sale.total_fc,
      });
    }

    // 8. Émettre l'événement WebSocket pour synchronisation temps réel et AI LaGrace
    const io = getSocketIO();
    if (io) {
      // Émettre l'événement de vente créée avec toutes les infos pour l'AI
      const saleEvent = {
        ...sale,
        invoice_number: sale.invoice_number,
        factureNum: sale.invoice_number,
        client: sale.client_name || '',
        customer: sale.client_name || '',
        total_fc: sale.total_fc,
        total_usd: sale.total_usd,
        totalFC: sale.total_fc,
        totalUSD: sale.total_usd,
        seller: sale.seller_name || '',
        vendeur: sale.seller_name || '',
        items_count: (sale.items || []).length,
        timestamp: new Date().toISOString()
      };
      io.emit('sale:created', saleEvent);
      io.emit('sale:finalized', saleEvent); // Alias pour l'AI
      logger.info(`🤖 [AI] Événement sale:created émis pour ${sale.invoice_number}`);
    }

    // 9. Réponse immédiate (OFFLINE-FIRST)
    res.json({ 
      success: true, 
      sale,
      sync_status: 'pending',
      print_status: 'pending',
    });
  } catch (error) {
    console.error('Erreur création vente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sales
 * Liste les ventes avec filtres
 * Query params:
 *   - from: Date de début (ISO)
 *   - to: Date de fin (ISO)
 *   - status: Filtrer par statut exact
 *   - exclude_status: Exclure un statut (ex: 'pending' pour exclure les ventes en attente)
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const filters = {
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      exclude_status: req.query.exclude_status, // IMPORTANT: Exclure les ventes pending par défaut
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

    // Émettre l'événement WebSocket
    const io = getSocketIO();
    if (io) {
      io.emit('sale:updated', sale);
    }

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

