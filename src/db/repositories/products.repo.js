import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

/**
 * Repository pour la gestion des produits
 */
export class ProductsRepository {
  /**
   * Vérifie si la base contient des produits
   */
  hasProducts() {
    const db = getDb();
    try {
      const count = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get();
      return count.count > 0;
    } catch (error) {
      logger.error('Erreur hasProducts:', error);
      return false;
    }
  }

  /**
   * Récupère tous les produits actifs
   */
  findAll() {
    const db = getDb();
    try {
      const products = db
        .prepare(`
          SELECT p.*, 
                 GROUP_CONCAT(
                   json_object(
                     'id', pu.id,
                     'unit_level', pu.unit_level,
                     'unit_mark', pu.unit_mark,
                     'stock_initial', pu.stock_initial,
                     'stock_current', pu.stock_current,
                     'purchase_price_usd', pu.purchase_price_usd,
                     'sale_price_fc', pu.sale_price_fc,
                     'sale_price_usd', pu.sale_price_usd,
                     'auto_stock_factor', pu.auto_stock_factor,
                     'qty_step', pu.qty_step
                   )
                 ) as units
          FROM products p
          LEFT JOIN product_units pu ON p.id = pu.product_id
          WHERE p.is_active = 1
          GROUP BY p.id
        `)
        .all()
        .map((row) => ({
          ...row,
          units: row.units ? JSON.parse(`[${row.units}]`) : [],
        }));
      
      logger.info(`📊 findAll products: ${products.length} produit(s) trouvé(s) dans la base`);
      return products;
    } catch (error) {
      logger.error('Erreur findAll products:', error);
      throw error;
    }
  }

  /**
   * Trouve un produit par code
   */
  findByCode(code) {
    const db = getDb();
    try {
      const product = db
        .prepare('SELECT * FROM products WHERE code = ? AND is_active = 1')
        .get(code);

      if (!product) return null;

      const units = db
        .prepare('SELECT * FROM product_units WHERE product_id = ?')
        .all(product.id);

      return { ...product, units };
    } catch (error) {
      logger.error('Erreur findByCode:', error);
      throw error;
    }
  }

  /**
   * Crée ou met à jour un produit
   */
  upsert(productData) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        logger.debug(`🔄 Upsert produit: code="${productData.code}", name="${productData.name || 'N/A'}", units=${productData.units?.length || 0}`);
        
        // Vérifier si le produit existe
        const existing = db.prepare('SELECT id, uuid FROM products WHERE code = ?').get(productData.code);
        const productUuid = existing?.uuid || productData.uuid || generateUUID();
        
        if (existing) {
          logger.debug(`   ✓ Produit existant trouvé: id=${existing.id}, uuid=${existing.uuid}`);
        } else {
          logger.debug(`   + Nouveau produit, UUID généré: ${productUuid}`);
        }
        
        // Upsert produit
        const productStmt = db.prepare(`
          INSERT INTO products (uuid, code, name, is_active, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(code) DO UPDATE SET
            uuid = COALESCE(excluded.uuid, products.uuid),
            name = excluded.name,
            is_active = excluded.is_active,
            updated_at = datetime('now')
        `);

        const productResult = productStmt.run(
          productUuid,
          productData.code,
          productData.name || '',
          productData.is_active !== undefined ? productData.is_active : 1
        );

        const productId = existing?.id || productResult.lastInsertRowid;
        logger.debug(`   ✓ Produit enregistré: id=${productId}`);

        // Upsert unités
        if (productData.units && Array.isArray(productData.units)) {
          logger.debug(`   📦 Traitement de ${productData.units.length} unité(s)...`);
          const unitStmt = db.prepare(`
            INSERT INTO product_units (
              uuid, product_id, unit_level, unit_mark, stock_initial, stock_current,
              purchase_price_usd, sale_price_fc, sale_price_usd,
              auto_stock_factor, qty_step, extra1, extra2, last_update, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(product_id, unit_level, unit_mark) DO UPDATE SET
              uuid = COALESCE(excluded.uuid, product_units.uuid),
              stock_initial = excluded.stock_initial,
              stock_current = excluded.stock_current,
              purchase_price_usd = excluded.purchase_price_usd,
              sale_price_fc = excluded.sale_price_fc,
              sale_price_usd = excluded.sale_price_usd,
              auto_stock_factor = excluded.auto_stock_factor,
              qty_step = excluded.qty_step,
              extra1 = excluded.extra1,
              extra2 = excluded.extra2,
              last_update = excluded.last_update,
              updated_at = datetime('now')
          `);

          let unitIndex = 0;
          for (const unit of productData.units) {
            unitIndex++;
            const existingUnit = db.prepare(`
              SELECT uuid FROM product_units 
              WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
            `).get(productId, unit.unit_level || 'PIECE', unit.unit_mark || '');
            
            const unitUuid = existingUnit?.uuid || unit.uuid || generateUUID();
            
            logger.debug(`      ✓ Unité ${unitIndex}/${productData.units.length}: ${unit.unit_level || 'PIECE'}, Mark="${unit.unit_mark || ''}", Stock=${unit.stock_current || 0}, Prix=${unit.sale_price_fc || 0} FC`);
            
            unitStmt.run(
              unitUuid,
              productId,
              unit.unit_level || 'PIECE',
              unit.unit_mark || '',
              unit.stock_initial || 0,
              unit.stock_current || 0,
              unit.purchase_price_usd || 0,
              unit.sale_price_fc || 0,
              unit.sale_price_usd || 0,
              unit.auto_stock_factor || 1,
              unit.qty_step || 1,
              unit.extra1 || null,
              unit.extra2 || null,
              unit.last_update || new Date().toISOString()
            );
          }
          logger.debug(`   ✅ ${productData.units.length} unité(s) enregistrée(s) pour le produit "${productData.code}"`);
        }

        return { id: productId, uuid: productUuid, code: productData.code };
      } catch (error) {
        logger.error('Erreur upsert product:', error);
        throw error;
      }
    });

    return transaction();
  }

  /**
   * Met à jour le stock d'un produit
   */
  updateStock(productId, unitId, newStock) {
    const db = getDb();
    try {
      const stmt = db.prepare(
        'UPDATE product_units SET stock_current = ?, updated_at = datetime("now") WHERE id = ? AND product_id = ?'
      );
      const result = stmt.run(newStock, unitId, productId);
      return result.changes > 0;
    } catch (error) {
      logger.error('Erreur updateStock:', error);
      throw error;
    }
  }
}

export const productsRepo = new ProductsRepository();

