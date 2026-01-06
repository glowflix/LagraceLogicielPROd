/**
 * Améliorations de la synchronisation pour le module Dettes
 * 
 * Ce module ajoute le support pour:
 * 1. Push des dettes vers Google Sheets (feuille "Dettes")
 * 2. Push des paiements de dettes (feuille "Dettes_Paiements" ou mise à jour "Dettes")
 * 3. Push des clients (feuille "Clients" ou "Users")
 * 4. Routing intelligent: vente normale → "Ventes", vente dette → "Dettes"
 */

import { syncLogger } from '../../core/logger.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { sheetsClient } from './sheets.client.js';
import { generateUUID } from '../../core/crypto.js';

/**
 * Classe pour gérer la synchronisation avancée des dettes
 */
export class DebtsSyncManager {
  /**
   * Push les dettes vers Google Sheets
   * @param {Array} debtOps - Opérations DEBT à pousser
   */
  async pushDebts(debtOps) {
    if (!debtOps || debtOps.length === 0) {
      syncLogger.debug('   📭 [DEBTS-PUSH] Aucune dette à envoyer');
      return { success: true, pushed: 0 };
    }
    
    syncLogger.info(`   📤 [DEBTS-PUSH] ${debtOps.length} dette(s) à envoyer vers Sheets`);
    
    const ackedOpIds = [];
    const errors = [];
    
    try {
      // Construire les opérations batch
      const ops = debtOps.map((op) => {
        const payload = this._parsePayload(op);
        
        return {
          op_id: op.op_id,
          entity: 'debts',
          op: 'upsert',
          payload: {
            uuid: payload.uuid || op.entity_uuid,
            invoice_number: payload.invoice_number || op.entity_code,
            client_name: payload.client_name || '',
            client_phone: payload.client_phone || null,
            client_uuid: payload.client_uuid || null,
            product_description: payload.product_description || null,
            // USD (référence)
            total_usd: payload.total_usd || 0,
            paid_usd: payload.paid_usd || 0,
            remaining_usd: payload.remaining_usd || 0,
            // FC (affichage)
            total_fc: payload.total_fc || 0,
            paid_fc: payload.paid_fc || 0,
            remaining_fc: payload.remaining_fc || 0,
            debt_fc_in_usd: payload.debt_fc_in_usd || null,
            // Métadonnées
            status: payload.status || 'open',
            note: payload.note || null,
            created_at: payload.created_at || null,
            updated_at: payload.updated_at || null
          }
        };
      });
      
      syncLogger.info(`      📦 [DEBTS-PUSH] Envoi batch de ${ops.length} opération(s)`);
      
      // Envoyer via batchPush
      const result = await sheetsClient.pushBatch(ops, { timeout: 15000 });
      
      if (result.success || result.applied) {
        ackedOpIds.push(...debtOps.map(op => op.op_id));
        syncLogger.info(`      ✅ [DEBTS-PUSH] ${debtOps.length} dette(s) envoyée(s) avec succès`);
      } else {
        errors.push(result.error || 'Erreur inconnue');
        // Marquer en erreur
        for (const op of debtOps) {
          outboxRepo.markAsError(op.op_id, result.error || 'Erreur push dettes');
        }
        syncLogger.warn(`      ⚠️ [DEBTS-PUSH] Erreur: ${result.error}`);
      }
    } catch (error) {
      errors.push(error.message);
      // Marquer en erreur
      for (const op of debtOps) {
        outboxRepo.markAsError(op.op_id, error.message);
      }
      syncLogger.error(`      ❌ [DEBTS-PUSH] Exception: ${error.message}`);
    }
    
    // Marquer les opérations réussies
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
    
    return {
      success: errors.length === 0,
      pushed: ackedOpIds.length,
      errors
    };
  }
  
  /**
   * Push les paiements de dettes vers Google Sheets
   * @param {Array} paymentOps - Opérations DEBT_PAYMENT à pousser
   */
  async pushDebtPayments(paymentOps) {
    if (!paymentOps || paymentOps.length === 0) {
      syncLogger.debug('   📭 [PAYMENTS-PUSH] Aucun paiement à envoyer');
      return { success: true, pushed: 0 };
    }
    
    syncLogger.info(`   📤 [PAYMENTS-PUSH] ${paymentOps.length} paiement(s) à envoyer`);
    
    const ackedOpIds = [];
    const errors = [];
    
    try {
      // Construire les opérations batch
      const ops = paymentOps.map((op) => {
        const payload = this._parsePayload(op);
        
        return {
          op_id: op.op_id,
          entity: 'debt_payments',
          op: 'insert',
          payload: {
            uuid: payload.uuid || op.entity_uuid,
            debt_uuid: payload.debt_uuid,
            invoice_number: payload.invoice_number || op.entity_code,
            client_name: payload.client_name || null,
            amount_usd: payload.amount_usd || 0,
            amount_fc: payload.amount_fc || 0,
            rate_fc_per_usd: payload.rate_fc_per_usd || 2800,
            payment_mode: payload.payment_mode || 'cash',
            paid_at: payload.paid_at || new Date().toISOString(),
            note: payload.note || null
          }
        };
      });
      
      syncLogger.info(`      📦 [PAYMENTS-PUSH] Envoi batch de ${ops.length} paiement(s)`);
      
      // Envoyer
      const result = await sheetsClient.pushBatch(ops, { timeout: 15000 });
      
      if (result.success || result.applied) {
        ackedOpIds.push(...paymentOps.map(op => op.op_id));
        syncLogger.info(`      ✅ [PAYMENTS-PUSH] ${paymentOps.length} paiement(s) envoyé(s)`);
      } else {
        errors.push(result.error || 'Erreur inconnue');
        for (const op of paymentOps) {
          outboxRepo.markAsError(op.op_id, result.error || 'Erreur push payments');
        }
        syncLogger.warn(`      ⚠️ [PAYMENTS-PUSH] Erreur: ${result.error}`);
      }
    } catch (error) {
      errors.push(error.message);
      for (const op of paymentOps) {
        outboxRepo.markAsError(op.op_id, error.message);
      }
      syncLogger.error(`      ❌ [PAYMENTS-PUSH] Exception: ${error.message}`);
    }
    
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
    
    return {
      success: errors.length === 0,
      pushed: ackedOpIds.length,
      errors
    };
  }
  
  /**
   * Push les clients vers Google Sheets
   * @param {Array} clientOps - Opérations CLIENT à pousser
   */
  async pushClients(clientOps) {
    if (!clientOps || clientOps.length === 0) {
      syncLogger.debug('   📭 [CLIENTS-PUSH] Aucun client à envoyer');
      return { success: true, pushed: 0 };
    }
    
    syncLogger.info(`   📤 [CLIENTS-PUSH] ${clientOps.length} client(s) à envoyer`);
    
    const ackedOpIds = [];
    const errors = [];
    
    try {
      const ops = clientOps.map((op) => {
        const payload = this._parsePayload(op);
        
        return {
          op_id: op.op_id,
          entity: 'clients',
          op: 'upsert',
          payload: {
            uuid: payload.uuid || op.entity_uuid,
            client_code: payload.client_code || op.entity_code,
            name: payload.name || '',
            phone: payload.phone || null,
            email: payload.email || null,
            address: payload.address || null,
            is_active: payload.is_active !== undefined ? payload.is_active : 1
          }
        };
      });
      
      const result = await sheetsClient.pushBatch(ops, { timeout: 15000 });
      
      if (result.success || result.applied) {
        ackedOpIds.push(...clientOps.map(op => op.op_id));
        syncLogger.info(`      ✅ [CLIENTS-PUSH] ${clientOps.length} client(s) envoyé(s)`);
      } else {
        errors.push(result.error || 'Erreur inconnue');
        for (const op of clientOps) {
          outboxRepo.markAsError(op.op_id, result.error || 'Erreur push clients');
        }
      }
    } catch (error) {
      errors.push(error.message);
      for (const op of clientOps) {
        outboxRepo.markAsError(op.op_id, error.message);
      }
      syncLogger.error(`      ❌ [CLIENTS-PUSH] Exception: ${error.message}`);
    }
    
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
    
    return {
      success: errors.length === 0,
      pushed: ackedOpIds.length,
      errors
    };
  }
  
  /**
   * Exécute toutes les synchronisations liées aux dettes
   */
  async syncAll() {
    syncLogger.info(`🔄 [DEBTS-SYNC] Synchronisation complète dettes/paiements/clients`);
    
    const results = {
      debts: { success: true, pushed: 0 },
      payments: { success: true, pushed: 0 },
      clients: { success: true, pushed: 0 }
    };
    
    try {
      // 1. Push des dettes
      const debtOps = outboxRepo.getPendingOperations('DEBT', 50);
      if (debtOps.length > 0) {
        results.debts = await this.pushDebts(debtOps);
      }
      
      // 2. Push des paiements de dettes
      const paymentOps = outboxRepo.getPendingOperations('DEBT_PAYMENT', 50);
      if (paymentOps.length > 0) {
        results.payments = await this.pushDebtPayments(paymentOps);
      }
      
      // 3. Push des clients
      const clientOps = outboxRepo.getPendingOperations('CLIENT', 50);
      if (clientOps.length > 0) {
        results.clients = await this.pushClients(clientOps);
      }
      
      const totalPushed = results.debts.pushed + results.payments.pushed + results.clients.pushed;
      
      if (totalPushed > 0) {
        syncLogger.info(`✅ [DEBTS-SYNC] Total: ${totalPushed} opération(s) synchronisée(s)`);
        syncLogger.info(`   Dettes: ${results.debts.pushed}, Paiements: ${results.payments.pushed}, Clients: ${results.clients.pushed}`);
      } else {
        syncLogger.debug(`   [DEBTS-SYNC] Aucune opération en attente`);
      }
      
      return results;
    } catch (error) {
      syncLogger.error(`❌ [DEBTS-SYNC] Erreur globale: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Parse le payload d'une opération
   */
  _parsePayload(op) {
    if (op.payload && typeof op.payload === 'object') {
      return op.payload;
    }
    
    if (op.payload_json && typeof op.payload_json === 'string') {
      try {
        return JSON.parse(op.payload_json);
      } catch (e) {
        syncLogger.warn(`⚠️ [PARSE] Erreur JSON pour op_id=${op.op_id}: ${e.message}`);
        return {};
      }
    }
    
    if (op.payload_json && typeof op.payload_json === 'object') {
      return op.payload_json;
    }
    
    return {};
  }
}

export const debtsSyncManager = new DebtsSyncManager();
