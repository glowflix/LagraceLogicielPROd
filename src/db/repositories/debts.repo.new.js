import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';
import crypto from 'crypto';

/**
 * Repository pour la gestion des dettes (VERSION AMÉLIORÉE)
 * 
 * RÈGLES MÉTIER:
 * - Les dettes sont TOUJOURS en USD (devise de référence)
 * - FC est calculé pour affichage uniquement (via taux du jour)
 * - Chaque dette a des UUIDs stables (client_uuid, product_uuid, debt_uuid)
 * - Les paiements sont tracés dans debt_payments avec date (pour stats du jour)
 * - Sync automatique vers Google Sheets → feuille "Dettes"
 */
export class DebtsRepository {
  /**
   * Crée une dette depuis une vente en mode dette
   * @param {Object} saleData - Données de la vente
   * @param {Object} options - Options { initialPaymentUsd, rateUsed }
   * @returns {Object} - Dette créée
   */
  createFromSale(saleData, options = {}) {
    const db = getDb();
    
    const transaction = db.transaction(() => {
      try {
        const now = new Date().toISOString();
        
        // ✅ Vérifier si une dette existe déjà pour cette facture
        const existingDebt = db.prepare(`
          SELECT * FROM debts WHERE invoice_number = ? LIMIT 1
        `).get(saleData.invoice_number);
        
        if (existingDebt) {
          logger.info(`💳 [Debts] Dette existante trouvée pour invoice ${saleData.invoice_number}`);
          return existingDebt;
        }
        
        const debtUuid = generateUUID();
        
        // Extraire les données essentielles
        const totalUsd = saleData.total_usd || 0;
        const totalFc = saleData.total_fc || 0;
        const rateUsed = options.rateUsed || saleData.rate_fc_per_usd || 2800;
        
        // Paiement initial (si fourni)
        const initialPaymentUsd = options.initialPaymentUsd || 0;
        const initialPaymentFc = initialPaymentUsd * rateUsed;
        
        // Calculs
        const paidUsd = initialPaymentUsd;
        const remainingUsd = Math.max(0, totalUsd - paidUsd);
        const paidFc = initialPaymentFc;
        const remainingFc = Math.max(0, totalFc - paidFc);
        
        // Déterminer le statut initial
        let status = 'open';
        if (remainingUsd <= 0.01) {
          status = 'paid';
        } else if (paidUsd > 0) {
          status = 'partial';
        }
        
        // Construire description produits
        const productDescription = this._buildProductDescription(saleData.items);
        
        logger.info(`💳 [Debts] Création dette depuis vente:`);
        logger.info(`   Invoice: ${saleData.invoice_number}`);
        logger.info(`   Client: ${saleData.client_name || 'Inconnu'}`);
        logger.info(`   Total: ${totalUsd} USD / ${totalFc} FC`);
        logger.info(`   Paiement initial: ${paidUsd} USD`);
        logger.info(`   Reste: ${remainingUsd} USD`);
        logger.info(`   Statut: ${status}`);
        
        const itemsJson = saleData.items && Array.isArray(saleData.items)
          ? JSON.stringify(saleData.items)
          : null;

        const deviceId = saleData.device_id || saleData.source_device || null;

        // ✅ Créer la dette (migration 002: colonnes USD + items_json + device_id)
        const result = db.prepare(`
          INSERT INTO debts (
            uuid,
            sale_id,
            invoice_number,
            client_name,
            client_phone,
            client_uuid,
            product_description,
            items_json,
            total_usd,
            paid_usd,
            remaining_usd,
            total_fc,
            paid_fc,
            remaining_fc,
            debt_fc_in_usd,
            status,
            note,
            device_id,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          debtUuid,
          saleData.id || null,
          saleData.invoice_number,
          saleData.client_name || 'Client',
          saleData.client_phone || null,
          saleData.client_uuid || null,
          productDescription,
          itemsJson,
          totalUsd,
          paidUsd,
          remainingUsd,
          totalFc,
          paidFc,
          remainingFc,
          totalFc,
          status,
          saleData.note || null,
          deviceId,
          now
        );
        
        const debtId = result.lastInsertRowid;
        logger.info(`   ✅ Dette créée: ID ${debtId}, UUID ${debtUuid.substring(0, 8)}...`);
        
        // Créer les items de dette (table séparée si elle existe)
        if (saleData.items && Array.isArray(saleData.items)) {
          this._createDebtItemsSafe(db, debtId, saleData.items);
        }
        
        // Retourner la dette créée
        const debt = db.prepare('SELECT * FROM debts WHERE id = ?').get(debtId);
        return {
          ...debt,
          paid_usd: paidUsd,
          remaining_usd: remainingUsd,
          items: saleData.items
        };
      } catch (error) {
        logger.error('❌ [Debts] Erreur createFromSale:', error);
        throw error;
      }
    });
    
    return transaction();
  }
  
  /**
   * Créer les items de dette de manière sécurisée (vérifie si table existe)
   */
  _createDebtItemsSafe(db, debtId, items) {
    try {
      // Vérifier si la table debt_items existe
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='debt_items'
      `).get();
      
      if (!tableExists) {
        logger.info('   ℹ️ Table debt_items n\'existe pas, skip items');
        return;
      }
      
      for (const item of items) {
        db.prepare(`
          INSERT INTO debt_items (debt_id, product_code, product_name, qty, unit_price_fc, line_total_fc)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          debtId,
          item.product_code,
          item.product_name,
          item.qty,
          item.unit_price_fc || 0,
          item.subtotal_fc || 0
        );
      }
    } catch (e) {
      logger.warn('   ⚠️ Erreur création debt_items:', e.message);
    }
  }
  
  /**
   * Créer le paiement initial de manière sécurisée
   */
  _createInitialPaymentSafe(db, debtId, paymentData) {
    try {
      db.prepare(`
        INSERT INTO debt_payments (debt_id, amount_fc, payment_mode, paid_by, paid_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(
        debtId,
        paymentData.amount_fc,
        'cash',
        paymentData.paid_by
      );
      logger.info('   ✅ Paiement initial enregistré');
    } catch (e) {
      logger.warn('   ⚠️ Erreur création paiement initial:', e.message);
    }
  }
  
  /**
   * Crée une dette directement (sans vente associée)
   * @param {Object} debtData - Données de la dette
   * @returns {Object} - Dette créée
   */
  create(debtData) {
    const db = getDb();
    
    try {
      const debtUuid = debtData.uuid || generateUUID();
      const now = new Date().toISOString();
      
      // S'assurer que les valeurs USD sont présentes
      const totalUsd = debtData.total_usd || 0;
      const paidUsd = debtData.paid_usd || 0;
      const remainingUsd = debtData.remaining_usd !== undefined 
        ? debtData.remaining_usd 
        : Math.max(0, totalUsd - paidUsd);
      
      // Calculer FC si non fourni
      const rateUsed = debtData.rate_fc_per_usd || 2800;
      const totalFc = debtData.total_fc || (totalUsd * rateUsed);
      const paidFc = debtData.paid_fc || (paidUsd * rateUsed);
      const remainingFc = debtData.remaining_fc || (remainingUsd * rateUsed);
      
      // Statut
      let status = debtData.status || 'open';
      if (remainingUsd <= 0.01 && status !== 'paid') {
        status = 'paid';
      } else if (paidUsd > 0 && status === 'open') {
        status = 'partial';
      }
      
      logger.info(`💳 [Debts] Création dette directe:`);
      logger.info(`   Client: ${debtData.client_name}`);
      logger.info(`   Total: ${totalUsd} USD`);
      
      const result = db.prepare(`
        INSERT INTO debts (
          uuid, invoice_number, 
          client_name, client_phone, client_uuid,
          product_description, items_json,
          total_usd, paid_usd, remaining_usd,
          total_fc, paid_fc, remaining_fc,
          status, note, device_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        debtUuid,
        debtData.invoice_number || null,
        debtData.client_name || 'Client',
        debtData.client_phone || null,
        debtData.client_uuid || null,
        debtData.product_description || null,
        debtData.items_json || null,
        totalUsd,
        paidUsd,
        remainingUsd,
        totalFc,
        paidFc,
        remainingFc,
        status,
        debtData.note || null,
        debtData.device_id || null,
        debtData.created_at || now
      );
      
      const debt = this.findById(result.lastInsertRowid);
      this.createSyncOperation(debt, 'upsert');
      
      return debt;
    } catch (error) {
      logger.error('❌ [Debts] Erreur create:', error);
      throw error;
    }
  }
  
  /**
   * Trouve une dette par ID
   */
  findById(id) {
    const db = getDb();
    try {
      const debt = db.prepare('SELECT * FROM debts WHERE id = ?').get(id);
      if (!debt) return null;
      
      // Charger les paiements
      const payments = db.prepare(`
        SELECT * FROM debt_payments 
        WHERE debt_id = ? 
        ORDER BY paid_at DESC
      `).all(id);
      
      // Charger les items si disponibles
      let items = [];
      try {
        items = db.prepare('SELECT * FROM debt_items WHERE debt_id = ?').all(id);
      } catch (e) {
        // Table peut ne pas exister encore
        if (debt.items_json) {
          try {
            items = JSON.parse(debt.items_json);
          } catch (parseErr) {
            items = [];
          }
        }
      }
      
      return { ...debt, payments, items };
    } catch (error) {
      logger.error('Erreur findById debt:', error);
      throw error;
    }
  }
  
  /**
   * Trouve une dette par UUID
   */
  findByUuid(uuid) {
    const db = getDb();
    try {
      const debt = db.prepare('SELECT * FROM debts WHERE uuid = ?').get(uuid);
      if (!debt) return null;
      return this.findById(debt.id);
    } catch (error) {
      logger.error('Erreur findByUuid debt:', error);
      throw error;
    }
  }
  
  /**
   * Trouve une dette par numéro de facture
   */
  findByInvoice(invoiceNumber) {
    const db = getDb();
    try {
      const debt = db.prepare('SELECT * FROM debts WHERE invoice_number = ?').get(invoiceNumber);
      if (!debt) return null;
      return this.findById(debt.id);
    } catch (error) {
      logger.error('Erreur findByInvoice debt:', error);
      throw error;
    }
  }
  
  /**
   * Liste toutes les dettes avec filtres
   */
  findAll(filters = {}) {
    const db = getDb();
    try {
      let query = 'SELECT * FROM debts WHERE 1=1';
      const params = [];
      
      if (filters.status) {
        if (filters.status === 'open_or_partial') {
          query += " AND (status = 'open' OR status = 'partial')";
        } else {
          query += ' AND status = ?';
          params.push(filters.status);
        }
      }
      
      if (filters.client_uuid) {
        query += ' AND client_uuid = ?';
        params.push(filters.client_uuid);
      }
      
      if (filters.client_name) {
        query += ' AND client_name LIKE ?';
        params.push(`%${filters.client_name}%`);
      }
      
      if (filters.invoice_number) {
        query += ' AND invoice_number = ?';
        params.push(filters.invoice_number);
      }
      
      if (filters.from_date) {
        query += ' AND date(created_at) >= ?';
        params.push(filters.from_date.substring(0, 10));
      }
      
      if (filters.to_date) {
        query += ' AND date(created_at) <= ?';
        params.push(filters.to_date.substring(0, 10));
      }
      
      query += ' ORDER BY created_at DESC';
      
      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }
      
      logger.debug(`🔍 [Debts] Query: ${query}`);
      logger.debug(`   Params: ${JSON.stringify(params)}`);
      
      const debts = db.prepare(query).all(...params);
      
      logger.info(`📊 [Debts] findAll: ${debts.length} dette(s) trouvée(s)`);
      
      return debts;
    } catch (error) {
      logger.error('❌ [Debts] Erreur findAll:', error);
      throw error;
    }
  }
  
  /**
   * Liste les dettes d'un client
   */
  findByClient(clientUuid) {
    return this.findAll({ client_uuid: clientUuid });
  }
  
  /**
   * Génère un UUID stable pour une dette basé sur des champs déterministes
   */
  generateStableDebtUuid(debtData) {
    const key = [
      debtData.invoice_number || '',
      debtData.client_name || '',
      String(debtData.product_description || ''),
      debtData.created_at || new Date().toISOString()
    ].join('|');
    
    const hash = crypto.createHash('sha1').update(key).digest('hex');
    return hash.substring(0, 32);
  }
  
  /**
   * Crée ou met à jour une dette (upsert)
   * Utilisé principalement pour la synchronisation depuis Sheets
   */
  upsert(debtData) {
    const db = getDb();
    
    try {
      // Chercher dette existante
      let existing = null;
      if (debtData.invoice_number) {
        existing = db.prepare(`
          SELECT * FROM debts
          WHERE invoice_number = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `).get(debtData.invoice_number);
      } else if (debtData.uuid) {
        existing = db.prepare('SELECT * FROM debts WHERE uuid = ?').get(debtData.uuid);
      }
      
      // Générer UUID si nécessaire
      let debtUuid = existing?.uuid || debtData.uuid;
      if (!debtUuid) {
        debtUuid = this.generateStableDebtUuid(debtData);
        logger.info(`   🔑 [UUID] UUID stable généré: ${debtUuid.substring(0, 8)}...`);
      }
      
      // Valeurs USD (priorité) puis FC
      const totalUsd = debtData.total_usd !== undefined ? debtData.total_usd : (existing?.total_usd || 0);
      const paidUsd = debtData.paid_usd !== undefined ? debtData.paid_usd : (existing?.paid_usd || 0);
      const remainingUsd = debtData.remaining_usd !== undefined 
        ? debtData.remaining_usd 
        : Math.max(0, totalUsd - paidUsd);
      
      if (existing) {
        // Mise à jour
        logger.info(`💾 [Debts] UPDATE id=${existing.id}, invoice=${debtData.invoice_number}`);
        
        db.prepare(`
          UPDATE debts SET
            uuid = COALESCE(?, uuid),
            client_name = ?,
            client_phone = ?,
            client_uuid = COALESCE(?, client_uuid),
            product_description = ?,
            items_json = COALESCE(?, items_json),
            total_usd = ?,
            paid_usd = ?,
            remaining_usd = ?,
            total_fc = ?,
            paid_fc = ?,
            remaining_fc = ?,
            debt_fc_in_usd = ?,
            note = ?,
            status = ?,
            created_at = COALESCE(?, created_at),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          debtUuid,
          debtData.client_name || existing.client_name || '',
          debtData.client_phone || existing.client_phone || null,
          debtData.client_uuid || null,
          debtData.product_description || existing.product_description || null,
          debtData.items_json || null,
          totalUsd,
          paidUsd,
          remainingUsd,
          debtData.total_fc !== undefined ? debtData.total_fc : existing.total_fc,
          debtData.paid_fc !== undefined ? debtData.paid_fc : existing.paid_fc,
          debtData.remaining_fc !== undefined ? debtData.remaining_fc : existing.remaining_fc,
          debtData.debt_fc_in_usd || existing.debt_fc_in_usd || null,
          debtData.note || existing.note || null,
          debtData.status || existing.status || 'open',
          debtData.created_at || existing.created_at,
          existing.id
        );
        
        const updated = this.findById(existing.id);
        this.createSyncOperation(updated, 'upsert');
        return updated;
      } else {
        // Création
        logger.info(`💾 [Debts] INSERT nouvelle dette`);
        
        const result = db.prepare(`
          INSERT INTO debts (
            uuid, invoice_number, client_name, client_phone, client_uuid,
            product_description, items_json,
            total_usd, paid_usd, remaining_usd,
            total_fc, paid_fc, remaining_fc, debt_fc_in_usd,
            note, status, device_id, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          debtUuid,
          debtData.invoice_number || null,
          debtData.client_name || '',
          debtData.client_phone || null,
          debtData.client_uuid || null,
          debtData.product_description || null,
          debtData.items_json || null,
          totalUsd,
          paidUsd,
          remainingUsd,
          debtData.total_fc || 0,
          debtData.paid_fc || 0,
          debtData.remaining_fc !== undefined ? debtData.remaining_fc : (debtData.total_fc || 0) - (debtData.paid_fc || 0),
          debtData.debt_fc_in_usd || null,
          debtData.note || null,
          debtData.status || 'open',
          debtData.device_id || null,
          debtData.created_at || new Date().toISOString()
        );
        
        const created = this.findById(result.lastInsertRowid);
        this.createSyncOperation(created, 'upsert');
        return created;
      }
    } catch (error) {
      logger.error('❌ [Debts] Erreur upsert:', error);
      throw error;
    }
  }
  
  /**
   * Ajoute un paiement à une dette
   * @param {number} debtId - ID de la dette
   * @param {Object} paymentData - Données du paiement
   * @returns {Object} - Dette mise à jour
   */
  addPayment(debtId, paymentData) {
    const db = getDb();
    
    const transaction = db.transaction(() => {
      try {
        const debt = this.findById(debtId);
        if (!debt) {
          throw new Error(`Dette non trouvée: ID ${debtId}`);
        }
        
        const paymentUuid = paymentData.uuid || generateUUID();
        const paidAt = paymentData.paid_at || new Date().toISOString();
        
        // Calculer les montants
        const amountUsd = paymentData.amount_usd || 0;
        const amountFc = paymentData.amount_fc || 0;
        const rateUsed = paymentData.rate_fc_per_usd || 2800;
        
        // Si on a seulement FC, convertir en USD
        const finalAmountUsd = amountUsd > 0 ? amountUsd : (amountFc / rateUsed);
        const finalAmountFc = amountFc > 0 ? amountFc : (amountUsd * rateUsed);
        
        logger.info(`💳 [Debts] Ajout paiement:`);
        logger.info(`   Dette ID: ${debtId}, Client: ${debt.client_name}`);
        logger.info(`   Montant: ${finalAmountUsd} USD / ${finalAmountFc} FC`);
        logger.info(`   Date: ${paidAt}`);
        
        // Insérer le paiement
        db.prepare(`
          INSERT INTO debt_payments (
            uuid, debt_id, amount_fc, amount_usd, rate_fc_per_usd,
            payment_mode, paid_by, note, paid_at, device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          paymentUuid,
          debtId,
          finalAmountFc,
          finalAmountUsd,
          rateUsed,
          paymentData.payment_mode || 'cash',
          paymentData.paid_by || null,
          paymentData.note || null,
          paidAt,
          paymentData.device_id || null
        );

        // ⚠️ IMPORTANT: migration 002 installe des triggers qui appliquent automatiquement
        // le paiement à la dette (paid_* / remaining_* / status). On ne met PAS à jour
        // la table debts ici pour éviter le double comptage.
        
        // Créer opération sync pour le paiement
        this.createPaymentSyncOperation(paymentUuid, {
          uuid: paymentUuid,
          debt_uuid: debt.uuid,
          invoice_number: debt.invoice_number,
          client_name: debt.client_name,
          amount_usd: finalAmountUsd,
          amount_fc: finalAmountFc,
          paid_at: paidAt,
          payment_mode: paymentData.payment_mode || 'cash'
        });
        
        // Créer opération sync pour la dette mise à jour
        const updatedDebt = this.findById(debtId);
        this.createSyncOperation(updatedDebt, 'upsert');
        
        return updatedDebt;
      } catch (error) {
        logger.error('❌ [Debts] Erreur addPayment:', error);
        throw error;
      }
    });
    
    return transaction();
  }
  
  /**
   * Récupère les statistiques des dettes
   */
  getStats(filters = {}) {
    const db = getDb();
    try {
      let whereClause = '1=1';
      const params = [];
      
      if (filters.from_date) {
        whereClause += ' AND date(created_at) >= ?';
        params.push(filters.from_date.substring(0, 10));
      }
      
      if (filters.to_date) {
        whereClause += ' AND date(created_at) <= ?';
        params.push(filters.to_date.substring(0, 10));
      }
      
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total_debts,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_debts,
          SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial_debts,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_debts,
          COALESCE(SUM(total_usd), 0) as total_amount_usd,
          COALESCE(SUM(paid_usd), 0) as total_paid_usd,
          COALESCE(SUM(remaining_usd), 0) as total_remaining_usd,
          COALESCE(SUM(total_fc), 0) as total_amount_fc,
          COALESCE(SUM(paid_fc), 0) as total_paid_fc,
          COALESCE(SUM(remaining_fc), 0) as total_remaining_fc
        FROM debts
        WHERE ${whereClause}
      `).get(...params);
      
      return stats;
    } catch (error) {
      logger.error('Erreur getStats debts:', error);
      return null;
    }
  }
  
  /**
   * Construit la description des produits
   */
  _buildProductDescription(items) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return null;
    }
    
    return items.map(item => {
      const qty = item.qty || 1;
      const name = item.product_name || item.product_code || 'Produit';
      return `${qty}x ${name}`;
    }).join(', ');
  }
  
  /**
   * Crée les items de dette dans la table dédiée
   */
  _createDebtItems(debtId, items) {
    const db = getDb();
    
    try {
      const stmt = db.prepare(`
        INSERT INTO debt_items (
          uuid, debt_id, product_uuid, product_code, product_name,
          unit_level, unit_mark, qty,
          unit_price_usd, line_total_usd, unit_price_fc, line_total_fc
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const item of items) {
        stmt.run(
          generateUUID(),
          debtId,
          item.product_uuid || null,
          item.product_code || '',
          item.product_name || '',
          item.unit_level || null,
          item.unit_mark || null,
          item.qty || 1,
          item.unit_price_usd || 0,
          item.subtotal_usd || item.line_total_usd || 0,
          item.unit_price_fc || 0,
          item.subtotal_fc || item.line_total_fc || 0
        );
      }
      
      logger.info(`   ✅ ${items.length} item(s) de dette créé(s)`);
    } catch (error) {
      // Table peut ne pas exister encore, pas grave
      logger.warn(`   ⚠️ Impossible de créer debt_items: ${error.message}`);
    }
  }
  
  /**
   * Crée le paiement initial lors de la création de dette
   */
  _createInitialPayment(debtId, debtUuid, paymentData) {
    const db = getDb();
    const paymentUuid = generateUUID();
    
    try {
      db.prepare(`
        INSERT INTO debt_payments (
          uuid, debt_id, amount_fc, amount_usd, rate_fc_per_usd,
          payment_mode, paid_by, note, paid_at, device_id
        )
        VALUES (?, ?, ?, ?, ?, 'cash', ?, 'Paiement initial', datetime('now'), ?)
      `).run(
        paymentUuid,
        debtId,
        paymentData.amount_fc,
        paymentData.amount_usd,
        paymentData.rate_fc_per_usd,
        paymentData.paid_by,
        paymentData.device_id
      );
      
      logger.info(`   ✅ Paiement initial créé: ${paymentData.amount_usd} USD`);
    } catch (error) {
      logger.warn(`   ⚠️ Erreur création paiement initial: ${error.message}`);
    }
  }
  
  /**
   * Crée une opération sync pour la dette
   */
  createSyncOperation(debt, opType = 'upsert') {
    const db = getDb();
    try {
      const opId = generateUUID();
      
      const payload = {
        uuid: debt.uuid,
        invoice_number: debt.invoice_number,
        client_name: debt.client_name,
        client_phone: debt.client_phone,
        client_uuid: debt.client_uuid,
        product_description: debt.product_description,
        total_usd: debt.total_usd,
        paid_usd: debt.paid_usd,
        remaining_usd: debt.remaining_usd,
        total_fc: debt.total_fc,
        paid_fc: debt.paid_fc,
        remaining_fc: debt.remaining_fc,
        debt_fc_in_usd: debt.debt_fc_in_usd,
        status: debt.status,
        note: debt.note,
        created_at: debt.created_at,
        updated_at: debt.updated_at
      };
      
      db.prepare(`
        INSERT OR IGNORE INTO sync_operations (
          op_id, op_type, entity_uuid, entity_code, payload_json, status
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        opId,
        'DEBT',
        debt.uuid,
        debt.invoice_number,
        JSON.stringify(payload),
        'pending'
      );
      
      logger.debug(`   📤 [SYNC] Opération DEBT créée: ${opId.substring(0, 8)}...`);
    } catch (error) {
      logger.warn(`   ⚠️ [SYNC] Erreur sync debt: ${error.message}`);
    }
  }
  
  /**
   * Crée une opération sync pour un paiement
   */
  createPaymentSyncOperation(paymentUuid, payload) {
    const db = getDb();
    try {
      const opId = generateUUID();
      
      db.prepare(`
        INSERT OR IGNORE INTO sync_operations (
          op_id, op_type, entity_uuid, entity_code, payload_json, status
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        opId,
        'DEBT_PAYMENT',
        paymentUuid,
        payload.invoice_number,
        JSON.stringify(payload),
        'pending'
      );
      
      logger.debug(`   📤 [SYNC] Opération DEBT_PAYMENT créée: ${opId.substring(0, 8)}...`);
    } catch (error) {
      logger.warn(`   ⚠️ [SYNC] Erreur sync payment: ${error.message}`);
    }
  }

  /**
   * Supprime les dettes vides (sans client ou sans montant)
   * @returns {Object} { deleted: number }
   */
  cleanupEmptyDebts() {
    const db = getDb();
    try {
      // D'abord lister pour logger
      const emptyDebts = db.prepare(`
        SELECT id, client_name, total_fc, total_usd, invoice_number FROM debts 
        WHERE (client_name IS NULL OR client_name = '' OR TRIM(client_name) = '')
           OR (COALESCE(total_fc, 0) <= 0 AND COALESCE(total_usd, 0) <= 0)
      `).all();
      
      logger.info(`🗑️ [Debts] Nettoyage: ${emptyDebts.length} dette(s) vide(s) trouvée(s)`);
      emptyDebts.forEach(d => {
        logger.info(`   - ID ${d.id}: client='${d.client_name}', total_fc=${d.total_fc}, invoice=${d.invoice_number}`);
      });
      
      // Supprimer
      const result = db.prepare(`
        DELETE FROM debts 
        WHERE (client_name IS NULL OR client_name = '' OR TRIM(client_name) = '')
           OR (COALESCE(total_fc, 0) <= 0 AND COALESCE(total_usd, 0) <= 0)
      `).run();
      
      // Aussi supprimer les opérations sync associées
      db.prepare(`
        DELETE FROM sync_operations 
        WHERE op_type = 'DEBT' AND status = 'pending'
        AND (
          payload_json LIKE '%"Client":""%'
          OR payload_json LIKE '%"client_name":""%'
          OR (payload_json LIKE '%"total_usd":0%' AND payload_json LIKE '%"total_fc":0%')
        )
      `).run();
      
      logger.info(`✅ [Debts] ${result.changes} dette(s) vide(s) supprimée(s)`);
      return { deleted: result.changes };
    } catch (error) {
      logger.error(`❌ [Debts] Erreur cleanupEmptyDebts:`, error);
      throw error;
    }
  }
}

export const debtsRepo = new DebtsRepository();
