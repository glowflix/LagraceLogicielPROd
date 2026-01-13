import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';
import { normalizeUnit } from '../../core/qty-rules.js';
import { outboxRepo } from './outbox.repo.js';

/**
 * Repository pour la gestion des ventes
 */
export class SalesRepository {
  /**
   * Crée une nouvelle vente
   */
  create(saleData) {
    const db = getDb();
    
    // Logs de démarrage supprimés pour optimisation
    
    // Vérification origin silencieuse
    
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
              unit_level, unit_mark, product_unit_uuid, qty, qty_label,
              unit_price_fc, subtotal_fc, unit_price_usd, subtotal_usd
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          // CRITIQUE: Le stock est réduit automatiquement par le TRIGGER SQL
          // Le trigger trg_sale_items_stock_decrease_ai réduit stock_initial ET stock_current
          // Ne PAS réduire manuellement ici pour éviter la double réduction
          // Le trigger vérifie automatiquement que origin != 'SHEETS'

          for (let itemIdx = 0; itemIdx < saleData.items.length; itemIdx++) {
            const item = saleData.items[itemIdx];
            const itemUuid = item.uuid || generateUUID();
            
            // CRITIQUE: Normaliser la quantité une dernière fois pour s'assurer de la précision
            // Gérer tous les formats: 0.5, 0,5, 0.50, 0,50, 1, 1.0, etc.
            let qty = item.qty;
            if (typeof qty === 'string') {
              // Remplacer toutes les virgules par des points
              qty = parseFloat(qty.replace(/,/g, '.')) || 0;
            }
            qty = Number(qty) || 0;
            qty = Math.round(qty * 100) / 100; // Arrondir à 2 décimales
            
            // Vérification de sécurité: la quantité doit être > 0
            if (qty <= 0) {
              continue; // Ignorer cet item si quantité invalide
            }
            
            // Normaliser unit_level pour correspondre à la base de données (CARTON, MILLIER, PIECE)
            const unitNorm = normalizeUnit(item.unit_level);
            let unitLevelForDb;
            if (unitNorm === 'carton') {
              unitLevelForDb = 'CARTON';
            } else if (unitNorm === 'milliers') {
              unitLevelForDb = 'MILLIER'; // Note: base de données utilise MILLIER (singulier)
            } else if (unitNorm === 'piece') {
              unitLevelForDb = 'PIECE';
            } else {
              // Utiliser tel quel si déjà en majuscules
              unitLevelForDb = (item.unit_level || '').toString().toUpperCase();
              // Normaliser MILLIERS → MILLIER
              if (unitLevelForDb === 'MILLIERS') {
                unitLevelForDb = 'MILLIER';
              }
            }
            
            // Récupérer l'unité et son UUID (RÉFÉRENCE STABLE pour les triggers)
            const productUnit = db.prepare(`
              SELECT id, uuid FROM product_units
              WHERE product_id = ? AND unit_level = ?
              LIMIT 1
            `).get(item.product_id, unitLevelForDb);
            
            if (!productUnit) {
              continue;
            }
            
            const productUnitUuid = productUnit.uuid;
            
            const stockBefore = db.prepare(`
              SELECT stock_initial, stock_current FROM product_units
              WHERE id = ?
            `).get(productUnit.id);
            
            const stockBeforeInitial = stockBefore?.stock_initial || 0;
            const stockBeforeCurrent = stockBefore?.stock_current || 0;
            
            itemStmt.run(
              itemUuid,
              saleId,
              item.product_id,
              item.product_code,
              item.product_name,
              unitLevelForDb, // Utiliser la version normalisée
              item.unit_mark || '',
              productUnitUuid, // ✅ RÉFÉRENCE STABLE à l'unité (uuid)
              qty,
              item.qty_label || qty.toString(),
              item.unit_price_fc,
              item.subtotal_fc,
              item.unit_price_usd || 0,
              item.subtotal_usd || 0
            );
            
            // CRITIQUE: Le stock est réduit automatiquement par le TRIGGER SQL après l'insertion
            // Vérifier que la réduction a bien eu lieu (après l'insertion)
            if (qty > 0) {
              // Récupérer le nouveau stock pour confirmation (par uuid, identifiant stable)
              const updatedUnit = db.prepare(`
                SELECT stock_initial, stock_current FROM product_units
                WHERE uuid = ?
              `).get(productUnitUuid);
              
              if (updatedUnit) {
                const stockAfterInitial = updatedUnit.stock_initial || 0;
                const stockAfterCurrent = updatedUnit.stock_current || 0;
                
                // Vérification de cohérence: le stock devrait être réduit exactement de qty par le trigger
                const expectedInitial = stockBeforeInitial - qty;
                const expectedCurrent = stockBeforeCurrent - qty;
                const diffInitial = Math.abs(stockAfterInitial - expectedInitial);
                const diffCurrent = Math.abs(stockAfterCurrent - expectedCurrent);
                
                if (diffInitial > 0.01 || diffCurrent > 0.01) {
                  logger.error(`❌ [sales.repo] Stock mal réduit: ${item.product_code} (${unitLevelForDb})`);
                }
              }
            }
          }
        }

        const createdSale = this.findById(saleId);
        
        // ✅ PRO: Créer des opérations STOCK_MOVE pour chaque item vendu
        // Cela permet de synchroniser la réduction de stock vers Sheets
        if (createdSale && createdSale.items && createdSale.items.length > 0) {
          try {
            const deviceId = saleData.source_device || process.env.DEVICE_ID || 'POS-SALE';
            
            for (const item of createdSale.items) {
              // Récupérer le stock final de ce produit/unité
              const finalUnit = db.prepare(`
                SELECT uuid, stock_current FROM product_units
                WHERE product_id = ? AND unit_level = ?
                LIMIT 1
              `).get(item.product_id, item.unit_level);
              
              if (!finalUnit) continue;
              
              // Créer une opération STOCK_MOVE avec stock_absolute
              // stock_absolute = valeur finale du stock (idempotent!)
              const movePayload = {
                product_code: item.product_code,
                unit_level: item.unit_level,
                unit_mark: item.unit_mark || '',
                stock_absolute: Math.round(finalUnit.stock_current * 100) / 100,
                invoice_number: saleData.invoice_number,
                device_id: deviceId,
                reason: 'SALE'
              };
              
              try {
                outboxRepo.createSyncOperation('STOCK_MOVE', item.product_code, movePayload, deviceId);
              } catch (syncErr) {
                logger.warn(`[SALES] Impossible de créer opération sync pour ${item.product_code}: ${syncErr.message}`);
              }
            }
          } catch (err) {
            logger.warn(`[SALES] Erreur lors de la création des opérations stock: ${err.message}`);
            // Non-bloquant: continuer même si sync échoue
          }
        }
        
        return createdSale;
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
   * @param {Object} filters - Filtres de recherche
   * @param {string} filters.from - Date de début (ISO)
   * @param {string} filters.to - Date de fin (ISO)
   * @param {string} filters.status - Filtrer par statut exact
   * @param {string} filters.exclude_status - Exclure un statut (ex: 'pending')
   */
  findAll(filters = {}) {
    const db = getDb();
    try {
      // ✅ IMPORTANT: Exclure les ventes marquées comme supprimées
      let query = `
        SELECT s.* FROM sales s
        LEFT JOIN deleted_sales ds ON s.invoice_number = ds.invoice_number
        WHERE 1=1 AND ds.id IS NULL
      `;
      const params = [];

      if (filters.from) {
        query += ' AND s.sold_at >= ?';
        params.push(filters.from);
      }

      if (filters.to) {
        query += ' AND s.sold_at <= ?';
        params.push(filters.to);
      }

      if (filters.status) {
        query += ' AND s.status = ?';
        params.push(filters.status);
      }

      // IMPORTANT: Exclure les ventes avec un statut spécifique (ex: 'pending')
      if (filters.exclude_status) {
        query += ' AND s.status != ?';
        params.push(filters.exclude_status);
      }

      query += ' ORDER BY s.sold_at DESC LIMIT 1000';

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
   * IMPORTANT: Cette méthode NE RÉDUIT PAS le stock car les ventes depuis Sheets
   * ont déjà été comptabilisées dans le stock lors de leur création dans Sheets.
   */
  upsert(saleData) {
    const db = getDb();
    
    const transaction = db.transaction(() => {
      try {
        // ✅ CRITIQUE: Forcer origin = 'SHEETS' pour les ventes de synchronisation
        // Cela empêche le trigger de réduire le stock (le trigger vérifie origin != 'SHEETS')
        const origin = saleData.origin || 'SHEETS';
        
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
            origin,                          // ✅ Utiliser origin forcé
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
            origin,                          // ✅ Utiliser origin forcé à 'SHEETS'
            saleData.source_device || null
          );
          
          saleId = saleResult.lastInsertRowid;
        }
        
        // Créer les items de vente (SANS décrémenter le stock)
        if (saleData.items && Array.isArray(saleData.items)) {
          const itemStmt = db.prepare(`
            INSERT INTO sale_items (
              uuid, sale_id, product_id, product_code, product_name,
              unit_level, unit_mark, product_unit_uuid, qty, qty_label,
              unit_price_fc, subtotal_fc, unit_price_usd, subtotal_usd
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          
          // Vérifier les UUIDs existants pour éviter les doublons
          // CRITIQUE: Utiliser '' (guillemets simples) au lieu de "" pour les chaînes vides en SQL
          const existingUuidsStmt = db.prepare("SELECT uuid FROM sale_items WHERE uuid IS NOT NULL AND uuid != ''");
          const existingUuids = new Set(
            existingUuidsStmt.all().map(row => row.uuid).filter(Boolean)
          );
          
          // CRITIQUE: Set pour suivre les UUIDs utilisés dans cette transaction (évite doublons dans la même facture)
          const uuidsInThisTransaction = new Set();
          
          // Requête pour trouver le product_id si non fourni
          const findProductStmt = db.prepare('SELECT id FROM products WHERE code = ? AND is_active = 1 LIMIT 1');
          
          // Logs détaillés désactivés pour performance (utiliser logger.debug si besoin)
          
          saleData.items.forEach((item, itemIdx) => {
            // Logs détaillés désactivés pour performance
            
            // CRITIQUE: Générer UUID unique si non fourni, s'il existe déjà en DB, OU s'il est déjà utilisé dans cette transaction
            let itemUuid = item.uuid;
            if (!itemUuid || existingUuids.has(itemUuid) || uuidsInThisTransaction.has(itemUuid)) {
              // Générer un nouveau UUID jusqu'à ce qu'il soit unique (dans DB ET dans cette transaction)
              do {
                itemUuid = generateUUID();
              } while (existingUuids.has(itemUuid) || uuidsInThisTransaction.has(itemUuid));
              // UUID dupliqué ou manquant détecté, nouveau UUID généré
            }
            // Ajouter l'UUID au Set de cette transaction pour éviter les doublons dans les items suivants
            uuidsInThisTransaction.add(itemUuid);
            existingUuids.add(itemUuid); // Aussi ajouter au Set global pour éviter conflits futurs
            
            // Normaliser unit_level pour correspondre à la base de données
            let unitLevel = item.unit_level || 'PIECE';
            const unitNorm = normalizeUnit(unitLevel);
            if (unitNorm === 'carton') {
              unitLevel = 'CARTON';
            } else if (unitNorm === 'milliers') {
              unitLevel = 'MILLIER'; // Base de données utilise MILLIER (singulier)
            } else if (unitNorm === 'piece') {
              unitLevel = 'PIECE';
            } else {
              // Utiliser tel quel si déjà en majuscules
              unitLevel = (unitLevel || 'PIECE').toString().toUpperCase();
            }
            // Unité normalisée
            
            // Trouver product_id et product_unit_uuid si non fournis
            let productId = item.product_id;
            let productUnitUuid = null;
            
            if (!productId && item.product_code) {
              const product = findProductStmt.get(item.product_code);
              if (product) {
                productId = product.id;
              } else {
                logger.warn(`⚠️ Produit non trouvé pour code: ${item.product_code} - item sera créé sans product_id`);
              }
            }
            
            // ✅ Récupérer l'UUID de l'unité (RÉFÉRENCE STABLE)
            if (productId) {
              const productUnit = db.prepare(`
                SELECT uuid FROM product_units
                WHERE product_id = ? AND unit_level = ?
                LIMIT 1
              `).get(productId, unitLevel);
              if (productUnit) {
                productUnitUuid = productUnit.uuid;
              } else {
                logger.warn(`⚠️ Unité "${unitLevel}" non trouvée pour le produit`);
              }
            }
            
            // Normaliser la quantité
            let qty = Number(item.qty) || 0;
            qty = Math.round(qty * 100) / 100; // Arrondir à 2 décimales
            
            try {
              itemStmt.run(
                itemUuid,
                saleId,
                productId || null,
                item.product_code || '',
                item.product_name || '',
                unitLevel,
                (item.unit_mark || '').trim(),
                productUnitUuid, // ✅ RÉFÉRENCE STABLE à l'unité (uuid)
                qty,
                item.qty_label || (qty ? qty.toString() : '0'),
                item.unit_price_fc || 0,
                item.subtotal_fc || 0,
                item.unit_price_usd || 0,
                item.subtotal_usd || 0
              );
              
              // Item inséré dans sale_items (stock NON réduit)
            } catch (itemError) {
              // Si erreur d'unité inconnue, essayer de créer l'unité manquante pour les ventes SHEETS
              if (itemError.message && itemError.message.includes('Unité inconnue') && saleData.origin === 'SHEETS' && productId) {
                logger.warn(`⚠️ Unité "${unitLevel}/${item.unit_mark || ''}" non trouvée pour produit ${item.product_code}, tentative de création...`);
                try {
                  // Créer l'unité manquante pour permettre la synchronisation
                  const createUnitStmt = db.prepare(`
                    INSERT OR IGNORE INTO product_units (
                      uuid, product_id, unit_level, unit_mark, stock_initial, stock_current,
                      purchase_price_usd, sale_price_fc, sale_price_usd,
                      auto_stock_factor, qty_step, updated_at
                    )
                    VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, 1, 0.25, datetime('now'))
                  `);
                  const unitUuid = generateUUID();
                  const unitPriceFC = item.unit_price_fc || 0;
                  const unitPriceUSD = item.unit_price_usd || 0;
                  createUnitStmt.run(
                    unitUuid,
                    productId,
                    unitLevel,
                    (item.unit_mark || '').trim(),
                    unitPriceFC,
                    unitPriceUSD
                  );
                  
                  // ✅ Récupérer l'UUID de l'unité créée
                  const createdUnit = db.prepare(`
                    SELECT uuid FROM product_units
                    WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
                    LIMIT 1
                  `).get(productId, unitLevel, (item.unit_mark || '').trim());
                  const productUnitUuid2 = createdUnit?.uuid || unitUuid;
                  
                  // ✅ Réessai de l'insertion avec tous les 14 paramètres dans le bon ordre
                  itemStmt.run(
                    itemUuid,
                    saleId,
                    productId,
                    item.product_code || '',
                    item.product_name || '',
                    unitLevel,
                    (item.unit_mark || '').trim(),
                    productUnitUuid2,                 // ✅ product_unit_uuid au bon endroit (8e paramètre)
                    qty,
                    item.qty_label || (qty ? qty.toString() : '0'),
                    item.unit_price_fc || 0,
                    item.subtotal_fc || 0,
                    item.unit_price_usd || 0,
                    item.subtotal_usd || 0
                  );
                  // Item inséré avec succès après création de l'unité
                } catch (createUnitError) {
                  logger.error(`❌ Impossible de créer l'unité manquante: ${createUnitError.message}`);
                  throw itemError; // Re-lancer l'erreur originale
                }
              } else {
                throw itemError; // Re-lancer l'erreur si ce n'est pas une erreur d'unité
              }
            }
          }); // Fin du forEach
          
          // Tous les items créés SANS réduction de stock
        }
        
        const createdSale = this.findById(saleId);
        
        return createdSale;
      } catch (error) {
        logger.error('❌ [sales.repo] Erreur upsert sale:', error);
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

        // CRITIQUE: Restaurer le stock (stock_initial ET stock_current)
        // Le stock a été réduit par le trigger lors de la création de la vente
        // On restaure exactement la quantité vendue (sans auto_stock_factor car le trigger ne l'utilise pas)
        if (sale.items) {
          const stockStmt = db.prepare(`
            UPDATE product_units
            SET stock_initial = stock_initial + ?,
                stock_current = stock_current + ?,
                updated_at = datetime('now')
            WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
          `);

          // Restauration du stock
          for (const item of sale.items) {
            const qty = Number(item.qty) || 0;
            stockStmt.run(
              qty, // Pour stock_initial
              qty, // Pour stock_current
              item.product_id,
              item.unit_level,
              item.unit_mark
            );
          }
          // Stock restauré pour tous les items
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

