import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

/**
 * Repository pour la gestion des paiements de dettes (Ledger)
 * Chaque paiement est traçable avec date, montant, et impact sur les statistiques du jour
 */
export class DebtPaymentsRepository {
  /**
   * Crée un paiement pour une dette
   * IMPORTANT: Le montant payé est comptabilisé dans les stats du jour de paiement
   * @param {Object} paymentData - Données du paiement
   * @returns {Object} - Paiement créé avec la dette mise à jour
   */
  create(paymentData) {
    const db = getDb();
    
    const transaction = db.transaction(() => {
      try {
        const paymentUuid = paymentData.uuid || generateUUID();
        const paidAt = paymentData.paid_at || new Date().toISOString();
        
        // Vérifier que la dette existe
        const debt = db.prepare('SELECT * FROM debts WHERE id = ?').get(paymentData.debt_id);
        if (!debt) {
          throw new Error(`Dette non trouvée: ID ${paymentData.debt_id}`);
        }
        
        // Calculer le montant en USD (devise de référence)
        const amountUsd = paymentData.amount_usd || 0;
        const amountFc = paymentData.amount_fc || 0;
        const rateUsed = paymentData.rate_fc_per_usd || 2800;
        
        // Si on reçoit FC sans USD, convertir
        const finalAmountUsd = amountUsd > 0 ? amountUsd : (amountFc / rateUsed);
        const finalAmountFc = amountFc > 0 ? amountFc : (amountUsd * rateUsed);
        
        logger.info(`💳 [DebtPayments] Création paiement:`);
        logger.info(`   Dette ID: ${paymentData.debt_id}, UUID: ${debt.uuid}`);
        logger.info(`   Montant: ${finalAmountUsd} USD / ${finalAmountFc} FC`);
        logger.info(`   Taux: ${rateUsed} FC/USD`);
        logger.info(`   Date: ${paidAt}`);
        
        // Insérer le paiement
        const result = db.prepare(`
          INSERT INTO debt_payments (
            uuid, debt_id, amount_fc, amount_usd, rate_fc_per_usd,
            payment_mode, paid_by, note, paid_at, device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          paymentUuid,
          paymentData.debt_id,
          finalAmountFc,
          finalAmountUsd,
          rateUsed,
          paymentData.payment_mode || 'cash',
          paymentData.paid_by || null,
          paymentData.note || null,
          paidAt,
          paymentData.device_id || null
        );
        
        const paymentId = result.lastInsertRowid;
        logger.info(`   ✅ Paiement créé: ID ${paymentId}`);
        
        // Mettre à jour la dette (paid_usd, remaining_usd, status)
        const newPaidUsd = (debt.paid_usd || 0) + finalAmountUsd;
        const newRemainingUsd = Math.max(0, (debt.total_usd || 0) - newPaidUsd);
        
        // Aussi mettre à jour FC pour compatibilité
        const newPaidFc = (debt.paid_fc || 0) + finalAmountFc;
        const newRemainingFc = Math.max(0, (debt.total_fc || 0) - newPaidFc);
        
        // Déterminer le nouveau statut
        let newStatus = 'open';
        if (newRemainingUsd <= 0.01) { // Considéré comme payé si reste < 0.01 USD
          newStatus = 'paid';
        } else if (newPaidUsd > 0) {
          newStatus = 'partial';
        }
        
        db.prepare(`
          UPDATE debts SET
            paid_usd = ?,
            remaining_usd = ?,
            paid_fc = ?,
            remaining_fc = ?,
            status = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(newPaidUsd, newRemainingUsd, newPaidFc, newRemainingFc, newStatus, paymentData.debt_id);
        
        logger.info(`   ✅ Dette mise à jour: paid=${newPaidUsd} USD, remaining=${newRemainingUsd} USD, status=${newStatus}`);
        
        // Créer une opération sync pour le paiement
        this.createSyncOperation(paymentId, paymentData.debt_id, {
          uuid: paymentUuid,
          debt_uuid: debt.uuid,
          invoice_number: debt.invoice_number,
          amount_usd: finalAmountUsd,
          amount_fc: finalAmountFc,
          rate_fc_per_usd: rateUsed,
          payment_mode: paymentData.payment_mode || 'cash',
          paid_at: paidAt,
          note: paymentData.note || null
        });
        
        // Retourner le paiement créé avec la dette mise à jour
        return this.findById(paymentId);
      } catch (error) {
        logger.error('❌ [DebtPayments] Erreur création paiement:', error);
        throw error;
      }
    });
    
    return transaction();
  }
  
  /**
   * Trouve un paiement par ID
   */
  findById(id) {
    const db = getDb();
    try {
      return db.prepare('SELECT * FROM debt_payments WHERE id = ?').get(id);
    } catch (error) {
      logger.error('Erreur findById payment:', error);
      throw error;
    }
  }
  
  /**
   * Trouve un paiement par UUID
   */
  findByUuid(uuid) {
    const db = getDb();
    try {
      return db.prepare('SELECT * FROM debt_payments WHERE uuid = ?').get(uuid);
    } catch (error) {
      logger.error('Erreur findByUuid payment:', error);
      throw error;
    }
  }
  
  /**
   * Liste les paiements d'une dette
   */
  findByDebtId(debtId) {
    const db = getDb();
    try {
      return db.prepare(`
        SELECT * FROM debt_payments 
        WHERE debt_id = ? 
        ORDER BY paid_at DESC
      `).all(debtId);
    } catch (error) {
      logger.error('Erreur findByDebtId payments:', error);
      throw error;
    }
  }
  
  /**
   * Liste les paiements d'un jour donné (pour statistiques)
   * @param {string} dateISO - Date au format ISO (YYYY-MM-DD ou full ISO)
   * @returns {Array} - Paiements du jour
   */
  findByDate(dateISO) {
    const db = getDb();
    try {
      // Extraire juste la date (YYYY-MM-DD)
      const dateOnly = dateISO.substring(0, 10);
      
      return db.prepare(`
        SELECT dp.*, d.client_name, d.invoice_number, d.uuid as debt_uuid
        FROM debt_payments dp
        JOIN debts d ON dp.debt_id = d.id
        WHERE date(dp.paid_at) = ?
        ORDER BY dp.paid_at DESC
      `).all(dateOnly);
    } catch (error) {
      logger.error('Erreur findByDate payments:', error);
      throw error;
    }
  }
  
  /**
   * Calcule le total des paiements d'un jour (pour statistiques cash du jour)
   * @param {string} dateISO - Date au format ISO
   * @returns {Object} - { total_usd, total_fc, count }
   */
  getDayTotal(dateISO) {
    const db = getDb();
    try {
      const dateOnly = dateISO.substring(0, 10);
      
      const result = db.prepare(`
        SELECT 
          COALESCE(SUM(amount_usd), 0) as total_usd,
          COALESCE(SUM(amount_fc), 0) as total_fc,
          COUNT(*) as count
        FROM debt_payments
        WHERE date(paid_at) = ?
      `).get(dateOnly);
      
      return result || { total_usd: 0, total_fc: 0, count: 0 };
    } catch (error) {
      logger.error('Erreur getDayTotal payments:', error);
      return { total_usd: 0, total_fc: 0, count: 0 };
    }
  }
  
  /**
   * Récupère le résumé des paiements par période
   * @param {string} fromISO - Date de début
   * @param {string} toISO - Date de fin
   * @returns {Object} - Résumé avec totaux
   */
  getSummary(fromISO, toISO) {
    const db = getDb();
    try {
      const fromDate = fromISO.substring(0, 10);
      const toDate = toISO.substring(0, 10);
      
      const result = db.prepare(`
        SELECT 
          COALESCE(SUM(amount_usd), 0) as total_usd,
          COALESCE(SUM(amount_fc), 0) as total_fc,
          COUNT(*) as count,
          COUNT(DISTINCT debt_id) as debts_count
        FROM debt_payments
        WHERE date(paid_at) BETWEEN ? AND ?
      `).get(fromDate, toDate);
      
      return result || { total_usd: 0, total_fc: 0, count: 0, debts_count: 0 };
    } catch (error) {
      logger.error('Erreur getSummary payments:', error);
      return { total_usd: 0, total_fc: 0, count: 0, debts_count: 0 };
    }
  }
  
  /**
   * Crée une opération sync pour le paiement
   */
  createSyncOperation(paymentId, debtId, payload) {
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
        payload.uuid,
        payload.invoice_number,
        JSON.stringify(payload),
        'pending'
      );
      
      logger.debug(`   📤 [SYNC] Opération DEBT_PAYMENT créée: op_id=${opId.substring(0, 8)}...`);
    } catch (error) {
      logger.warn(`   ⚠️ [SYNC] Erreur création sync payment: ${error.message}`);
    }
  }
}

export const debtPaymentsRepo = new DebtPaymentsRepository();
