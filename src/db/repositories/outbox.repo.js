import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

/**
 * Repository pour la gestion de l'Outbox PRO avec idempotence
 * 
 * Fonctionnalités:
 * - Opérations avec op_id UUID pour idempotence (évite doublons Sheets)
 * - Déduplication des patches produit (last-write-wins)
 * - Mouvements de stock par deltas (jamais valeur absolue)
 * - Sync par lots avec acknowledgment
 */
export class OutboxRepository {
  /**
   * Obtient ou génère un device_id unique pour ce device
   */
  getDeviceId() {
    const db = getDb();
    try {
      const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('device_id');
      if (setting && setting.value) {
        return setting.value;
      }
      
      // Générer un nouveau device_id
      const deviceId = `device-${generateUUID().substring(0, 8)}`;
      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run('device_id', deviceId);
      
      logger.info(`📱 Device ID généré: ${deviceId}`);
      return deviceId;
    } catch (error) {
      logger.error('Erreur getDeviceId:', error);
      return `device-${Date.now()}`;
    }
  }

  // ========================================
  // PRODUCT PATCHES (Déduplication last-write-wins)
  // ========================================

  /**
   * Enqueue un patch produit avec déduplication
   * Si un patch pending existe pour ce produit, il est fusionné (last-write-wins)
   * 
   * @param {string} entityUuid - UUID du produit
   * @param {string} entityCode - Code du produit
   * @param {object} patch - Champs modifiés { name?, mark?, price?, etc. }
   * @returns {string} op_id de l'opération
   */
  enqueueProductPatch(entityUuid, entityCode, patch) {
    const db = getDb();
    try {
      // Vérifier s'il existe déjà un patch pending pour ce produit
      const existing = db.prepare(`
        SELECT id, op_id, payload_json
        FROM sync_operations
        WHERE entity_uuid = ?
          AND op_type = 'PRODUCT_PATCH'
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(entityUuid);

      if (existing) {
        // Fusionner avec le patch existant (last-write-wins)
        const existingPayload = JSON.parse(existing.payload_json);
        const mergedPayload = { ...existingPayload, ...patch };
        
        db.prepare(`
          UPDATE sync_operations
          SET payload_json = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(JSON.stringify(mergedPayload), existing.id);

        logger.debug(`🔄 [OUTBOX] Patch produit fusionné: ${entityCode} (${existing.op_id})`);
        return existing.op_id;
      }

      // Créer une nouvelle opération
      const opId = generateUUID();
      const deviceId = this.getDeviceId();
      const patchJson = JSON.stringify(patch);

      db.prepare(`
        INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
        VALUES (?, 'PRODUCT_PATCH', ?, ?, ?, ?, 'pending')
      `).run(opId, entityUuid, entityCode, patchJson, deviceId);

      logger.info(`📦 [OUTBOX-INSERT] PRODUCT_PATCH: code='${entityCode}', uuid='${entityUuid}', op_id='${opId}'`);
      logger.info(`   Payload: ${patchJson}`);
      logger.info(`   Status: pending, Device: ${deviceId}`);
      logger.debug(`📦 [OUTBOX] Patch produit enqueued: ${entityCode} (${opId})`);
      return opId;
    } catch (error) {
      logger.error('Erreur enqueueProductPatch:', error);
      throw error;
    }
  }

  /**
   * Enqueue un patch d'unité produit avec déduplication
   * 
   * @param {string} productUuid - UUID du produit
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité (CARTON, MILLIER, PIECE)
   * @param {string} unitMark - Mark de l'unité
   * @param {object} patch - Champs modifiés { sale_price_usd?, purchase_price_usd?, etc. }
   * @returns {string} op_id de l'opération
   */
  enqueueUnitPatch(productUuid, productCode, unitLevel, unitMark, patch) {
    const db = getDb();
    try {
      // Entity UUID pour l'unité = productUuid-unitLevel-unitMark
      const unitEntityUuid = `${productUuid}-${unitLevel}-${unitMark || ''}`;

      // Vérifier s'il existe déjà un patch pending pour cette unité
      const existing = db.prepare(`
        SELECT id, op_id, payload_json
        FROM sync_operations
        WHERE entity_uuid = ?
          AND op_type = 'UNIT_PATCH'
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(unitEntityUuid);

      if (existing) {
        // Fusionner (last-write-wins)
        const existingPayload = JSON.parse(existing.payload_json);
        const mergedPayload = { ...existingPayload, ...patch };
        
        db.prepare(`
          UPDATE sync_operations
          SET payload_json = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(JSON.stringify(mergedPayload), existing.id);

        logger.debug(`🔄 [OUTBOX] Patch unité fusionné: ${productCode}/${unitLevel}/${unitMark}`);
        return existing.op_id;
      }

      // Créer une nouvelle opération
      const opId = generateUUID();
      const deviceId = this.getDeviceId();
      const fullPayload = {
        product_uuid: productUuid,
        product_code: productCode,
        unit_level: unitLevel,
        unit_mark: unitMark || '',
        ...patch
      };

      db.prepare(`
        INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
        VALUES (?, 'UNIT_PATCH', ?, ?, ?, ?, 'pending')
      `).run(opId, unitEntityUuid, productCode, JSON.stringify(fullPayload), deviceId);

      logger.debug(`📦 [OUTBOX] Patch unité enqueued: ${productCode}/${unitLevel}/${unitMark}`);
      return opId;
    } catch (error) {
      logger.error('Erreur enqueueUnitPatch:', error);
      throw error;
    }
  }

  // ========================================
  // STOCK MOVES (Deltas, jamais valeur absolue)
  // ========================================

  /**
   * Enqueue un mouvement de stock (delta)
   * IMPORTANT: Ne jamais envoyer de valeur absolue, seulement des deltas
   * 
   * @param {string} productUuid - UUID du produit
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité
   * @param {string} unitMark - Mark de l'unité
   * @param {number} delta - Mouvement (+50, -3, etc.)
   * @param {string} reason - adjustment|sale|void|inventory|correction
   * @param {string} referenceId - UUID de la vente, ajustement, etc.
   * @returns {string} move_id du mouvement
   */
  enqueueStockMove(productUuid, productCode, unitLevel, unitMark, delta, reason, referenceId = null) {
    const db = getDb();
    try {
      const moveId = generateUUID();
      const deviceId = this.getDeviceId();

      // Récupérer le stock actuel pour traçabilité
      const currentStock = db.prepare(`
        SELECT pu.stock_current
        FROM product_units pu
        JOIN products p ON pu.product_id = p.id
        WHERE p.uuid = ? AND pu.unit_level = ? AND pu.unit_mark = ?
      `).get(productUuid, unitLevel, unitMark || '');

      const stockBefore = currentStock?.stock_current || 0;
      const stockAfter = stockBefore + delta;

      // Insérer dans stock_moves
      db.prepare(`
        INSERT INTO stock_moves (
          move_id, product_uuid, product_code, unit_level, unit_mark,
          delta, reason, reference_id, stock_before, stock_after, device_id, synced
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        moveId, productUuid, productCode, unitLevel, unitMark || '',
        delta, reason, referenceId, stockBefore, stockAfter, deviceId
      );

      // Créer aussi une opération sync pour le batch push
      const opId = generateUUID();
      const payload = {
        move_id: moveId,
        product_uuid: productUuid,
        product_code: productCode,
        unit_level: unitLevel,
        unit_mark: unitMark || '',
        delta,
        reason,
        reference_id: referenceId,
        stock_before: stockBefore,
        stock_after: stockAfter
      };

      db.prepare(`
        INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
        VALUES (?, 'STOCK_MOVE', ?, ?, ?, ?, 'pending')
      `).run(opId, productUuid, productCode, JSON.stringify(payload), deviceId);

      logger.info(`📊 [STOCK] Mouvement enregistré: ${productCode}/${unitLevel} ${delta > 0 ? '+' : ''}${delta} (${reason})`);
      return moveId;
    } catch (error) {
      logger.error('Erreur enqueueStockMove:', error);
      throw error;
    }
  }

  /**
   * Applique un mouvement de stock localement (met à jour stock_current)
   * IMPORTANT: Cette fonction doit être appelée APRÈS enqueueStockMove si on veut que le stock local soit mis à jour
   * 
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité
   * @param {string} unitMark - Mark de l'unité
   * @param {number} delta - Mouvement
   * @returns {boolean} true si succès
   */
  applyStockMoveLocally(productCode, unitLevel, unitMark, delta) {
    const db = getDb();
    try {
      const result = db.prepare(`
        UPDATE product_units
        SET stock_initial = stock_initial + ?,
            stock_current = stock_current + ?,
            updated_at = datetime('now'),
            last_update = datetime('now')
        WHERE product_id = (SELECT id FROM products WHERE code = ?)
          AND unit_level = ?
          AND unit_mark = ?
      `).run(delta, delta, productCode, unitLevel, unitMark || '');

      return result.changes > 0;
    } catch (error) {
      logger.error('Erreur applyStockMoveLocally:', error);
      return false;
    }
  }

  // ========================================
  // SALES (Ventes avec mouvements de stock implicites)
  // ========================================

  /**
   * Enqueue une vente (la vente génère automatiquement des STOCK_MOVE négatifs)
   * 
   * @param {object} sale - Données de la vente
   * @param {array} items - Lignes de vente
   * @returns {string} op_id de l'opération
   */
  enqueueSale(sale, items) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        const opId = generateUUID();
        const deviceId = this.getDeviceId();
        const payload = { sale, items };

        // Enqueue l'opération de vente
        db.prepare(`
          INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
          VALUES (?, 'SALE', ?, ?, ?, ?, 'pending')
        `).run(opId, sale.uuid, sale.invoice_number, JSON.stringify(payload), deviceId);

        // IMPORTANT: Les mouvements de stock sont gérés par les triggers SQL
        // Pas besoin de créer des STOCK_MOVE séparés ici car les triggers font déjà le travail
        // Mais on enregistre quand même les mouvements pour le push vers Sheets

        for (const item of items) {
          // Récupérer l'UUID du produit
          const product = db.prepare('SELECT uuid FROM products WHERE code = ?').get(item.product_code);
          if (product) {
            // Le stock a déjà été décrémenté par le trigger trg_sale_items_stock_decrease_ai
            // On enregistre juste le mouvement pour la sync (sans appliquer localement)
            const moveId = generateUUID();
            const stockMove = db.prepare(`
              SELECT pu.stock_current
              FROM product_units pu
              JOIN products p ON pu.product_id = p.id
              WHERE p.code = ? AND pu.unit_level = ? AND pu.unit_mark = ?
            `).get(item.product_code, item.unit_level, item.unit_mark || '');

            // Note: stock_after est APRÈS le trigger, donc c'est la valeur actuelle
            const stockAfter = stockMove?.stock_current || 0;
            const stockBefore = stockAfter + item.qty; // Avant la vente

            db.prepare(`
              INSERT INTO stock_moves (
                move_id, product_uuid, product_code, unit_level, unit_mark,
                delta, reason, reference_id, stock_before, stock_after, device_id, synced
              )
              VALUES (?, ?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, 0)
            `).run(
              moveId, product.uuid, item.product_code, item.unit_level, item.unit_mark || '',
              -item.qty, sale.uuid, stockBefore, stockAfter, deviceId
            );
          }
        }

        logger.info(`💰 [OUTBOX] Vente enqueued: ${sale.invoice_number} (${opId})`);
        return opId;
      } catch (error) {
        logger.error('Erreur enqueueSale:', error);
        throw error;
      }
    });

    return transaction();
  }

  // ========================================
  // BATCH OPERATIONS (Récupération et acknowledgment)
  // ========================================

  /**
   * Récupère les opérations pending par type
   * 
   * @param {string} opType - Type d'opération (PRODUCT_PATCH, STOCK_MOVE, SALE, etc.) ou null pour tous
   * @param {number} limit - Nombre max d'opérations
   * @returns {array} Opérations pending
   */
  getPendingOperations(opType = null, limit = 200) {
    const db = getDb();
    try {
      let query = `
        SELECT * FROM sync_operations
        WHERE status = 'pending'
      `;
      const params = [];

      if (opType) {
        query += ' AND op_type = ?';
        params.push(opType);
      }

      query += ' ORDER BY created_at ASC LIMIT ?';
      params.push(limit);

      return db.prepare(query).all(...params).map(row => ({
        ...row,
        payload: JSON.parse(row.payload_json)
      }));
    } catch (error) {
      logger.error('Erreur getPendingOperations:', error);
      return [];
    }
  }

  /**
   * Récupère les mouvements de stock pending
   * 
   * @param {number} limit - Nombre max
   * @returns {array} Mouvements pending
   */
  getPendingStockMoves(limit = 200) {
    const db = getDb();
    try {
      return db.prepare(`
        SELECT * FROM stock_moves
        WHERE synced = 0
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit);
    } catch (error) {
      logger.error('Erreur getPendingStockMoves:', error);
      return [];
    }
  }

  /**
   * Marque une opération comme envoyée
   * 
   * @param {string} opId - UUID de l'opération
   */
  markAsSent(opId) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE sync_operations
        SET status = 'sent',
            sent_at = datetime('now'),
            updated_at = datetime('now')
        WHERE op_id = ?
      `).run(opId);
    } catch (error) {
      logger.error('Erreur markAsSent:', error);
    }
  }

  /**
   * Marque plusieurs opérations comme acknowledged (confirmées par Sheets)
   * 
   * @param {array} opIds - Liste des op_id confirmés
   */
  markAsAcked(opIds) {
    const db = getDb();
    try {
      const transaction = db.transaction(() => {
        const stmt = db.prepare(`
          UPDATE sync_operations
          SET status = 'acked',
              acked_at = datetime('now'),
              updated_at = datetime('now')
          WHERE op_id = ?
        `);

        for (const opId of opIds) {
          stmt.run(opId);
        }
      });

      transaction();
      logger.info(`✅ [OUTBOX] ${opIds.length} opération(s) confirmée(s)`);
    } catch (error) {
      logger.error('Erreur markAsAcked:', error);
    }
  }

  /**
   * Marque les mouvements de stock comme synchronisés
   * 
   * @param {array} moveIds - Liste des move_id confirmés
   */
  markStockMovesSynced(moveIds) {
    const db = getDb();
    try {
      const transaction = db.transaction(() => {
        const stmt = db.prepare(`
          UPDATE stock_moves
          SET synced = 1,
              synced_at = datetime('now')
          WHERE move_id = ?
        `);

        for (const moveId of moveIds) {
          stmt.run(moveId);
        }
      });

      transaction();
      logger.info(`✅ [STOCK] ${moveIds.length} mouvement(s) synchronisé(s)`);
    } catch (error) {
      logger.error('Erreur markStockMovesSynced:', error);
    }
  }

  /**
   * Marque une opération comme erreur
   * 
   * @param {string} opId - UUID de l'opération
   * @param {string} errorMessage - Message d'erreur
   */
  markAsError(opId, errorMessage) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE sync_operations
        SET status = 'error',
            tries = tries + 1,
            last_error = ?,
            updated_at = datetime('now')
        WHERE op_id = ?
      `).run(errorMessage, opId);
    } catch (error) {
      logger.error('Erreur markAsError:', error);
    }
  }

  /**
   * Réessaye les opérations en erreur (max 3 tentatives)
   */
  retryErrorOperations() {
    const db = getDb();
    try {
      const result = db.prepare(`
        UPDATE sync_operations
        SET status = 'pending',
            updated_at = datetime('now')
        WHERE status = 'error' AND tries < 3
      `).run();

      if (result.changes > 0) {
        logger.info(`🔄 [OUTBOX] ${result.changes} opération(s) remise(s) en pending`);
      }
      return result.changes;
    } catch (error) {
      logger.error('Erreur retryErrorOperations:', error);
      return 0;
    }
  }

  // ========================================
  // PROTECTION: Vérification pending avant écrasement
  // ========================================

  /**
   * Vérifie si un produit a des opérations pending (ne pas écraser)
   * 
   * @param {string} productCode - Code du produit
   * @returns {boolean} true si des opérations pending existent
   */
  hasProductPending(productCode) {
    const db = getDb();
    try {
      const pending = db.prepare(`
        SELECT COUNT(*) as count
        FROM sync_operations
        WHERE entity_code = ?
          AND status = 'pending'
          AND op_type IN ('PRODUCT_PATCH', 'UNIT_PATCH', 'STOCK_MOVE')
      `).get(productCode);

      return pending.count > 0;
    } catch (error) {
      logger.error('Erreur hasProductPending:', error);
      return false;
    }
  }

  /**
   * Vérifie si une unité a des mouvements de stock pending
   * IMPORTANT: Si des mouvements pending existent, ne PAS écraser le stock
   * 
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité
   * @param {string} unitMark - Mark de l'unité
   * @returns {boolean} true si des mouvements pending existent
   */
  hasStockMovePending(productCode, unitLevel, unitMark = '') {
    const db = getDb();
    try {
      const pending = db.prepare(`
        SELECT COUNT(*) as count
        FROM stock_moves
        WHERE product_code = ?
          AND unit_level = ?
          AND unit_mark = ?
          AND synced = 0
      `).get(productCode, unitLevel, unitMark);

      return pending.count > 0;
    } catch (error) {
      logger.error('Erreur hasStockMovePending:', error);
      return false;
    }
  }

  /**
   * Récupère le total des deltas pending pour une unité
   * (pour calculer le stock correct lors du pull)
   * 
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité
   * @param {string} unitMark - Mark de l'unité
   * @returns {number} Total des deltas pending
   */
  getPendingStockDelta(productCode, unitLevel, unitMark = '') {
    const db = getDb();
    try {
      const result = db.prepare(`
        SELECT COALESCE(SUM(delta), 0) as total_delta
        FROM stock_moves
        WHERE product_code = ?
          AND unit_level = ?
          AND unit_mark = ?
          AND synced = 0
      `).get(productCode, unitLevel, unitMark);

      return result?.total_delta || 0;
    } catch (error) {
      logger.error('Erreur getPendingStockDelta:', error);
      return 0;
    }
  }

  // ========================================
  // STATISTIQUES
  // ========================================

  /**
   * Récupère les statistiques de l'outbox
   */
  getStats() {
    const db = getDb();
    try {
      const pending = db.prepare(`
        SELECT op_type, COUNT(*) as count
        FROM sync_operations
        WHERE status = 'pending'
        GROUP BY op_type
      `).all();

      const errors = db.prepare(`
        SELECT COUNT(*) as count FROM sync_operations WHERE status = 'error'
      `).get();

      const stockMovesPending = db.prepare(`
        SELECT COUNT(*) as count FROM stock_moves WHERE synced = 0
      `).get();

      const lastAcked = db.prepare(`
        SELECT acked_at FROM sync_operations WHERE status = 'acked' ORDER BY acked_at DESC LIMIT 1
      `).get();

      return {
        pendingByType: pending.reduce((acc, row) => {
          acc[row.op_type] = row.count;
          return acc;
        }, {}),
        totalPending: pending.reduce((sum, row) => sum + row.count, 0),
        errors: errors?.count || 0,
        stockMovesPending: stockMovesPending?.count || 0,
        lastAcked: lastAcked?.acked_at || null
      };
    } catch (error) {
      logger.error('Erreur getStats:', error);
      return { pendingByType: {}, totalPending: 0, errors: 0, stockMovesPending: 0, lastAcked: null };
    }
  }
}

export const outboxRepo = new OutboxRepository();

