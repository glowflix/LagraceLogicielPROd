import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

/**
 * Repository pour la gestion des dettes
 */
export class DebtsRepository {
  /**
   * Crée une dette depuis une vente
   */
  createFromSale(saleId, invoiceNumber) {
    const db = getDb();
    try {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
      if (!sale) {
        throw new Error('Vente non trouvée');
      }

      const debtUuid = generateUUID();
      const debtStmt = db.prepare(`
        INSERT INTO debts (
          uuid, sale_id, invoice_number, client_name, client_phone, 
          total_fc, paid_fc, remaining_fc, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const totalFC = sale.total_fc;
      const paidFC = sale.paid_fc || 0;
      const remainingFC = totalFC - paidFC;

      const result = debtStmt.run(
        debtUuid,
        saleId,
        invoiceNumber,
        sale.client_name || 'Client',
        sale.client_phone || null,
        totalFC,
        paidFC,
        remainingFC,
        remainingFC > 0 ? 'open' : 'closed'
      );

      return this.findById(result.lastInsertRowid);
    } catch (error) {
      logger.error('Erreur createFromSale debt:', error);
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

      const payments = db
        .prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY paid_at DESC')
        .all(id);

      return { ...debt, payments };
    } catch (error) {
      logger.error('Erreur findById debt:', error);
      throw error;
    }
  }

  /**
   * Liste toutes les dettes
   */
  findAll(filters = {}) {
    const db = getDb();
    try {
      let query = 'SELECT * FROM debts WHERE 1=1';
      const params = [];

      if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
      }
      
      if (filters.invoice_number) {
        query += ' AND invoice_number = ?';
        params.push(filters.invoice_number);
      }

      query += ' ORDER BY created_at DESC';

      const debts = db.prepare(query).all(...params);
      logger.debug(`📊 findAll debts: ${debts.length} dette(s) trouvée(s)`);
      return debts;
    } catch (error) {
      logger.error('Erreur findAll debts:', error);
      throw error;
    }
  }

  /**
   * Crée ou met à jour une dette
   */
  upsert(debtData) {
    const db = getDb();
    try {
      // Vérifier si la dette existe (par invoice_number ou uuid)
      let existing = null;
      if (debtData.invoice_number) {
        const debts = db.prepare('SELECT * FROM debts WHERE invoice_number = ?').all(debtData.invoice_number);
        existing = debts.length > 0 ? debts[0] : null;
      } else if (debtData.uuid) {
        existing = db.prepare('SELECT * FROM debts WHERE uuid = ?').get(debtData.uuid);
      }
      
      const debtUuid = existing?.uuid || debtData.uuid || generateUUID();
      
      if (existing) {
        // Mettre à jour
        db.prepare(`
          UPDATE debts SET
            uuid = COALESCE(?, uuid),
            client_name = ?,
            product_description = ?,
            total_fc = ?,
            paid_fc = ?,
            remaining_fc = ?,
            total_usd = ?,
            debt_fc_in_usd = ?,
            note = ?,
            status = ?,
            created_at = COALESCE(?, created_at),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          debtUuid,
          debtData.client_name || existing.client_name || '',
          debtData.product_description || existing.product_description || null,
          debtData.total_fc !== undefined ? debtData.total_fc : existing.total_fc,
          debtData.paid_fc !== undefined ? debtData.paid_fc : existing.paid_fc,
          debtData.remaining_fc !== undefined ? debtData.remaining_fc : existing.remaining_fc,
          debtData.total_usd !== undefined ? debtData.total_usd : existing.total_usd || 0,
          debtData.debt_fc_in_usd || existing.debt_fc_in_usd || null,
          debtData.note || existing.note || null,
          debtData.status || existing.status || 'open',
          debtData.created_at || existing.created_at,
          existing.id
        );
        
        logger.debug(`   ✓ Dette mise à jour: id=${existing.id}, invoice=${debtData.invoice_number || 'N/A'}`);
        return this.findById(existing.id);
      } else {
        // Créer
        const result = db.prepare(`
          INSERT INTO debts (
            uuid, invoice_number, client_name, client_phone, product_description,
            total_fc, paid_fc, remaining_fc, total_usd, debt_fc_in_usd,
            note, status, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          debtUuid,
          debtData.invoice_number || null,
          debtData.client_name || '',
          debtData.client_phone || null,
          debtData.product_description || null,
          debtData.total_fc || 0,
          debtData.paid_fc || 0,
          debtData.remaining_fc !== undefined ? debtData.remaining_fc : (debtData.total_fc || 0) - (debtData.paid_fc || 0),
          debtData.total_usd || 0,
          debtData.debt_fc_in_usd || null,
          debtData.note || null,
          debtData.status || 'open',
          debtData.created_at || new Date().toISOString()
        );
        
        logger.debug(`   + Dette créée: id=${result.lastInsertRowid}, invoice=${debtData.invoice_number || 'N/A'}`);
        return this.findById(result.lastInsertRowid);
      }
    } catch (error) {
      logger.error('Erreur upsert debt:', error);
      throw error;
    }
  }

  /**
   * Ajoute un paiement à une dette
   */
  addPayment(debtId, paymentData) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        // Ajouter le paiement
        const paymentStmt = db.prepare(`
          INSERT INTO debt_payments (debt_id, amount_fc, payment_mode, paid_by)
          VALUES (?, ?, ?, ?)
        `);

        paymentStmt.run(
          debtId,
          paymentData.amount_fc,
          paymentData.payment_mode || 'cash',
          paymentData.paid_by || null
        );

        // Mettre à jour la dette
        const debt = this.findById(debtId);
        const newPaidFC = (debt.paid_fc || 0) + paymentData.amount_fc;
        const newRemainingFC = debt.total_fc - newPaidFC;
        const newStatus = newRemainingFC <= 0 ? 'closed' : newRemainingFC < debt.total_fc ? 'partial' : 'open';

        db.prepare(`
          UPDATE debts
          SET paid_fc = ?, remaining_fc = ?, status = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(newPaidFC, newRemainingFC, newStatus, debtId);

        return this.findById(debtId);
      } catch (error) {
        logger.error('Erreur addPayment:', error);
        throw error;
      }
    });

    return transaction();
  }
}

export const debtsRepo = new DebtsRepository();

