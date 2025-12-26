import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

/**
 * Repository pour la gestion des ventes
 */
export class SalesRepository {
  /**
   * Crée une nouvelle vente
   */
  create(saleData) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        const saleUuid = saleData.uuid || generateUUID();
        
        // Créer la vente
        const saleStmt = db.prepare(`
          INSERT INTO sales (
            uuid, invoice_number, sold_at, client_name, client_phone, seller_name, seller_user_id,
            total_fc, total_usd, rate_fc_per_usd, payment_mode,
            paid_fc, paid_usd, status, origin, source_device
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const saleResult = saleStmt.run(
          saleUuid,
          saleData.invoice_number,
          saleData.sold_at || new Date().toISOString(),
          saleData.client_name || null,
          saleData.client_phone || null,
          saleData.seller_name || null,
          saleData.seller_user_id || null,
          saleData.total_fc || 0,
          saleData.total_usd || 0,
          saleData.rate_fc_per_usd || 2800,
          saleData.payment_mode || 'cash',
          saleData.paid_fc || 0,
          saleData.paid_usd || 0,
          saleData.status || 'paid',
          saleData.origin || 'LOCAL',
          saleData.source_device || null
        );

        const saleId = saleResult.lastInsertRowid;

        // Créer les items de vente et décrémenter le stock
        if (saleData.items && Array.isArray(saleData.items)) {
          const itemStmt = db.prepare(`
            INSERT INTO sale_items (
              uuid, sale_id, product_id, product_code, product_name,
              unit_level, unit_mark, qty, qty_label,
              unit_price_fc, subtotal_fc, unit_price_usd, subtotal_usd
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const stockStmt = db.prepare(`
            UPDATE product_units
            SET stock_current = stock_current - (? * auto_stock_factor),
                updated_at = datetime('now')
            WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
          `);

          for (const item of saleData.items) {
            const itemUuid = item.uuid || generateUUID();
            itemStmt.run(
              itemUuid,
              saleId,
              item.product_id,
              item.product_code,
              item.product_name,
              item.unit_level,
              item.unit_mark,
              item.qty,
              item.qty_label || item.qty.toString(),
              item.unit_price_fc,
              item.subtotal_fc,
              item.unit_price_usd || 0,
              item.subtotal_usd || 0
            );

            // Décrémenter le stock
            stockStmt.run(
              item.qty,
              item.product_id,
              item.unit_level,
              item.unit_mark
            );
          }
        }

        return this.findById(saleId);
      } catch (error) {
        logger.error('Erreur create sale:', error);
        throw error;
      }
    });

    return transaction();
  }

  /**
   * Trouve une vente par ID
   */
  findById(id) {
    const db = getDb();
    try {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
      if (!sale) return null;

      const items = db
        .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
        .all(id);

      return { ...sale, items };
    } catch (error) {
      logger.error('Erreur findById sale:', error);
      throw error;
    }
  }

  /**
   * Trouve une vente par numéro de facture
   */
  findByInvoice(invoiceNumber) {
    const db = getDb();
    try {
      const sale = db
        .prepare('SELECT * FROM sales WHERE invoice_number = ?')
        .get(invoiceNumber);
      if (!sale) return null;

      const items = db
        .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
        .all(sale.id);

      return { ...sale, items };
    } catch (error) {
      logger.error('Erreur findByInvoice:', error);
      throw error;
    }
  }

  /**
   * Liste les ventes avec filtres
   */
  findAll(filters = {}) {
    const db = getDb();
    try {
      let query = 'SELECT * FROM sales WHERE 1=1';
      const params = [];

      if (filters.from) {
        query += ' AND sold_at >= ?';
        params.push(filters.from);
      }

      if (filters.to) {
        query += ' AND sold_at <= ?';
        params.push(filters.to);
      }

      if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
      }

      query += ' ORDER BY sold_at DESC LIMIT 1000';

      const sales = db.prepare(query).all(...params);
      
      // Charger les items pour chaque vente
      const itemsStmt = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?');
      return sales.map(sale => {
        const items = itemsStmt.all(sale.id);
        return { ...sale, items };
      });
    } catch (error) {
      logger.error('Erreur findAll sales:', error);
      throw error;
    }
  }

  /**
   * Crée ou met à jour une vente (sans décrémenter le stock - pour synchronisation Sheets)
   * Utilisé pour synchroniser les ventes depuis Google Sheets
   */
  upsert(saleData) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        // Vérifier si la vente existe déjà
        const existing = this.findByInvoice(saleData.invoice_number);
        
        let saleId;
        let saleUuid = saleData.uuid || generateUUID();
        
        if (existing) {
          // Mise à jour
          saleId = existing.id;
          saleUuid = saleData.uuid || existing.uuid || saleUuid;
          
          // Mettre à jour la vente
          db.prepare(`
            UPDATE sales SET
              uuid = ?,
              sold_at = ?,
              client_name = ?,
              client_phone = ?,
              seller_name = ?,
              seller_user_id = ?,
              total_fc = ?,
              total_usd = ?,
              rate_fc_per_usd = ?,
              payment_mode = ?,
              paid_fc = ?,
              paid_usd = ?,
              status = ?,
              origin = ?,
              source_device = ?,
              updated_at = datetime('now')
            WHERE invoice_number = ?
          `).run(
            saleUuid,
            saleData.sold_at || existing.sold_at || new Date().toISOString(),
            saleData.client_name !== undefined ? saleData.client_name : existing.client_name,
            saleData.client_phone !== undefined ? saleData.client_phone : existing.client_phone,
            saleData.seller_name !== undefined ? saleData.seller_name : existing.seller_name,
            saleData.seller_user_id !== undefined ? saleData.seller_user_id : existing.seller_user_id,
            saleData.total_fc !== undefined ? saleData.total_fc : existing.total_fc,
            saleData.total_usd !== undefined ? saleData.total_usd : existing.total_usd,
            saleData.rate_fc_per_usd !== undefined ? saleData.rate_fc_per_usd : existing.rate_fc_per_usd,
            saleData.payment_mode !== undefined ? saleData.payment_mode : existing.payment_mode,
            saleData.paid_fc !== undefined ? saleData.paid_fc : existing.paid_fc,
            saleData.paid_usd !== undefined ? saleData.paid_usd : existing.paid_usd,
            saleData.status !== undefined ? saleData.status : existing.status,
            saleData.origin !== undefined ? saleData.origin : existing.origin,
            saleData.source_device !== undefined ? saleData.source_device : existing.source_device,
            saleData.invoice_number
          );
          
          // Supprimer les anciens items pour les recréer
          db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
        } else {
          // Création
          const saleStmt = db.prepare(`
            INSERT INTO sales (
              uuid, invoice_number, sold_at, client_name, client_phone, seller_name, seller_user_id,
              total_fc, total_usd, rate_fc_per_usd, payment_mode,
              paid_fc, paid_usd, status, origin, source_device
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          
          const saleResult = saleStmt.run(
            saleUuid,
            saleData.invoice_number,
            saleData.sold_at || new Date().toISOString(),
            saleData.client_name || null,
            saleData.client_phone || null,
            saleData.seller_name || null,
            saleData.seller_user_id || null,
            saleData.total_fc || 0,
            saleData.total_usd || 0,
            saleData.rate_fc_per_usd || 2800,
            saleData.payment_mode || 'cash',
            saleData.paid_fc || 0,
            saleData.paid_usd || 0,
            saleData.status || 'paid',
            saleData.origin || 'SHEETS',
            saleData.source_device || null
          );
          
          saleId = saleResult.lastInsertRowid;
        }
        
        // Créer les items de vente (SANS décrémenter le stock)
        if (saleData.items && Array.isArray(saleData.items)) {
          const itemStmt = db.prepare(`
            INSERT INTO sale_items (
              uuid, sale_id, product_id, product_code, product_name,
              unit_level, unit_mark, qty, qty_label,
              unit_price_fc, subtotal_fc, unit_price_usd, subtotal_usd
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          
          for (const item of saleData.items) {
            const itemUuid = item.uuid || generateUUID();
            itemStmt.run(
              itemUuid,
              saleId,
              item.product_id || null,
              item.product_code || '',
              item.product_name || '',
              item.unit_level || 'PIECE',
              item.unit_mark || '',
              item.qty || 0,
              item.qty_label || (item.qty ? item.qty.toString() : '0'),
              item.unit_price_fc || 0,
              item.subtotal_fc || 0,
              item.unit_price_usd || 0,
              item.subtotal_usd || 0
            );
          }
        }
        
        return this.findById(saleId);
      } catch (error) {
        logger.error('Erreur upsert sale:', error);
        throw error;
      }
    });
    
    return transaction();
  }

  /**
   * Annule une vente (void)
   */
  voidSale(invoiceNumber, reason, voidedBy) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        // Récupérer la vente
        const sale = this.findByInvoice(invoiceNumber);
        if (!sale || sale.status === 'void') {
          throw new Error('Vente non trouvée ou déjà annulée');
        }

        // Créer l'enregistrement de void
        db.prepare(`
          INSERT INTO sale_voids (sale_id, invoice_number, reason, voided_by)
          VALUES (?, ?, ?, ?)
        `).run(sale.id, invoiceNumber, reason || null, voidedBy || null);

        // Marquer la vente comme void
        db.prepare('UPDATE sales SET status = "void", updated_at = datetime("now") WHERE id = ?').run(sale.id);

        // Restaurer le stock
        if (sale.items) {
          const stockStmt = db.prepare(`
            UPDATE product_units
            SET stock_current = stock_current + (? * auto_stock_factor),
                updated_at = datetime('now')
            WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
          `);

          for (const item of sale.items) {
            stockStmt.run(
              item.qty,
              item.product_id,
              item.unit_level,
              item.unit_mark
            );
          }
        }

        return this.findById(sale.id);
      } catch (error) {
        logger.error('Erreur voidSale:', error);
        throw error;
      }
    });

    return transaction();
  }
}

export const salesRepo = new SalesRepository();

