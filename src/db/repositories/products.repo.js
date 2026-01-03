import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';
import { ratesRepo } from './rates.repo.js';

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
   * IMPORTANT: sale_price_fc est TOUJOURS calculé depuis sale_price_usd * taux
   */
  findAll() {
    const db = getDb();
    try {
      // Récupérer le taux actuel pour calculer FC depuis USD
      const currentRate = ratesRepo.getCurrent();
      
      const products = db
        .prepare(`
          SELECT p.*, 
                 GROUP_CONCAT(
                   json_object(
                     'id', pu.id,
                     'uuid', pu.uuid,
                     'unit_level', pu.unit_level,
                     'unit_mark', pu.unit_mark,
                     'stock_initial', pu.stock_initial,
                     'stock_current', pu.stock_current,
                     'purchase_price_usd', pu.purchase_price_usd,
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
        .map((row) => {
          const units = row.units ? JSON.parse(`[${row.units}]`) : [];
          // Calculer sale_price_fc depuis sale_price_usd pour chaque unité
          const unitsWithCalculatedFC = units.map(unit => ({
            ...unit,
            sale_price_fc: unit.sale_price_usd ? Math.round(unit.sale_price_usd * currentRate) : 0
          }));
          return {
            ...row,
            units: unitsWithCalculatedFC,
          };
        });
      
      logger.info(`📊 findAll products: ${products.length} produit(s) trouvé(s) dans la base`);
      return products;
    } catch (error) {
      logger.error('Erreur findAll products:', error);
      throw error;
    }
  }

  /**
   * Trouve un produit par code
   * IMPORTANT: sale_price_fc est TOUJOURS calculé depuis sale_price_usd * taux
   */
  findByCode(code) {
    const db = getDb();
    try {
      // Récupérer le taux actuel pour calculer FC depuis USD
      const currentRate = ratesRepo.getCurrent();
      
      const product = db
        .prepare('SELECT * FROM products WHERE code = ? AND is_active = 1')
        .get(code);

      if (!product) return null;

      const units = db
        .prepare('SELECT * FROM product_units WHERE product_id = ?')
        .all(product.id)
        .map(unit => ({
          ...unit,
          // Calculer sale_price_fc depuis sale_price_usd
          sale_price_fc: unit.sale_price_usd ? Math.round(unit.sale_price_usd * currentRate) : 0
        }));

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
        // IMPORTANT: sale_price_fc est TOUJOURS calculé depuis sale_price_usd * taux
        // On ignore sale_price_fc venant de Sheets ou de l'input
        if (productData.units && Array.isArray(productData.units)) {
          logger.debug(`   📦 Traitement de ${productData.units.length} unité(s)...`);
          
          // Récupérer le taux actuel pour calculer FC depuis USD
          const currentRate = ratesRepo.getCurrent();
          
          // Helpers pour normalisation
          const normLevel = (v) => (v ?? 'PIECE').trim().toUpperCase();
          const normMark = (v) => (v ?? '').trim().toUpperCase();

          let unitIndex = 0;
          for (const unit of productData.units) {
            unitIndex++;
            
            const unitLevel = normLevel(unit.unit_level);
            let unitMark = normMark(unit.unit_mark);
            
            // ✅ MARK: stratégie flexible (PRO pattern avec uuid stable)
            // Le mark n'est JAMAIS obligatoire - c'est un attribut modifiable
            // L'identification se fait par UUID (immuable) ou (product_id, unit_level)
            // Fallback pour compatibilité: MILLIER -> MILLIER, PIECE -> PCE
            if (!unitMark) {
              if (unitLevel === 'MILLIER') unitMark = 'MILLIER';
              else if (unitLevel === 'PIECE') unitMark = 'PCE';
              else unitMark = ''; // CARTON (ou autre) => mark vide autorisé
            }
            
            // ✅ 1) Identifier l'unité existante par UUID d'abord (identité stable pour sync)
            // UUID est l'identité stable: si fourni, on cherche TOUJOURS par uuid
            // Sinon on cherche par ID (fallback), sinon on cherche par (level+mark)
            let dbUnit = null;
            
            // PRIORITÉ 1: UUID (identité stable pour sync offline)
            if (unit.uuid) {
              dbUnit = db.prepare(`
                SELECT id, uuid FROM product_units
                WHERE uuid = ?
              `).get(unit.uuid);
            }
            
            // FALLBACK: ID (identité stable pour cette session)
            if (!dbUnit && unit.id) {
              dbUnit = db.prepare(`
                SELECT id, uuid FROM product_units
                WHERE id = ? AND product_id = ?
              `).get(unit.id, productId);
            }
            
            // DERNIER RECOURS: Chercher par (level+mark) pour nouvelles unités sans uuid
            // ⚠️ Uniquement si pas trouvé par uuid ou id
            if (!dbUnit) {
              dbUnit = db.prepare(`
                SELECT id, uuid FROM product_units
                WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
              `).get(productId, unitLevel, unitMark);
            }
            
            // ✅ 2) UUID final: TOUJOURS utiliser celui de la DB si l'unité existe
            // ⚠️ CRITIQUE: Ne JAMAIS changer le uuid d'une unité existante (identité sync)
            // Si on trouve l'unité par id, on garde son uuid, même si le payload envoie un autre uuid
            const unitUuid = dbUnit?.uuid || unit.uuid || generateUUID();
            
            // ✅ 3) Prévenir le conflit UNIQUE(product_id, unit_level) AVANT d'écrire
            // Chercher une autre unité (uuid différent) avec le même level
            // ⚠️ IMPORTANT: le mark est MODIFIABLE, donc pas de contrôle sur mark
            const collision = db.prepare(`
              SELECT uuid FROM product_units
              WHERE product_id = ? AND unit_level = ?
                AND uuid <> ?
              LIMIT 1
            `).get(productId, unitLevel, unitUuid);
            
            if (collision) {
              const err = new Error(`Cette unité existe déjà: ${unitLevel}`);
              err.code = 'UNIT_DUPLICATE';
              throw err;
            }
            
            // ✅ 4) UPDATE-first strategy (plus robuste que ON CONFLICT)
            const salePriceUSD = Number(unit.sale_price_usd ?? 0) || 0;
            const salePriceFC = salePriceUSD ? Math.round(salePriceUSD * currentRate) : 0;
            
            logger.debug(`      ✓ Unité ${unitIndex}/${productData.units.length}: ${unitLevel}, Mark="${unitMark}", Stock=${unit.stock_current || 0}, Prix USD=${salePriceUSD}, Prix FC=${salePriceFC} (calculé)`);
            
            // ✅ Essayer UPDATE par UUID d'abord
            const updateResult = db.prepare(`
              UPDATE product_units
              SET
                unit_mark = ?,
                stock_initial = ?,
                stock_current = ?,
                purchase_price_usd = ?,
                sale_price_fc = ?,
                sale_price_usd = ?,
                auto_stock_factor = ?,
                qty_step = ?,
                extra1 = ?,
                extra2 = ?,
                last_update = ?,
                updated_at = datetime('now')
              WHERE uuid = ? AND product_id = ?
            `).run(
              unitMark,
              Number(unit.stock_initial ?? 0) || 0,
              Number(unit.stock_current ?? 0) || 0,
              Number(unit.purchase_price_usd ?? 0) || 0,
              salePriceFC,
              salePriceUSD,
              Number(unit.auto_stock_factor ?? 1) || 1,
              Number(unit.qty_step ?? 1) || 1,
              unit.extra1 ?? null,
              unit.extra2 ?? null,
              unit.last_update || new Date().toISOString(),
              unitUuid,
              productId
            );
            
            // ✅ Si UPDATE n'a pas trouvé la ligne, faire INSERT (nouvelle unité)
            if (updateResult.changes === 0) {
              db.prepare(`
                INSERT INTO product_units (
                  uuid, product_id, unit_level, unit_mark,
                  stock_initial, stock_current,
                  purchase_price_usd, sale_price_fc, sale_price_usd,
                  auto_stock_factor, qty_step, extra1, extra2, last_update, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
              `).run(
                unitUuid,
                productId,
                unitLevel,
                unitMark,
                Number(unit.stock_initial ?? 0) || 0,
                Number(unit.stock_current ?? 0) || 0,
                Number(unit.purchase_price_usd ?? 0) || 0,
                salePriceFC,
                salePriceUSD,
                Number(unit.auto_stock_factor ?? 1) || 1,
                Number(unit.qty_step ?? 1) || 1,
                unit.extra1 ?? null,
                unit.extra2 ?? null,
                unit.last_update || new Date().toISOString()
              );
            }
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

