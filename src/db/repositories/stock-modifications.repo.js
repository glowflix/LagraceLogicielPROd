/**
 * Stock Modifications Repository
 * Gestion des modifications de stock pour New Arrivage
 */

import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { v4 as uuidv4 } from 'uuid';

export const stockModificationsRepo = {
  /**
   * Enregistrer une modification de stock
   * @param {Object} params
   * @returns {Object} La modification créée
   */
  record(params) {
    const db = getDb();
    const {
      product_id,
      product_uuid,
      product_code,
      product_name,
      unit_level,
      unit_mark = '',
      stock_before,
      stock_after,
      sale_price_fc = 0,
      sale_price_usd = 0,
      purchase_price_usd = 0,
      modification_type = 'manual',
      reason = null,
      modified_by = null,
      device_id = null
    } = params;

    const delta = stock_after - stock_before;
    const modification_id = uuidv4();

    try {
      const stmt = db.prepare(`
        INSERT INTO stock_modifications (
          modification_id, product_id, product_uuid, product_code, product_name,
          unit_level, unit_mark, stock_before, stock_after, delta,
          sale_price_fc, sale_price_usd, purchase_price_usd,
          modification_type, reason, modified_by, device_id,
          modified_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          datetime('now')
        )
      `);

      const result = stmt.run(
        modification_id, product_id, product_uuid, product_code, product_name,
        unit_level, unit_mark, stock_before, stock_after, delta,
        sale_price_fc, sale_price_usd, purchase_price_usd,
        modification_type, reason, modified_by, device_id
      );

      logger.info(`📦 [NEW-ARRIVAGE] Stock modifié: ${product_code}/${unit_level} ${stock_before} → ${stock_after} (delta: ${delta > 0 ? '+' : ''}${delta})`);

      return {
        id: result.lastInsertRowid,
        modification_id,
        product_code,
        unit_level,
        stock_before,
        stock_after,
        delta,
        modification_type
      };
    } catch (error) {
      logger.error('Erreur enregistrement modification stock:', error);
      throw error;
    }
  },

  /**
   * Obtenir toutes les modifications (New Arrivage)
   * @param {Object} options - Options de filtrage
   * @returns {Array}
   */
  findAll(options = {}) {
    const db = getDb();
    const {
      limit = 500,
      offset = 0,
      startDate = null,
      endDate = null,
      unitLevel = null,
      modType = null,
      showAllStock = false
    } = options;

    let query = `
      SELECT 
        sm.*,
        p.name as current_product_name,
        pu.stock_current,
        pu.sale_price_fc as current_price_fc,
        pu.sale_price_usd as current_price_usd,
        pu.purchase_price_usd as current_purchase_price,
        pu.unit_mark as current_unit_mark,
        -- Calculs
        (sm.stock_after * sm.sale_price_fc) as total_fc,
        (sm.stock_after * sm.sale_price_usd) as total_usd
      FROM stock_modifications sm
      LEFT JOIN products p ON sm.product_id = p.id
      LEFT JOIN product_units pu ON sm.product_id = pu.product_id AND sm.unit_level = pu.unit_level
      WHERE 1=1
    `;
    
    const params = [];

    if (startDate) {
      query += ` AND sm.modified_at >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND sm.modified_at <= ?`;
      params.push(endDate);
    }

    if (unitLevel) {
      query += ` AND sm.unit_level = ?`;
      params.push(unitLevel);
    }

    if (modType) {
      query += ` AND sm.modification_type = ?`;
      params.push(modType);
    }

    query += ` ORDER BY sm.modified_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      return db.prepare(query).all(...params);
    } catch (error) {
      logger.error('Erreur findAll stock_modifications:', error);
      return [];
    }
  },

  /**
   * Obtenir les statistiques de New Arrivage
   * @returns {Object}
   */
  getStats() {
    const db = getDb();
    
    try {
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total_modifications,
          COUNT(DISTINCT product_code) as total_products,
          SUM(stock_after) as total_stock,
          SUM(stock_after * sale_price_fc) as total_value_fc,
          SUM(stock_after * sale_price_usd) as total_value_usd,
          SUM(CASE WHEN unit_level = 'CARTON' THEN stock_after ELSE 0 END) as total_stock_carton,
          SUM(CASE WHEN unit_level = 'MILLIER' THEN stock_after ELSE 0 END) as total_stock_millier,
          SUM(CASE WHEN unit_level = 'PIECE' THEN stock_after ELSE 0 END) as total_stock_piece,
          SUM(stock_after * purchase_price_usd) as total_purchase_value_usd
        FROM stock_modifications
        WHERE modified_at >= datetime('now', '-30 days')
      `).get();

      return stats;
    } catch (error) {
      logger.error('Erreur getStats stock_modifications:', error);
      return {
        total_modifications: 0,
        total_products: 0,
        total_stock: 0,
        total_value_fc: 0,
        total_value_usd: 0
      };
    }
  },

  /**
   * Supprimer une modification
   * @param {number} id
   * @returns {boolean}
   */
  delete(id) {
    const db = getDb();
    
    try {
      const result = db.prepare('DELETE FROM stock_modifications WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Erreur delete stock_modification:', error);
      return false;
    }
  },

  /**
   * Supprimer toutes les modifications
   * @returns {number} Nombre de modifications supprimées
   */
  deleteAll() {
    const db = getDb();
    
    try {
      const result = db.prepare('DELETE FROM stock_modifications').run();
      logger.info(`🗑️ [NEW-ARRIVAGE] ${result.changes} modifications supprimées`);
      return result.changes;
    } catch (error) {
      logger.error('Erreur deleteAll stock_modifications:', error);
      return 0;
    }
  },

  /**
   * Nettoyer les doublons (garder seulement la dernière modification par produit/unité)
   * @returns {number} Nombre de doublons supprimés
   */
  cleanDuplicates() {
    const db = getDb();
    
    try {
      // Supprimer toutes les modifications sauf la plus récente pour chaque combinaison produit/unité
      const result = db.prepare(`
        DELETE FROM stock_modifications
        WHERE id NOT IN (
          SELECT MAX(id)
          FROM stock_modifications
          GROUP BY product_code, unit_level, unit_mark
        )
      `).run();
      
      logger.info(`🧹 [NEW-ARRIVAGE] ${result.changes} doublons nettoyés`);
      return result.changes;
    } catch (error) {
      logger.error('Erreur cleanDuplicates:', error);
      return 0;
    }
  },

  /**
   * Exporter les données pour impression A4
   * @param {Object} options
   * @returns {Array}
   */
  exportForPrint(options = {}) {
    const db = getDb();
    const { unitLevel = null, withStock = null } = options;

    let query = `
      SELECT DISTINCT
        sm.product_code as code,
        COALESCE(p.name, sm.product_name) as nom,
        sm.unit_level,
        sm.unit_mark,
        COALESCE(pu.stock_current, sm.stock_after) as stock,
        COALESCE(pu.sale_price_fc, sm.sale_price_fc) as prix_fc,
        COALESCE(pu.sale_price_usd, sm.sale_price_usd) as prix_usd,
        COALESCE(pu.purchase_price_usd, sm.purchase_price_usd) as prix_achat,
        sm.modified_at as date_modification,
        (COALESCE(pu.stock_current, sm.stock_after) * COALESCE(pu.sale_price_fc, sm.sale_price_fc)) as total_fc
      FROM stock_modifications sm
      LEFT JOIN products p ON sm.product_id = p.id
      LEFT JOIN product_units pu ON sm.product_id = pu.product_id AND sm.unit_level = pu.unit_level
      WHERE 1=1
    `;

    const params = [];

    if (unitLevel) {
      query += ` AND sm.unit_level = ?`;
      params.push(unitLevel);
    }

    if (withStock === true) {
      query += ` AND COALESCE(pu.stock_current, sm.stock_after) > 0`;
    } else if (withStock === false) {
      query += ` AND COALESCE(pu.stock_current, sm.stock_after) = 0`;
    }

    query += ` ORDER BY sm.product_code ASC`;

    try {
      return db.prepare(query).all(...params);
    } catch (error) {
      logger.error('Erreur exportForPrint:', error);
      return [];
    }
  }
};

export default stockModificationsRepo;
