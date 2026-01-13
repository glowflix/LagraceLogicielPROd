import express from 'express';
import fs from 'fs';
import path from 'path';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { debtsRepo } from '../../db/repositories/debts.repo.new.js';
import { getDb } from '../../db/sqlite.js';
// syncRepo supprimé - utilise maintenant outboxRepo pour toutes les opérations de sync
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { printJobsRepo } from '../../db/repositories/print-jobs.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { getPrintDir, getProjectRoot } from '../../core/paths.js';
import { generateTimestampInvoiceNumber } from '../../core/invoice.js';
import { normalizeUnit, normalizeMark, validateQtyBackend } from '../../core/qty-rules.js';
import { getSocketIO } from '../socket.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

const router = express.Router();

/**
 * GET /api/sales/clients/search
 * Recherche de clients/utilisateurs pour autocomplétion dans le mode dette
 * Recherche dans la table users (qui contient les clients de UserPage)
 * Inclut TOUS les utilisateurs actifs (vendeur = client normal)
 * Exclut uniquement les superadmin
 */
router.get('/clients/search', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const query = req.query.q || '';
    const limit = parseInt(req.query.limit) || 20;
    
    // Si pas de query, retourner tous les clients actifs
    const searchTerm = query.trim() ? `%${query.trim()}%` : '%';
    
    // ✅ Rechercher dans users - TOUS les utilisateurs actifs
    // Exclut uniquement les superadmin (username = 'superadmin')
    // Utilise is_admin, is_vendeur pour déterminer le rôle
    const users = db.prepare(`
      SELECT 
        id, 
        uuid, 
        username as name, 
        phone, 
        CASE 
          WHEN is_admin = 1 THEN 'Admin'
          WHEN is_vendeur = 1 THEN 'Vendeur'
          ELSE 'Client'
        END as role,
        'user' as source
      FROM users 
      WHERE (username LIKE ? OR phone LIKE ?) 
        AND is_active = 1
        AND username != 'superadmin'
      ORDER BY username ASC
      LIMIT ?
    `).all(searchTerm, searchTerm, limit);
    
    logger.info(`🔍 [Clients Search] Query: "${query}", Found: ${users.length} users`);
    
    // Rechercher aussi dans clients si la table existe
    let clients = [];
    try {
      clients = db.prepare(`
        SELECT id, uuid, name, phone, client_code, 'client' as source
        FROM clients 
        WHERE (name LIKE ? OR phone LIKE ? OR client_code LIKE ?) AND is_active = 1
        ORDER BY name ASC
        LIMIT ?
      `).all(searchTerm, searchTerm, searchTerm, limit);
    } catch (e) {
      // Table clients n'existe peut-être pas encore
    }
    
    // Combiner et dédupliquer
    const combined = [...users, ...clients];
    const seen = new Set();
    const unique = combined.filter(c => {
      const key = (c.name || '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
    
    // ✅ Format de réponse compatible avec le frontend
    res.json({ success: true, results: unique, count: unique.length });
  } catch (error) {
    logger.error('❌ GET /api/sales/clients/search:', error);
    res.status(500).json({ success: false, error: error.message, results: [] });
  }
});

/**
 * POST /api/sales/clients
 * Crée un nouveau client (utilisateur sans rôle admin/vendeur)
 */
router.post('/clients', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const { name, phone } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Nom du client requis' });
    }
    
    const trimmedName = name.trim();
    
    // Vérifier si le client existe déjà
    const existing = db.prepare(`
      SELECT id, uuid, username as name, phone FROM users 
      WHERE LOWER(TRIM(username)) = LOWER(?) AND is_active = 1
    `).get(trimmedName);
    
    if (existing) {
      return res.json({ success: true, client: existing, existed: true });
    }
    
    // Créer le client dans la table users
    const uuid = generateUUID();
    const hashedPassword = '$2b$10$placeholder'; // Mot de passe placeholder (client ne se connecte pas)
    
    const result = db.prepare(`
      INSERT INTO users (uuid, username, password_hash, phone, is_active, is_admin, is_vendeur, is_gerant_stock)
      VALUES (?, ?, ?, ?, 1, 0, 0, 0)
    `).run(uuid, trimmedName, hashedPassword, phone || null);
    
    const newClient = {
      id: result.lastInsertRowid,
      uuid: uuid,
      name: trimmedName,
      phone: phone || null,
      source: 'user'
    };
    
    logger.info(`✅ [Clients] Nouveau client créé: ${trimmedName} (ID ${newClient.id})`);
    
    // Créer opération sync pour le client
    try {
      db.prepare(`
        INSERT OR IGNORE INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, status)
        VALUES (?, 'CLIENT', ?, ?, ?, 'pending')
      `).run(generateUUID(), uuid, trimmedName, JSON.stringify({
        uuid, name: trimmedName, phone: phone || null, is_active: 1
      }));
    } catch (e) {
      logger.warn(`⚠️ Erreur sync client: ${e.message}`);
    }
    
    res.json({ success: true, client: newClient, existed: false });
  } catch (error) {
    logger.error('❌ POST /api/sales/clients:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sales
 * Crée une nouvelle vente (OFFLINE-FIRST)
 * Pipeline A : Validation + SQL local + sync_queue + print_job
 * 
 * MODE DETTE (isDebt: true):
 * - Devise automatiquement en USD
 * - Client obligatoire (doit exister dans users ou être créé)
 * - Champ paid_amount_usd pour paiement initial
 * - Crée une entrée dans la table debts (pas dans sales du jour)
 * - Sync vers feuille "Dettes" (pas "Ventes")
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

    // ═══════════════════════════════════════════════════════════════════════
    // MODE DETTE: Créer vente normale + dette (stock réduit via trigger)
    // ═══════════════════════════════════════════════════════════════════════
    const isDebtMode = saleData.isDebt === true || saleData.autoDette === true || saleData.payment_mode === 'dette';
    
    if (isDebtMode) {
      logger.info(`\n${'═'.repeat(70)}`);
      logger.info(`💳 [DEBT] MODE DETTE - CRÉATION VENTE + DETTE`);
      logger.info(`${'═'.repeat(70)}`);
      
      // Validation: Le client est OBLIGATOIRE
      if (!saleData.client_name || saleData.client_name.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'Le nom du client est obligatoire pour une dette',
          code: 'DEBT_CLIENT_REQUIRED'
        });
      }
      
      const rateUsed = saleData.rate_fc_per_usd || 2800;
      const initialPaymentUsd = parseFloat(saleData.paid_amount_usd) || 0;
      const initialPaymentFc = initialPaymentUsd * rateUsed;
      const remainingUsd = Math.max(0, finalTotalUSD - initialPaymentUsd);
      const remainingFc = remainingUsd * rateUsed;
      
      // Construire description produit
      const productDesc = (saleData.items || []).map(i => `${i.product_name} x${i.qty}`).join(', ');
      
      // Déterminer le statut dette
      let debtStatus = 'open';
      if (remainingUsd <= 0.01) debtStatus = 'paid';
      else if (initialPaymentUsd > 0) debtStatus = 'partial';
      
      logger.info(`   👤 Client: ${saleData.client_name}`);
      logger.info(`   📦 Produits: ${productDesc}`);
      logger.info(`   💰 Total: ${finalTotalUSD} USD (${finalTotalFC} FC)`);
      logger.info(`   💵 Payé maintenant: ${initialPaymentUsd} USD`);
      logger.info(`   📊 Reste à payer: ${remainingUsd} USD`);
      logger.info(`   📋 Statut dette: ${debtStatus}`);
      
      try {
        // ══════════════════════════════════════════════════════════════════
        // ÉTAPE 1: CRÉER LA VENTE NORMALE (réduit le stock via TRIGGER SQL)
        // ══════════════════════════════════════════════════════════════════
        logger.info(`   🛒 [1/5] Création de la vente (stock réduit par trigger)...`);
        
        const saleDataForRepo = {
          ...saleData,
          invoice_number: invoiceNumber,
          total_fc: finalTotalFC,
          total_usd: finalTotalUSD,
          payment_mode: 'dette',
          paid_fc: initialPaymentFc,
          paid_usd: initialPaymentUsd,
          status: debtStatus === 'paid' ? 'paid' : 'unpaid',
          origin: 'LOCAL'
        };
        
        const sale = salesRepo.create(saleDataForRepo);
        logger.info(`   ✅ [1/5] Vente créée: ID=${sale.id}, Invoice=${invoiceNumber}`);
        logger.info(`   📉 Stock réduit automatiquement par le trigger SQL`);
        
        // ══════════════════════════════════════════════════════════════════
        // ÉTAPE 2: CRÉER LA DETTE DANS SQLite
        // ══════════════════════════════════════════════════════════════════
        const requestedDebtUuid = generateUUID();
        const now = new Date().toISOString();

        const deviceId =
          saleData.device_id ||
          req.body.device_id ||
          req.headers['x-device-id'] ||
          saleData.source_device ||
          null;

        const itemsJson = saleData.items && Array.isArray(saleData.items)
          ? JSON.stringify(saleData.items)
          : null;
        
        // ✅ Insert idempotent (invoice_number est unique) + colonnes USD (migration 002)
        db.prepare(`
          INSERT OR IGNORE INTO debts (
            uuid, sale_id, invoice_number,
            client_name, client_phone, client_uuid,
            product_description, items_json,
            total_fc, paid_fc, remaining_fc,
            total_usd, paid_usd, remaining_usd,
            debt_fc_in_usd, status, note, device_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          requestedDebtUuid,
          sale.id,
          invoiceNumber,
          saleData.client_name.trim(),
          saleData.client_phone || null,
          saleData.client_uuid || null,
          productDesc,
          itemsJson,
          finalTotalFC,
          initialPaymentFc,
          remainingFc,
          finalTotalUSD,
          initialPaymentUsd,
          remainingUsd,
          finalTotalFC,
          debtStatus,
          saleData.note || null,
          deviceId,
          now
        );

        const persistedDebt = db.prepare(`
          SELECT id, uuid FROM debts WHERE invoice_number = ? LIMIT 1
        `).get(invoiceNumber);

        const debtId = persistedDebt?.id;
        const debtUuid = persistedDebt?.uuid || requestedDebtUuid;
        logger.info(`   ✅ [2/5] Dette créée: ID=${debtId}, UUID=${debtUuid.substring(0, 8)}...`);
        
        // ══════════════════════════════════════════════════════════════════
        // ÉTAPE 3: SYNC vers Google Sheets (feuille "Dettes")
        // ══════════════════════════════════════════════════════════════════
        const debtSyncData = {
          uuid: debtUuid,
          invoice_number: invoiceNumber,
          client_name: saleData.client_name.trim(),
          client_phone: saleData.client_phone || null,
          product_description: productDesc,
          total_fc: finalTotalFC,
          paid_fc: initialPaymentFc,
          remaining_fc: remainingFc,
          total_usd: finalTotalUSD,
          paid_usd: initialPaymentUsd,
          remaining_usd: remainingUsd,
          status: debtStatus,
          date: dateISO.split('T')[0],
          note: saleData.note || null
        };
        
        const syncOpId = outboxRepo.enqueueDebt(debtSyncData);
        logger.info(`   ✅ [3/5] Sync Sheets queued (dette): op_id=${syncOpId || 'skipped'}`);
        
        // ══════════════════════════════════════════════════════════════════
        // ÉTAPE 3.5: SYNC vente + mouvements de stock vers Sheets
        // ✅ FIX: enqueueSale() crée les STOCK_MOVE pour synchroniser le stock vers Sheets
        // ══════════════════════════════════════════════════════════════════
        try {
          outboxRepo.enqueueSale(sale, sale.items || saleData.items || []);
          logger.info(`   ✅ [3.5/5] Sync Sheets queued (vente + stock): OK`);
        } catch (outboxErr) {
          logger.warn(`   ⚠️ [3.5/5] Erreur enqueue vente: ${outboxErr.message}`);
        }
        
        // ══════════════════════════════════════════════════════════════════
        // ÉTAPE 4: CRÉER JOB D'IMPRESSION (même format que vente normale)
        // ══════════════════════════════════════════════════════════════════
        const printPayload = {
          template: 'receipt-80',
          isDebt: true,
          copies: 1,
          data: {
            factureNum: invoiceNumber,
            numero: invoiceNumber,
            client: saleData.client_name.trim(),
            clientPhone: saleData.client_phone || '',
            taux: rateUsed,
            dateISO: dateISO,
            isDebt: true,
            totalDebt: finalTotalUSD,
            paidInitial: initialPaymentUsd,
            remaining: remainingUsd,
            lignes: (saleData.items || []).map(item => ({
              code: item.product_code,
              nom: item.product_name,
              unite: normalizeUnit(item.unit_level) || 'piece',
              mark: normalizeMark(item.unit_mark || ''),
              qty: item.qty,
              puFC: item.unit_price_fc,
              totalFC: item.subtotal_fc,
              puUSD: item.unit_price_usd || 0,
              totalUSD: item.subtotal_usd || 0,
            })),
            totalFC: finalTotalFC,
            totalUSD: finalTotalUSD,
            printCurrency: 'USD',
            entreprise: {
              nom: "ALIMENTATION LA GRACE",
              rccm: "CD/KIS/RCCM 22-A-00172",
              impot: "A220883T",
              tel: "+243 896 885 373 / +243 819 082 637",
              adresse: "Avenue Lac Tanganyika, Makiso, Kisangani, R.D.Congo"
            },
            meta: {
              vendeur: req.user?.username || req.body.seller_name || 'System',
              payment_mode: 'dette',
              autoDette: true,
              currency: 'USD',
              ventesUsd: true,
              debtStatus: debtStatus,
              paidNow: initialPaymentUsd,
              remainingToPay: remainingUsd
            }
          }
        };
        
        // Sauvegarder dans print_jobs
        printJobsRepo.create({
          invoice_number: invoiceNumber,
          template: 'receipt-80',
          payload_json: printPayload,
        });
        
        // ✅ ÉCRIRE FICHIER POUR LE WATCHER D'IMPRESSION
        let printJobCreated = false;
        try {
          const printDir = getPrintDir();
          const safeInvoiceNumber = invoiceNumber.replace(/[^\w\-]/g, '_');
          const jobFile = path.join(printDir, `job-DEBT-${safeInvoiceNumber}-${Date.now()}.json`);
          fs.writeFileSync(jobFile, JSON.stringify(printPayload, null, 2), 'utf-8');
          printJobCreated = true;
          logger.info(`   ✅ [4/5] Print job créé: ${path.basename(jobFile)}`);
        } catch (printError) {
          logger.error(`   ⚠️ [4/5] Erreur création print job: ${printError.message}`);
        }
        
        // ══════════════════════════════════════════════════════════════════
        // ÉTAPE 5: WEBSOCKET notification temps réel
        // ══════════════════════════════════════════════════════════════════
        const io = getSocketIO();
        if (io) {
          io.emit('debt:created', {
            id: debtId,
            uuid: debtUuid,
            invoice_number: invoiceNumber,
            client_name: saleData.client_name,
            total_usd: finalTotalUSD,
            paid_usd: initialPaymentUsd,
            remaining_usd: remainingUsd,
            status: debtStatus,
            timestamp: now
          });
          io.emit('stock:updated', { 
            products: (saleData.items || []).map(i => i.product_code) 
          });
        }
        logger.info(`   ✅ [5/5] WebSocket notifications envoyées`);
        
        // ✅ AUDIT LOG
        if (req.user) {
          auditRepo.log(req.user.id, 'debt_create', {
            debt_id: debtId,
            sale_id: sale.id,
            invoice_number: invoiceNumber,
            total_usd: finalTotalUSD,
            paid_usd: initialPaymentUsd,
            client: saleData.client_name
          });
        }
        
        logger.info(`${'═'.repeat(70)}`);
        logger.info(`💳 [DEBT] TRANSACTION COMPLÈTE - Facture ${invoiceNumber}`);
        logger.info(`${'═'.repeat(70)}\n`);
        
        // ✅ RÉPONSE SUCCÈS (compatible avec le frontend)
        return res.json({
          success: true,
          isDebt: true,
          sale: {
            id: sale.id,
            invoice_number: invoiceNumber,
            items: sale.items || saleData.items
          },
          debt: {
            id: debtId,
            uuid: debtUuid,
            invoice_number: invoiceNumber,
            client_name: saleData.client_name,
            total_usd: finalTotalUSD,
            paid_usd: initialPaymentUsd,
            remaining_usd: remainingUsd,
            status: debtStatus
          },
          print_status: printJobCreated ? 'queued' : 'failed',
          sync_status: 'queued',
          message: `Dette de ${finalTotalUSD} USD créée pour ${saleData.client_name}. Payé: ${initialPaymentUsd} USD, Reste: ${remainingUsd} USD`
        });
        
      } catch (debtError) {
        logger.error(`❌ [DEBT] Erreur création dette:`, debtError);
        return res.status(500).json({
          success: false,
          error: `Erreur création dette: ${debtError.message}`
        });
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // MODE VENTE NORMALE (pas dette)
    // ═══════════════════════════════════════════════════════════════════════

    // 3. Préparer les données de vente
    const finalSaleData = {
      ...saleData,
      invoice_number: invoiceNumber,
      sold_at: dateISO,
      seller_user_id: req.user?.id || null,
      seller_name: req.user?.username || req.body.seller_name || 'System',
      total_fc: finalTotalFC,
      total_usd: finalTotalUSD,
      paid_fc: finalTotalFC,
      paid_usd: finalTotalUSD,
      origin: 'LOCAL',
    };

    // 4. Créer la vente en SQL local (transaction)
    const sale = salesRepo.create(finalSaleData);

    // ✅ PRO: Système unifié - enqueueSale gère tout:
    // - Opération SALE pour sync vente vers Sheets
    // - Opérations STOCK_MOVE avec stock_absolute pour sync stock
    try {
      outboxRepo.enqueueSale(sale, sale.items || saleData.items || []);
      logger.info(`📤 [SALE] ${sale.invoice_number} enqueued (vente + stock)`);
    } catch (outboxErr) {
      logger.warn(`⚠️ [SALE] Erreur enqueue: ${outboxErr.message}`);
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
      const printDir = getPrintDir(); // ✅ Crée automatiquement les dossiers si nécessaire
      
      // ✅ LOG TRÈS VISIBLE DANS LE TERMINAL
      console.log('\n' + '='.repeat(70));
      console.log('🖨️  [SALES] CRÉATION JOB D\'IMPRESSION');
      console.log('='.repeat(70));
      console.log(`📁 Dossier UNIFIÉ (DEV+EXE): ${printDir}`);
      console.log(`📄 Facture: ${sale.invoice_number}`);
      console.log('='.repeat(70) + '\n');
      
      // LOG: Chemin utilisé pour l'impression
      logger.info('🖨️  [PRINT] ==========================================');
      logger.info('🖨️  [PRINT] DÉBUT CRÉATION JOB D\'IMPRESSION');
      logger.info('🖨️  [PRINT] ==========================================');
      logger.info(`📁 [PRINT] Dossier printer UNIFIÉ: ${printDir}`);
      logger.info(`📄 [PRINT] Facture: ${sale.invoice_number}`);
      
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
        
        // ✅ LOG TRÈS VISIBLE DANS LE TERMINAL
        console.log('\n' + '-'.repeat(50));
        console.log(`✅ [SALES] JOB CRÉÉ AVEC SUCCÈS!`);
        console.log(`📄 Fichier: ${path.basename(jobFile)}`);
        console.log(`📁 Chemin: ${jobFile}`);
        console.log(`📊 Taille: ${stats.size} bytes`);
        console.log(`⏳ Le watcher devrait le détecter sous peu...`);
        console.log('-'.repeat(50) + '\n');
        
        logger.info(`✅ [PRINT] Job créé avec succès!`);
        logger.info(`   - Nom: ${path.basename(jobFile)}`);
        logger.info(`   - Taille: ${stats.size} bytes`);
        logger.info(`   - Chemin: ${jobFile}`);
        logger.info(`✅ [PRINT] Le watcher devrait détecter ce fichier dans quelques secondes...`);
        logger.info('🖨️  [PRINT] ==========================================');
      } else {
        console.log('\n' + '!'.repeat(50));
        console.log(`❌ [SALES] ERREUR: Fichier non créé!`);
        console.log(`📁 Chemin attendu: ${jobFile}`);
        console.log('!'.repeat(50) + '\n');
        
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
 * ✅ Supprime également les lignes dans la feuille "Ventes" de Sheets
 */
router.post('/:invoice/void', authenticate, (req, res) => {
  try {
    const { reason } = req.body;
    const invoiceNumber = req.params.invoice;
    
    // Récupérer les items AVANT l'annulation pour restaurer le stock dans Sheets
    const db = getDb();
    const saleItems = db.prepare(`
      SELECT si.product_code, si.qty, si.unit_level, si.unit_mark
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.invoice_number = ?
    `).all(invoiceNumber);
    
    const sale = salesRepo.voidSale(invoiceNumber, reason, req.user.id);

    // ✅ PRO: Supprimer les lignes dans Sheets ET restaurer le stock
    try {
      outboxRepo.enqueueSaleDeleted(sale.invoice_number, saleItems);
      logger.info(`📤 [VOID] SALE_DELETED enqueued pour facture ${sale.invoice_number}`);
    } catch (syncErr) {
      logger.warn(`⚠️ [VOID] Erreur sync Sheets: ${syncErr.message}`);
    }

    // Audit log
    auditRepo.log(req.user.id, 'sale_void', {
      invoice_number: sale.invoice_number,
      reason,
    });

    // Émettre l'événement WebSocket
    const io = getSocketIO();
    if (io) {
      io.emit('sale:updated', sale);
      io.emit('sale:deleted', { invoice_number: sale.invoice_number });
    }

    res.json({ success: true, sale, sync: 'sheets_queued' });
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

/**
 * DELETE /api/sales/:invoiceNumber
 * ✅ PRO: Supprime une vente et restaure le stock des produits
 * - Restaure le stock de chaque produit selon l'unité vendue
 * - Supprime la vente de SQLite immédiatement
 * - ✅ Enqueue update_stock pour sync vers Sheets
 * - ✅ Gestion robuste des unités (CARTON, MILLIER, PIECE, DETAIL)
 */
router.delete('/:invoiceNumber', optionalAuth, async (req, res) => {
  const db = getDb();
  // Décoder l'URL pour gérer les caractères spéciaux
  const invoiceNumber = decodeURIComponent(req.params.invoiceNumber || '').trim();
  
  logger.info(`\n${'═'.repeat(60)}`);
  logger.info(`🗑️ [DELETE SALE] Requête suppression reçue`);
  logger.info(`   📄 Invoice Number: "${invoiceNumber}"`);
  logger.info(`${'═'.repeat(60)}`);
  
  // Validation
  if (!invoiceNumber) {
    logger.error(`   ❌ Invoice number manquant ou vide`);
    return res.status(400).json({ success: false, error: 'Numéro de facture requis' });
  }
  
  try {
    // 1. Récupérer la vente
    const sale = db.prepare(`
      SELECT * FROM sales WHERE invoice_number = ? LIMIT 1
    `).get(invoiceNumber);
    
    if (!sale) {
      logger.warn(`   ⚠️ Facture non trouvée: "${invoiceNumber}"`);
      return res.status(404).json({ 
        success: false, 
        error: `Facture non trouvée: ${invoiceNumber}`
      });
    }
    
    logger.info(`   ✅ Vente trouvée: ID=${sale.id}, Client=${sale.client_name}`);
    
    // 2. Récupérer les items de cette vente
    const saleItems = db.prepare(`
      SELECT si.*, p.id as product_id_lookup, p.uuid as product_uuid
      FROM sale_items si
      LEFT JOIN products p ON p.code = si.product_code
      WHERE si.sale_id = ?
    `).all(sale.id);
    
    logger.info(`   📦 ${saleItems.length} item(s) trouvé(s) en base de données`);
    if (saleItems.length === 0) {
      logger.warn(`   ⚠️ Aucun item trouvé pour cette vente - vérifier si déjà supprimée ou sans items`);
    }
    
    // ✅ PRO: Fonction pour normaliser l'unité (utile pour restauration locale du stock)
    const normalizeUnitLevel = (unitLevel) => {
      if (!unitLevel) return 'CARTON';
      const ul = String(unitLevel).toUpperCase().trim();
      
      // Mapping des variantes vers format standard
      const unitMap = {
        'MILLIERS': 'MILLIER',
        'MILLIER': 'MILLIER',
        'MIL': 'MILLIER',
        'CARTON': 'CARTON',
        'CARTONS': 'CARTON',
        'CTN': 'CARTON',
        'PIECE': 'PIECE',
        'PIECES': 'PIECE',
        'PCS': 'PIECE',
        'DETAIL': 'PIECE',
        'DÉTAIL': 'PIECE',
        'DZ': 'PIECE', // Douzaine = détail
        'PQT': 'PIECE', // Paquet = détail
      };
      
      return unitMap[ul] || ul;
    };
    
    // 3. Préparer les items pour restauration de stock
    const items = saleItems.map(item => {
      const qty = parseFloat(item.qty) || 0;
      if (qty <= 0) {
        logger.warn(`      ⚠️ Item ${item.product_code}: quantité invalide (${item.qty}), ignorée`);
        return null;
      }
      const unitLevel = normalizeUnitLevel(item.unit_level);
      const unitMark = item.unit_mark || '';
      
      // Obtenir le product_id si absent
      let productId = item.product_id || item.product_id_lookup;
      if (!productId && item.product_code) {
        const prod = db.prepare('SELECT id, uuid FROM products WHERE code = ? LIMIT 1').get(item.product_code);
        if (prod) productId = prod.id;
      }
      
      logger.info(`      ✓ Item: ${item.product_code} x${qty} ${unitLevel}/${unitMark} → product_id=${productId}`);
      
      return {
        product_code: item.product_code,
        product_uuid: item.product_uuid,
        product_id: productId,
        qty: qty,
        unit_level: unitLevel,
        unit_mark: unitMark
      };
    }).filter(item => item !== null);
    
    logger.info(`   📋 Items valides à restaurer: ${items.length}/${saleItems.length}`);
    
    // 3. Restaurer le stock via l'API (même logique que ProductsPage.jsx)
    // Cela déclenche la synchro vers Sheets automatiquement
    const stockRestored = [];
    
    logger.info(`   🔄 [STOCK-RESTORE] Début restauration pour ${items.length} item(s)`);
    
    // Grouper les items par produit pour éviter les appels API en double
    for (const item of items) {
      const { product_code: productCode, product_id: productId, qty, unit_level: unitLevel, unit_mark: unitMark } = item;
      
      if (!productId) {
        logger.warn(`   ⚠️ Produit non trouvé: ${productCode}`);
        continue;
      }
      
      logger.info(`   🔄 Restauration: ${productCode} x${qty} (${unitLevel})`);
      
      try {
        // Récupérer le produit complet (comme ProductsPage fait avec axios.get)
        const product = productsRepo.findByCode(productCode);
        if (!product) {
          logger.warn(`   ⚠️ Produit non trouvé en repo: ${productCode}`);
          continue;
        }
        
        // Trouver l'unité à mettre à jour
        const unitToUpdate = product.units?.find(u => 
          u.unit_level === unitLevel && 
          (unitMark ? u.unit_mark === unitMark : true)
        );
        if (!unitToUpdate) {
          logger.warn(`   ⚠️ Unité non trouvée: ${productCode}/${unitLevel}`);
          continue;
        }
        
        // Calculer le nouveau stock: stock_actuel + quantité_vendue
        const oldStock = Math.round((unitToUpdate.stock_current || 0) * 100) / 100;
        const newStock = Math.round((oldStock + qty) * 100) / 100;
        
        logger.info(`      📊 Calcul: ${oldStock} + ${qty} = ${newStock}`);
        
        // Construire le payload exactement comme ProductsPage.jsx le fait
        // (avec buildUnitPayload qui normalise les champs)
        const updatedUnits = product.units.map(u => {
          const isTargetUnit = u.unit_level === unitLevel && 
            (unitMark ? u.unit_mark === unitMark : true);
          
          if (isTargetUnit) {
            // ✅ Mettre à jour le stock (matching buildUnitPayload logic)
            return {
              id: u.id,
              uuid: u.uuid,
              unit_level: u.unit_level,
              unit_mark: u.unit_mark || '',
              stock_initial: newStock,  // ✅ CRITICAL: Les deux doivent être identiques
              stock_current: newStock,
              purchase_price_usd: u.purchase_price_usd || 0,
              sale_price_usd: u.sale_price_usd || 0,
              auto_stock_factor: u.auto_stock_factor || 1,
              qty_step: u.qty_step || 1,
              extra1: u.extra1 || null,
              extra2: u.extra2 || null,
              last_update: new Date().toISOString(),
              synced_at: null
            };
          }
          
          // Autres unités: garder inchangées
          return {
            id: u.id,
            uuid: u.uuid,
            unit_level: u.unit_level,
            unit_mark: u.unit_mark || '',
            stock_initial: u.stock_initial || 0,
            stock_current: u.stock_current || 0,
            purchase_price_usd: u.purchase_price_usd || 0,
            sale_price_usd: u.sale_price_usd || 0,
            auto_stock_factor: u.auto_stock_factor || 1,
            qty_step: u.qty_step || 1,
            extra1: u.extra1 || null,
            extra2: u.extra2 || null,
            last_update: u.last_update,
            synced_at: u.synced_at
          };
        });
        
        // Construire le payload final (comme axios.put dans ProductsPage)
        const updatePayload = {
          code: productCode,  // ✅ CRITICAL: code est needed pour upsert()
          name: product.name,
          units: updatedUnits
        };
        
        logger.info(`      📤 Payload pour upsert: code=${updatePayload.code}, name=${updatePayload.name}, units=${updatedUnits.length}`);
        logger.info(`         Unit cible: ${updatedUnits.find(u => u.unit_level === unitLevel)?.stock_current} stock`);
        
        // Appeler productsRepo.upsert qui va mettre à jour le produit
        try {
          const updatedProduct = productsRepo.upsert(updatePayload);
          logger.info(`      ✅ upsert() complété pour ${productCode}`);
          logger.info(`      📊 upsert() returned:`, updatedProduct ? 'définition' : 'undefined');
        } catch (upsertError) {
          logger.error(`      ❌ upsert() ERROR: ${upsertError.message}`);
          throw upsertError;
        }
        
        // ✅ Récupérer le produit pour vérifier que le stock a été mis à jour
        const fullProduct = productsRepo.findByCode(productCode);
        logger.info(`      🔍 findByCode() returned:`, fullProduct ? 'found' : 'NULL');
        
        if (!fullProduct) {
          logger.error(`      ❌ Produit NOT FOUND après upsert: ${productCode}`);
          continue;
        }
        
        if (!fullProduct.units || !Array.isArray(fullProduct.units)) {
          logger.error(`      ❌ Units NOT FOUND ou pas array: ${productCode}`);
          logger.error(`         fullProduct.units =`, fullProduct.units);
          continue;
        }
        
        logger.info(`      ✅ Produit trouvé avec ${fullProduct.units.length} unité(s)`);
        
        const updatedUnit = fullProduct.units.find(u => u.unit_level === unitLevel && (unitMark ? u.unit_mark === unitMark : true));
        if (updatedUnit) {
          logger.info(`      ✅ Vérification: stock mis à jour à ${updatedUnit.stock_current} (nouvelle valeur)`);
        } else {
          logger.warn(`      ⚠️ Unité NOT FOUND dans fullProduct: ${unitLevel}/${unitMark}`);
          logger.warn(`         Units disponibles:`, fullProduct.units.map(u => `${u.unit_level}/${u.unit_mark || 'N/A'}`));
        }
        
        // Enqueue les patches pour synchro Sheets
        for (const unit of fullProduct.units) {
          // Enqueue le patch unité pour synchro Sheets
          outboxRepo.enqueueUnitPatch(
            fullProduct.uuid,
            fullProduct.code,
            unit.unit_level,
            unit.unit_mark || '',
            {
              purchase_price_usd: unit.purchase_price_usd || 0,
              sale_price_usd: unit.sale_price_usd || 0,
              sale_price_fc: unit.sale_price_fc || 0,
              stock_current: unit.stock_current || unit.stock_initial || 0,
              stock_initial: unit.stock_initial || unit.stock_current || 0,
              auto_stock_factor: unit.auto_stock_factor || 1,
              qty_step: unit.qty_step || 1
            }
          );
        }
        
        stockRestored.push({
          product_code: productCode,
          product_uuid: product.uuid,
          qty: qty,
          unit_level: unitLevel,
          unit_mark: unitMark,
          stock_before: oldStock,
          stock_after: newStock
        });
        
        logger.info(`      ✅ Stock restauré: ${oldStock} → ${newStock}`);
        
      } catch (itemError) {
        logger.error(`      ❌ Erreur restauration ${productCode}: ${itemError.message}`);
        logger.error(`         Stack: ${itemError.stack}`);
        // Continue anyway - local deletion still succeeds
      }
    }
    
    // 4. Supprimer les items de vente
    let itemsDeleted = 0;
    try {
      const result = db.prepare(`DELETE FROM sale_items WHERE sale_id = ?`).run(sale.id);
      itemsDeleted = result.changes;
      logger.info(`   🗑️ ${itemsDeleted} sale_items supprimés`);
    } catch (e) {
      logger.error(`   ❌ Erreur suppression sale_items: ${e.message}`);
      throw e;
    }
    
    // 5. Supprimer les voids associés AVANT la vente (contrainte FK)
    let voidsDeleted = 0;
    try {
      const result = db.prepare(`DELETE FROM sale_voids WHERE sale_id = ?`).run(sale.id);
      voidsDeleted = result.changes;
      if (voidsDeleted > 0) {
        logger.info(`   🗑️ ${voidsDeleted} sale_voids supprimés`);
      }
    } catch (e) {
      logger.warn(`   ⚠️ Erreur suppression voids: ${e.message}`);
    }
    
    // 6. Supprimer la dette associée si elle existe
    let debtDeleted = 0;
    try {
      const result = db.prepare(`DELETE FROM debts WHERE invoice_number = ?`).run(invoiceNumber);
      debtDeleted = result.changes;
      if (debtDeleted > 0) {
        logger.info(`   🗑️ Dette associée supprimée`);
      }
    } catch (e) {
      logger.warn(`   ⚠️ Erreur suppression dette: ${e.message}`);
    }
    
    // ✅ 7. MARQUER COMME SUPPRIMÉE (soft delete via deleted_sales)
    // Cela évite que la vente réapparaisse si elle revient de Sheets lors du sync
    // On NE supprime PAS physiquement la vente pour éviter les FK constraint violations
    let marked = 0;
    try {
      const result = db.prepare(`
        INSERT INTO deleted_sales (invoice_number, sale_id, reason, deleted_by)
        VALUES (?, ?, 'manual_deletion', NULL)
      `).run(invoiceNumber, sale.id);
      marked = result.changes;
      logger.info(`   ✅ Vente marquée comme supprimée dans deleted_sales (soft-delete)`);
    } catch (e) {
      logger.error(`   ❌ Erreur insertion deleted_sales: ${e.message}`);
      throw e;
    }
    
    // 8. Notifier via WebSocket pour rafraîchir UI localement + AI LaGrace
    try {
      const io = getSocketIO();
      if (io) {
        io.emit('sale:deleted', { 
          invoice_number: invoiceNumber,
          client_name: sale.client_name || '',  // ✅ Pour l'IA vocale
          stock_restored: stockRestored.length 
        });
        io.emit('stock:updated', { 
          products: stockRestored.map(s => s.product_code),
          reason: 'sale_deleted',
          ts: new Date().toISOString()
        });
        io.emit('products:updated', {
          ts: new Date().toISOString(),
          count: stockRestored.length,
          source: 'SALE_DELETE'
        });
      }
    } catch (e) {
      logger.warn(`   ⚠️ WebSocket notification failed: ${e.message}`);
    }
    
    // ✅ 9. SYNC SHEETS: Enqueue suppression pour supprimer les lignes dans la feuille "Ventes"
    // Note: Le stock est restauré localement, la sync vers Sheets supprime juste les lignes de vente
    try {
      outboxRepo.enqueueSaleDeleted(invoiceNumber, items.filter(i => i !== null));
      logger.info(`   📤 SYNC Sheets: SALE_DELETED enqueued pour facture ${invoiceNumber}`);
    } catch (syncErr) {
      logger.warn(`   ⚠️ Erreur enqueue SALE_DELETED (sync continuera en background): ${syncErr.message}`);
    }
    
    logger.info(`${'═'.repeat(60)}`);
    logger.info(`✅ [DELETE SALE] Facture ${invoiceNumber} supprimée`);
    logger.info(`   Stock restauré localement: ${stockRestored.length} produit(s)`);
    logger.info(`   Sync Sheets: Suppression des lignes en cours...`);
    logger.info(`${'═'.repeat(60)}\n`);
    
    // ✅ Notifier les clients pour invalider le cache analytics (totaux d'argent)
    // Cela force le frontend à recharger les totaux du jour (Dashboard)
    try {
      const io = getSocketIO();
      if (io) {
        io.emit('analytics:invalidate', {
          scope: 'today',
          reason: 'sale_deleted',
          invoice_number: invoiceNumber
        });
        logger.info(`   📊 WebSocket: analytics:invalidate émis`);
      }
    } catch (e) {
      logger.warn(`   ⚠️ WebSocket analytics:invalidate failed: ${e.message}`);
    }
    
    res.json({
      success: true,
      message: `Facture ${invoiceNumber} supprimée et stock restauré`,
      stockRestored: stockRestored,
      sync: 'sheets_queued'
    });
    
  } catch (error) {
    logger.error(`❌ [DELETE SALE] Erreur:`, error);
    logger.error(`   Message: ${error.message}`);
    logger.error(`   Stack: ${error.stack}`);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: `Erreur lors de la suppression: ${error.message}`,
      details: error.stack
    });
  }
});

export default router;

