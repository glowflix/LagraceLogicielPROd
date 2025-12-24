import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';

/**
 * Repository pour la gestion du stock
 */
export class StockRepository {
  /**
   * Récupère le stock par niveau d'unité
   */
  findByLevel(level) {
    const db = getDb();
    try {
      return db
        .prepare(`
          SELECT 
            p.code as product_code,
            p.name as product_name,
            pu.*
          FROM product_units pu
          JOIN products p ON pu.product_id = p.id
          WHERE pu.unit_level = ? AND p.is_active = 1
          ORDER BY p.name
        `)
        .all(level);
    } catch (error) {
      logger.error('Erreur findByLevel stock:', error);
      throw error;
    }
  }

  /**
   * Récupère le mark d'un produit pour une unité donnée
   */
  getMark(productCode, unitLevel, unitMark) {
    const db = getDb();
    try {
      const result = db
        .prepare(`
          SELECT pu.unit_mark
          FROM product_units pu
          JOIN products p ON pu.product_id = p.id
          WHERE p.code = ? AND pu.unit_level = ? AND pu.unit_mark = ?
        `)
        .get(productCode, unitLevel, unitMark);

      return result ? result.unit_mark : null;
    } catch (error) {
      logger.error('Erreur getMark:', error);
      return null;
    }
  }

  /**
   * Récupère les produits avec stock faible
   */
  getLowStock(limit = 10) {
    const db = getDb();
    try {
      return db
        .prepare(`
          SELECT 
            p.code,
            p.name,
            pu.unit_level,
            pu.unit_mark,
            pu.stock_current,
            pu.stock_initial
          FROM product_units pu
          JOIN products p ON pu.product_id = p.id
          WHERE p.is_active = 1
            AND pu.stock_current < (pu.stock_initial * 0.2)
          ORDER BY pu.stock_current ASC
          LIMIT ?
        `)
        .all(limit);
    } catch (error) {
      logger.error('Erreur getLowStock:', error);
      throw error;
    }
  }
}

export const stockRepo = new StockRepository();

