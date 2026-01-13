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
  // PRODUCT DELETED (Suppression produit)
  // ========================================

  /**
   * ✅ PRO: Enqueue une suppression de produit
   * Crée une opération PRODUCT_DELETED pour synchroniser avec Sheets
   * 
   * @param {string} productUuid - UUID du produit
   * @param {string} productCode - Code du produit
   * @param {object} options - Options supplémentaires { deleted_at?, name? }
   * @returns {string} op_id de l'opération
   */
  enqueueProductDeleted(productUuid, productCode, options = {}) {
    const db = getDb();
    try {
      const opId = generateUUID();
      const deviceId = this.getDeviceId();
      
      const payload = {
        product_uuid: productUuid,
        product_code: productCode,
        product_name: options.name || null,
        deleted_at: options.deleted_at || new Date().toISOString(),
        device_id: deviceId
      };

      // ✅ Supprimer les anciennes opérations pending pour ce produit (évite doublons)
      db.prepare(`
        DELETE FROM sync_operations 
        WHERE entity_code = ? 
          AND op_type IN ('PRODUCT_PATCH', 'PRODUCT_DELETED')
          AND status = 'pending'
      `).run(productCode);

      db.prepare(`
        INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
        VALUES (?, 'PRODUCT_DELETED', ?, ?, ?, ?, 'pending')
      `).run(opId, productUuid || productCode, productCode, JSON.stringify(payload), deviceId);

      logger.info(`🗑️ [OUTBOX] PRODUCT_DELETED enqueued: code='${productCode}', uuid='${productUuid}', op_id='${opId}'`);
      
      return opId;
    } catch (error) {
      logger.error('Erreur enqueueProductDeleted:', error);
      throw error;
    }
  }

  // ========================================
  // STOCK MOVES (Deltas, jamais valeur absolue)
  // ========================================

  /**
   * Enqueue un mouvement de stock (delta)
   * IMPORTANT: Ne jamais envoyer de valeur absolue, seulement des deltas
   * ✅ FIX: Déduplication last-write-wins avec entity_uuid par unité (CARTON/PIECE différenciés)
   * 
   * @param {string} productUuid - UUID du produit
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité
   * @param {string} unitMark - Mark de l'unité
   * @param {number} delta - Mouvement (+50, -3, etc.)
   * @param {string} reason - adjustment|sale|void|inventory|correction|sale_deleted
   * @param {string} referenceId - UUID de la vente, ajustement, etc.
   * @returns {object} { op_id, move_id } - op_id pour sync, move_id pour journal
   */
  enqueueStockMove(productUuid, productCode, unitLevel, unitMark, delta, reason, referenceId = null) {
    const db = getDb();
    try {
      // ✅ PRO: Normaliser unit_level
      let unitLevelNorm = (unitLevel || '').toString().toUpperCase();
      if (unitLevelNorm === 'MILLIERS') unitLevelNorm = 'MILLIER';

      // ✅ FIX: entity_uuid par unité pour vraie déduplication last-write-wins
      const stockEntityUuid = `${productUuid}-${unitLevelNorm}-${unitMark || ''}`;

      // ✅ DÉDUPLICATION: Vérifier si opération STOCK_MOVE pending existe pour cette unité
      const existing = db.prepare(`
        SELECT id, op_id, payload_json
        FROM sync_operations
        WHERE entity_uuid = ?
          AND op_type = 'STOCK_MOVE'
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(stockEntityUuid);

      // Récupérer le stock actuel pour traçabilité (stock_current pour la valeur réelle)
      const currentStock = db.prepare(`
        SELECT pu.stock_current
        FROM product_units pu
        JOIN products p ON pu.product_id = p.id
        WHERE p.uuid = ? AND pu.unit_level = ? AND pu.unit_mark = ?
      `).get(productUuid, unitLevelNorm, unitMark || '');

      const stockBefore = currentStock?.stock_current || 0;
      const stockAfter = stockBefore + delta;

      // ✅ FIX: Utiliser stock_current (pas stock_initial) pour stock_absolute
      const moveId = generateUUID();
      const payload = {
        move_id: moveId,
        product_uuid: productUuid,
        product_code: String(productCode).trim(),
        unit_level: unitLevelNorm,
        unit_mark: unitMark || '',
        // ✅ FIX: stock_absolute basé sur stock_current (valeur réelle actuelle)
        stock_absolute: Math.round(stockAfter * 100) / 100,
        delta,
        reason,
        reference_id: referenceId,
        stock_before: stockBefore,
        stock_after: stockAfter
      };

      if (existing) {
        // ✅ DEDUP: Remplacer par la valeur finale la plus récente (last-write-wins)
        db.prepare(`
          UPDATE sync_operations
          SET payload_json = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(JSON.stringify(payload), existing.id);

        logger.info(`🔄 [OUTBOX] STOCK_MOVE dédupliqué (last-write-wins): ${productCode}/${unitLevelNorm} delta=${delta}`);
        // ✅ FIX: Retourner l'op_id existant et le move_id EXISTANT du payload
        try {
          const existingPayload = JSON.parse(existing.payload_json);
          return { op_id: existing.op_id, move_id: existingPayload.move_id };
        } catch (e) {
          return { op_id: existing.op_id, move_id: moveId }; // Fallback
        }
      }

      // Créer une nouvelle opération
      const opId = generateUUID();
      const deviceId = this.getDeviceId();

      db.prepare(`
        INSERT INTO stock_moves (
          move_id, product_uuid, product_code, unit_level, unit_mark,
          delta, reason, reference_id, stock_before, stock_after, device_id, synced
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        moveId, productUuid, String(productCode).trim(), unitLevelNorm, unitMark || '',
        delta, reason, referenceId, stockBefore, stockAfter, deviceId
      );

      db.prepare(`
        INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
        VALUES (?, 'STOCK_MOVE', ?, ?, ?, ?, 'pending')
      `).run(opId, stockEntityUuid, String(productCode).trim(), JSON.stringify(payload), deviceId);

      logger.info(`📊 [STOCK] ${productCode}/${unitLevelNorm}: ${stockBefore} → ${stockAfter} (${reason})`);
      // ✅ FIX: Retourner les deux IDs
      return { op_id: opId, move_id: moveId };
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

  /**
   * Enqueue la suppression d'une vente (SALE_DELETED) + restauration du stock
   * ✅ Crée opération pour supprimer la ligne dans Sheets + restaure le stock
   * 
   * @param {string} invoiceNumber - Numéro de facture à supprimer
   * @param {array} items - Articles vendus (pour restaurer le stock)
   * @returns {object} { saleDeletedOpId, stockMoveOpIds }
   */
  enqueueSaleDeleted(invoiceNumber, items) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        const deviceId = this.getDeviceId();
        const stockMoveOpIds = [];

        // ═══════════════════════════════════════════════════════════════════
        // 1. SALE_DELETED: Supprime la ligne dans Sheets
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70));
        console.log('🗑️ [OUTBOX] ENQUEUE SUPPRESSION VENTE + SYNC STOCK');
        console.log('═'.repeat(70));
        console.log(`   📄 Facture: ${invoiceNumber}`);
        console.log(`   📦 Items: ${items.length}`);
        console.log('═'.repeat(70));

        const saleDeletedOpId = generateUUID();
        const payload = {
          invoice_number: invoiceNumber,
          deleted_at: new Date().toISOString(),
          items_count: items.length
        };

        db.prepare(`
          INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
          VALUES (?, 'SALE_DELETED', ?, ?, ?, ?, 'pending')
        `).run(saleDeletedOpId, invoiceNumber, invoiceNumber, JSON.stringify(payload), deviceId);

        logger.info(`🗑️ [OUTBOX] SALE_DELETED enqueued: ${invoiceNumber} (op_id: ${saleDeletedOpId})`);

        // ═══════════════════════════════════════════════════════════════════
        // 2. STOCK_MOVE: Synchronise la restauration du stock vers Sheets
        //    IMPORTANT: reason='sale_deleted' pour que Code.gs sache ne pas créer de nouvelle ligne!
        // ═══════════════════════════════════════════════════════════════════
        let stockRestored = 0;
        for (const item of items) {
          // Récupérer le produit
          const product = db.prepare('SELECT id, uuid, name FROM products WHERE code = ?').get(item.product_code);
          if (!product) {
            console.log(`   ⚠️ Produit non trouvé: ${item.product_code}`);
            logger.warn(`[OUTBOX] Produit non trouvé: ${item.product_code}`);
            continue;
          }

          // Normaliser unit_level
          let unitLevelNorm = (item.unit_level || 'CARTON').toString().toUpperCase();
          if (unitLevelNorm === 'MILLIERS') unitLevelNorm = 'MILLIER';

          // Récupérer le stock actuel
          const currentStock = db.prepare(`
            SELECT pu.stock_current, pu.unit_mark
            FROM product_units pu
            WHERE pu.product_id = ? AND pu.unit_level = ?
            LIMIT 1
          `).get(product.id, unitLevelNorm);

          if (!currentStock) {
            console.log(`   ⚠️ Unité non trouvée: ${item.product_code}/${unitLevelNorm}`);
            logger.warn(`[OUTBOX] Unité non trouvée: ${item.product_code}/${unitLevelNorm}`);
            continue;
          }

          const unitMark = currentStock.unit_mark || item.unit_mark || '';
          const stockBefore = currentStock.stock_current;
          const delta = +item.qty; // POSITIF = restauration
          const stockAfter = stockBefore + delta;

          // Créer STOCK_MOVE pour le journal
          const moveId = generateUUID();
          db.prepare(`
            INSERT INTO stock_moves (
              move_id, product_uuid, product_code, unit_level, unit_mark,
              delta, reason, reference_id, stock_before, stock_after, device_id, synced
            )
            VALUES (?, ?, ?, ?, ?, ?, 'sale_deleted', ?, ?, ?, ?, 0)
          `).run(
            moveId, product.uuid, item.product_code, unitLevelNorm, unitMark,
            delta, invoiceNumber, stockBefore, stockAfter, deviceId
          );

          // Créer opération STOCK_MOVE pour Sheets
          // ✅ IMPORTANT: reason='sale_deleted' pour que Code.gs ne crée pas de nouvelle ligne!
          const stockOpId = generateUUID();
          const stockEntityUuid = `${product.uuid}-${unitLevelNorm}-${unitMark || ''}`;
          const stockPayload = {
            move_id: moveId,
            product_uuid: product.uuid,
            product_code: String(item.product_code).trim(),
            unit_level: unitLevelNorm,
            unit_mark: unitMark,
            stock_absolute: Math.round(stockAfter * 100) / 100,
            delta: delta,
            reason: 'sale_deleted',  // ✅ CRITICAL: indique à Code.gs de ne pas créer de ligne de vente
            reference_id: invoiceNumber,
            stock_before: stockBefore,
            stock_after: stockAfter
          };

          db.prepare(`
            INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
            VALUES (?, 'STOCK_MOVE', ?, ?, ?, ?, 'pending')
          `).run(stockOpId, stockEntityUuid, String(item.product_code).trim(), JSON.stringify(stockPayload), deviceId);

          stockMoveOpIds.push(stockOpId);
          stockRestored++;

          // LOG VISIBLE
          console.log(`   📦 ${item.product_code} (${product.name})`);
          console.log(`      └─ ${unitLevelNorm}: ${stockBefore} → ${stockAfter} (delta: +${delta})`);
          logger.info(`📦 [STOCK-RESTORE] ${item.product_code}/${unitLevelNorm}: ${stockBefore} → ${stockAfter} (sale_deleted)`);
        }

        console.log('─'.repeat(70));
        console.log(`✅ [OUTBOX] Suppression vente ${invoiceNumber} enqueued`);
        console.log(`   📋 SALE_DELETED: ${saleDeletedOpId.substring(0, 12)}...`);
        console.log(`   📊 STOCK_MOVE: ${stockRestored}/${items.length} articles`);
        console.log(`   ⏳ Sync vers Sheets dans ~10 secondes...`);
        console.log(`   ℹ️  Code.gs détecte reason='sale_deleted' et MAJ stock SEULEMENT`);
        console.log('═'.repeat(70) + '\n');

        logger.info(`💰 [OUTBOX] Vente supprimée: ${invoiceNumber} (${saleDeletedOpId}) - ${stockRestored} articles à restaurer`);
        
        return { saleDeletedOpId, stockMoveOpIds };
      } catch (error) {
        console.error('❌ [OUTBOX] Erreur enqueueSaleDeleted:', error.message);
        logger.error('Erreur enqueueSaleDeleted:', error);
        throw error;
      }
    });

    return transaction();
  }

  // ========================================
  // SALES (Ventes avec mouvements de stock implicites)
  // ========================================

  /**
   * Enqueue une vente (la vente génère automatiquement des STOCK_MOVE négatifs)
   * ✅ PRO: Crée les opérations STOCK_MOVE avec stock_absolute pour sync vers Sheets
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

        // ═══════════════════════════════════════════════════════════════════
        // LOG TRÈS VISIBLE DANS LE TERMINAL
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70));
        console.log('📤 [OUTBOX] ENQUEUE VENTE + STOCK_MOVE POUR SYNC SHEETS');
        console.log('═'.repeat(70));
        console.log(`   📄 Facture: ${sale.invoice_number}`);
        console.log(`   📦 Items: ${items.length}`);
        console.log('═'.repeat(70));

        // Enqueue l'opération de vente
        db.prepare(`
          INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
          VALUES (?, 'SALE', ?, ?, ?, ?, 'pending')
        `).run(opId, sale.uuid, sale.invoice_number, JSON.stringify(payload), deviceId);

        logger.info(`📤 [OUTBOX] SALE enqueued: ${sale.invoice_number} (op_id: ${opId})`);

        // IMPORTANT: Les mouvements de stock sont gérés par les triggers SQL
        // Les triggers décrémentent le stock localement, on crée les opérations 
        // STOCK_MOVE avec stock_absolute pour synchroniser vers Google Sheets

        let stockMovesCreated = 0;
        for (const item of items) {
          // Récupérer l'UUID et les infos du produit
          const product = db.prepare('SELECT id, uuid, name FROM products WHERE code = ?').get(item.product_code);
          if (!product) {
            console.log(`   ⚠️ Produit non trouvé: ${item.product_code}`);
            logger.warn(`[OUTBOX] Produit non trouvé: ${item.product_code}`);
            continue;
          }

          // Le stock a déjà été décrémenté par le trigger trg_sale_items_stock_decrease_ai
          // On enregistre le mouvement ET on crée l'opération de sync
          const moveId = generateUUID();
          
          // Normaliser unit_level pour la requête
          let unitLevelNorm = (item.unit_level || 'CARTON').toString().toUpperCase();
          if (unitLevelNorm === 'MILLIERS') unitLevelNorm = 'MILLIER';
          
          // ✅ PRO: Chercher d'abord avec mark, puis sans mark si non trouvé
          let stockMove = db.prepare(`
            SELECT pu.stock_initial, pu.stock_current, pu.unit_mark
            FROM product_units pu
            WHERE pu.product_id = ? AND pu.unit_level = ? AND pu.unit_mark = ?
          `).get(product.id, unitLevelNorm, item.unit_mark || '');

          // Si pas trouvé avec mark, chercher juste par unit_level
          if (!stockMove) {
            stockMove = db.prepare(`
              SELECT pu.stock_initial, pu.stock_current, pu.unit_mark
              FROM product_units pu
              WHERE pu.product_id = ? AND pu.unit_level = ?
              LIMIT 1
            `).get(product.id, unitLevelNorm);
          }

          if (!stockMove) {
            console.log(`   ⚠️ Unité non trouvée: ${item.product_code}/${unitLevelNorm}`);
            logger.warn(`[OUTBOX] Unité non trouvée: ${item.product_code}/${unitLevelNorm}`);
            continue;
          }

          // Note: stock_after est APRÈS le trigger, donc c'est la valeur actuelle
          const stockAfterCurrent = stockMove?.stock_current || 0;
          const stockBefore = stockAfterCurrent + item.qty; // Avant la vente
          const delta = -item.qty;
          const unitMark = stockMove?.unit_mark || item.unit_mark || '';

          // 1. Insérer dans stock_moves pour le journal
          db.prepare(`
            INSERT INTO stock_moves (
              move_id, product_uuid, product_code, unit_level, unit_mark,
              delta, reason, reference_id, stock_before, stock_after, device_id, synced
            )
            VALUES (?, ?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, 0)
          `).run(
            moveId, product.uuid, item.product_code, unitLevelNorm, unitMark,
            delta, sale.uuid, stockBefore, stockAfterCurrent, deviceId
          );

          // 2. ✅ FIX: Créer l'opération STOCK_MOVE avec stock_absolute basé sur stock_current
          const stockOpId = generateUUID();
          // ✅ FIX: entity_uuid par unité pour vraie déduplication
          const stockEntityUuid = `${product.uuid}-${unitLevelNorm}-${unitMark || ''}`;
          
          const stockPayload = {
            move_id: moveId,
            product_uuid: product.uuid,
            product_code: String(item.product_code).trim(), // Toujours string pour Sheets
            unit_level: unitLevelNorm,
            unit_mark: unitMark,
            // ✅ FIX: Utiliser stock_current (pas stock_initial) pour valeur réelle
            stock_absolute: Math.round(stockAfterCurrent * 100) / 100,
            delta: delta, // Garder delta pour le log
            reason: 'sale',
            reference_id: sale.uuid,
            stock_before: stockBefore,
            stock_after: stockAfterCurrent
          };

          db.prepare(`
            INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
            VALUES (?, 'STOCK_MOVE', ?, ?, ?, ?, 'pending')
          `).run(stockOpId, stockEntityUuid, String(item.product_code).trim(), JSON.stringify(stockPayload), deviceId);

          stockMovesCreated++;
          
          // ✅ LOG VISIBLE DANS LE TERMINAL
          console.log(`   📦 ${item.product_code} (${product.name})`);
          console.log(`      └─ ${unitLevelNorm}: ${stockBefore} → ${stockAfterCurrent} (delta: ${delta})`);
          console.log(`      └─ STOCK_MOVE pending op_id=${stockOpId} (stock_absolute: ${stockPayload.stock_absolute})`);
          
          logger.info(`📦 [STOCK-SYNC] ${item.product_code}/${unitLevelNorm}: ${stockBefore} → ${stockAfterCurrent} (pending)`);
        }

        console.log('─'.repeat(70));
        console.log(`✅ [OUTBOX] Vente ${sale.invoice_number} enqueued`);
        console.log(`   📊 STOCK_MOVE créés: ${stockMovesCreated}/${items.length}`);
        console.log(`   ⏳ Sync vers Sheets dans ~10 secondes...`);
        console.log('═'.repeat(70) + '\n');

        logger.info(`💰 [OUTBOX] Vente enqueued: ${sale.invoice_number} (${opId}) - ${stockMovesCreated} STOCK_MOVE`);
        return opId;
      } catch (error) {
        console.error('❌ [OUTBOX] Erreur enqueueSale:', error.message);
        logger.error('Erreur enqueueSale:', error);
        throw error;
      }
    });

    return transaction();
  }

  // ========================================
  // DEBTS (Dettes avec sync vers feuille "Dettes")
  // ========================================

  /**
   * Enqueue une dette pour sync vers Google Sheets (feuille "Dettes")
   * ✅ Format exact des colonnes Sheets: Client, Produit, Argent, prix a payer, prix payer deja, 
   *    reste, date, numero de facture, Dollars, objet\Description, Dettes Fc en usd,
   *    _uuid, _updated_at, _device_id, _unit_uuid, _version
   * 
   * @param {object} debt - Données de la dette
   * @returns {string} op_id de l'opération
   */
  enqueueDebt(debt) {
    const db = getDb();
    try {
      // ✅ Normaliser les nombres (jamais de virgule, toujours point décimal)
      const normalizeNumber = (val) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return Math.round(val * 100) / 100;
        const str = String(val).replace(',', '.');
        const num = parseFloat(str);
        return isNaN(num) ? 0 : Math.round(num * 100) / 100;
      };
      
      // ✅ VALIDATION: Ne pas enqueuer une dette vide
      const clientName = (debt.client_name || '').trim();
      const invoiceNumber = (debt.invoice_number || '').trim();
      const rateUsed = 2800; // Taux par défaut si FC manquant
      let totalFc = normalizeNumber(debt.total_fc);
      const totalUsd = normalizeNumber(debt.total_usd);

      if (totalFc <= 0 && totalUsd > 0) {
        totalFc = normalizeNumber(totalUsd * rateUsed);
      }
      
      if (!invoiceNumber || !clientName || (totalFc <= 0 && totalUsd <= 0)) {
        logger.warn(`⏭️ [OUTBOX] Dette ignorée (vide): invoice='${invoiceNumber}', client='${clientName}', total_fc=${totalFc}, total_usd=${totalUsd}`);
        return null; // Ne pas enqueuer
      }
      
      const opId = generateUUID();
      const deviceId = this.getDeviceId();
      const now = new Date().toISOString();

      const debtUuid = (debt.uuid || '').trim() || generateUUID();
      const isUsd = totalUsd > 0;
      const currencyMarker = isUsd ? 'USD' : '';
      const amountForSheets = isUsd ? totalUsd : totalFc;
      const paidForSheets = isUsd ? normalizeNumber(debt.paid_usd) : normalizeNumber(debt.paid_fc);
      const remainingForSheets = isUsd ? normalizeNumber(debt.remaining_usd) : normalizeNumber(debt.remaining_fc);
      
      // ✅ Payload exact pour Google Sheets (colonnes de la feuille "Dettes")
      const payload = {
        // Colonnes métier
        Client: clientName,
        Produit: debt.product_description || '',
        Argent: amountForSheets,
        'prix a payer': amountForSheets,
        'prix payer deja': paidForSheets,
        reste: remainingForSheets,
        date: debt.date || debt.created_at || now,
        'numero de facture': invoiceNumber,
        Dollars: currencyMarker,
        'objet\\Description': debt.product_description || '',
        'Dettes Fc en usd': totalFc,
        
        // Colonnes techniques pour sync
        _uuid: debtUuid,
        _updated_at: now,
        _device_id: deviceId,
        _unit_uuid: debtUuid, // Pour compatibilité
        _version: 1,
        
        // Données complètes pour le worker
        uuid: debtUuid,
        invoice_number: invoiceNumber,
        client_name: debt.client_name,
        client_phone: debt.client_phone || null,
        product_description: debt.product_description,
        total_fc: totalFc,
        paid_fc: normalizeNumber(debt.paid_fc),
        remaining_fc: normalizeNumber(debt.remaining_fc),
        total_usd: normalizeNumber(debt.total_usd),
        paid_usd: normalizeNumber(debt.paid_usd),
        remaining_usd: normalizeNumber(debt.remaining_usd),
        debt_fc_in_usd: totalFc,
        status: debt.status || 'open',
        note: debt.note || null
      };

      // ✅ Insérer dans sync_operations (table lue par le worker)
      db.prepare(`
        INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
        VALUES (?, 'DEBT', ?, ?, ?, ?, 'pending')
      `).run(opId, debtUuid, invoiceNumber, JSON.stringify(payload), deviceId);

      logger.info(`💳 [OUTBOX] DEBT_CREATED queued: invoice='${debt.invoice_number}', client='${debt.client_name}', op_id='${opId}'`);
      logger.info(`   📊 Total: ${payload.total_usd} USD, Payé: ${payload.paid_usd} USD, Reste: ${payload.reste} USD`);
      
      return opId;
    } catch (error) {
      logger.error('❌ [OUTBOX] Erreur enqueueDebt:', error);
      throw error;
    }
  }

  /**
   * ✅ RESYNC ROBUSTE: Synchronise TOUTES les dettes locales vers Sheets
   * - Génère UUID si manquant
   * - Utilise invoice_number comme clé unique (évite doublons)
   * - Force la resync même si déjà synced
   * 
   * @param {boolean} forceAll - Si true, resync toutes les dettes. Si false, seulement celles sans sync récent
   * @returns {object} { queued: number, errors: number, details: [] }
   */
  resyncAllDebts(forceAll = false) {
    const db = getDb();
    const results = { queued: 0, errors: 0, skipped: 0, details: [] };
    const deviceId = this.getDeviceId();
    const now = new Date().toISOString();
    
    logger.info(`\n${'═'.repeat(70)}`);
    logger.info(`🔄 [DEBT-RESYNC] Début resync ${forceAll ? 'FORCÉ' : 'incrémental'} de toutes les dettes`);
    logger.info(`${'═'.repeat(70)}`);
    
    try {
      // ✅ Récupérer TOUTES les dettes locales
      const debts = db.prepare(`
        SELECT 
          id, uuid, invoice_number, client_name, client_phone,
          product_description, total_fc, paid_fc, remaining_fc,
          total_usd, debt_fc_in_usd, status, note, created_at, synced_at
        FROM debts
        ORDER BY created_at DESC
      `).all();
      
      logger.info(`   📊 ${debts.length} dette(s) trouvée(s) en local`);
      
      // Normaliser les nombres
      const normalizeNumber = (val) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return Math.round(val * 100) / 100;
        const str = String(val).replace(',', '.');
        const num = parseFloat(str);
        return isNaN(num) ? 0 : Math.round(num * 100) / 100;
      };
      
      for (const debt of debts) {
        try {
          // ✅ VALIDATION: Ignorer les dettes vides/invalides
          const clientName = (debt.client_name || '').trim();
          const invoiceNumber = (debt.invoice_number || '').trim();
          const totalFcRaw = normalizeNumber(debt.total_fc);
          const totalUsdRaw = normalizeNumber(debt.total_usd);
          
          if (!clientName || (totalFcRaw <= 0 && totalUsdRaw <= 0)) {
            results.skipped++;
            results.details.push({ 
              invoice: invoiceNumber || debt.invoice_number, 
              status: 'skipped', 
              reason: 'empty_debt_no_client_or_amount' 
            });
            logger.warn(`   ⏭️ Dette ID ${debt.id} ignorée: client='${clientName}', total_fc=${totalFcRaw}, total_usd=${totalUsdRaw}`);
            continue;
          }
          
          // ✅ Générer UUID si manquant
          let debtUuid = debt.uuid;
          if (!debtUuid || debtUuid.trim() === '') {
            debtUuid = generateUUID();
            db.prepare('UPDATE debts SET uuid = ? WHERE id = ?').run(debtUuid, debt.id);
            logger.info(`   🔑 UUID généré pour dette ID ${debt.id}: ${debtUuid.substring(0, 8)}...`);
          }
          
          // ✅ Vérifier si déjà en pending
          const existingPending = db.prepare(`
            SELECT id, op_id FROM sync_operations 
            WHERE entity_code = ? AND op_type = 'DEBT' AND status = 'pending'
            LIMIT 1
          `).get(debt.invoice_number);
          
          if (existingPending && !forceAll) {
            results.skipped++;
            results.details.push({ invoice: debt.invoice_number, status: 'skipped', reason: 'already_pending' });
            continue;
          }
          
          // ✅ Supprimer les anciennes opérations pending pour cette facture (évite doublons)
          if (existingPending) {
            db.prepare(`DELETE FROM sync_operations WHERE entity_code = ? AND op_type = 'DEBT' AND status = 'pending'`)
              .run(debt.invoice_number);
          }
          
          // ✅ Calculer les montants corrects
          const rateUsed = 2800; // Taux par défaut
          const paidFc = normalizeNumber(debt.paid_fc);
          const remainingFc = normalizeNumber(debt.remaining_fc);
          
          // Calculer USD depuis FC si non disponible
          let totalUsd = normalizeNumber(debt.total_usd);
          let paidUsd = 0;
          let remainingUsd = 0;
          
          if (totalUsd <= 0 && totalFcRaw > 0) {
            totalUsd = normalizeNumber(totalFcRaw / rateUsed);
          }

          // Si FC manquant mais USD présent, le dériver (important pour pull/feuille)
          let totalFc = totalFcRaw;
          if (totalFc <= 0 && totalUsd > 0) {
            totalFc = normalizeNumber(totalUsd * rateUsed);
          }

          if (!invoiceNumber || !clientName || (totalFc <= 0 && totalUsd <= 0)) {
            results.skipped++;
            results.details.push({ invoice: invoiceNumber || debt.invoice_number, status: 'skipped', reason: 'empty_debt' });
            continue;
          }
          
          // Calculer payé USD : si paid_fc existe, l'utiliser
          if (paidFc > 0) {
            paidUsd = normalizeNumber(paidFc / rateUsed);
          }
          
          // Calculer restant USD
          remainingUsd = normalizeNumber(totalUsd - paidUsd);
          if (remainingUsd < 0) remainingUsd = 0;
          
          // ✅ Créer le payload avec colonnes Sheets exactes
          const opId = generateUUID();
          const payload = {
            // Colonnes Sheets exactes
            Client: clientName,
            Produit: debt.product_description || '',
            Argent: totalUsd,
            'prix a payer': totalUsd,
            'prix payer deja': paidUsd,
            reste: remainingUsd,
            date: debt.created_at || now,
            'numero de facture': invoiceNumber,
            Dollars: 'USD',
            'objet\\Description': debt.product_description || '',
            'Dettes Fc en usd': totalFc,
            _uuid: debtUuid,
            _updated_at: now,
            _device_id: deviceId,
            _unit_uuid: debtUuid,
            _version: 1,
            
            // Données complètes
            uuid: debtUuid,
            invoice_number: invoiceNumber,
            client_name: clientName,
            client_phone: debt.client_phone,
            product_description: debt.product_description,
            total_fc: totalFc,
            paid_fc: paidFc,
            remaining_fc: remainingFc,
            total_usd: totalUsd,
            paid_usd: paidUsd,
            remaining_usd: remainingUsd,
            status: debt.status || 'open'
          };
          
          // ✅ Insérer dans sync_operations
          db.prepare(`
            INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
            VALUES (?, 'DEBT', ?, ?, ?, ?, 'pending')
          `).run(opId, debtUuid, invoiceNumber, JSON.stringify(payload), deviceId);
          
          results.queued++;
          results.details.push({ 
            invoice: debt.invoice_number, 
            client: debt.client_name,
            status: 'queued',
            total: totalUsd,
            paid: paidUsd,
            remaining: remainingUsd
          });
          
          logger.info(`   ✅ [${results.queued}] ${debt.client_name} - ${debt.invoice_number}: ${totalUsd} USD (payé: ${paidUsd})`);
          
        } catch (debtError) {
          results.errors++;
          results.details.push({ invoice: debt.invoice_number, status: 'error', error: debtError.message });
          logger.error(`   ❌ Erreur dette ${debt.invoice_number}: ${debtError.message}`);
        }
      }
      
      logger.info(`${'─'.repeat(70)}`);
      logger.info(`🔄 [DEBT-RESYNC] Résumé: ${results.queued} queued, ${results.skipped} skipped, ${results.errors} errors`);
      logger.info(`${'═'.repeat(70)}\n`);
      
      return results;
      
    } catch (error) {
      logger.error(`❌ [DEBT-RESYNC] Erreur globale:`, error);
      results.errors++;
      return results;
    }
  }

  /**
   * ✅ Marque une dette comme synchronisée
   */
  markDebtSynced(invoiceNumber) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE debts SET synced_at = datetime('now') WHERE invoice_number = ?
      `).run(invoiceNumber);
    } catch (e) {
      logger.warn(`⚠️ Impossible de marquer dette synced: ${invoiceNumber}`);
    }
  }

  // ========================================
  // RATES (Taux de change avec sync vers feuille "Taux")
  // ========================================

  /**
   * Enqueue une mise à jour de taux pour sync vers Google Sheets (feuille "Taux")
   * ✅ Format des colonnes Sheets: Taux, USD, Fc, DATE, _uuid, _updated_at
   * 
   * @param {number} rateValue - Taux FC par USD (ex: 2800)
   * @param {string} effectiveAt - Date d'effet (ISO string)
   * @returns {string} op_id de l'opération
   */
  enqueueRate(rateValue, effectiveAt = null) {
    const db = getDb();
    try {
      const opId = generateUUID();
      const deviceId = this.getDeviceId();
      const now = effectiveAt || new Date().toISOString();
      const rateUuid = generateUUID();

      // Normaliser le taux
      const rate = parseFloat(rateValue) || 2800;

      // ✅ Payload exact pour Google Sheets (colonnes de la feuille "Taux")
      const payload = {
        uuid: rateUuid,
        rate_fc_per_usd: rate,
        usd: 100,  // Standard: 100 USD
        fc: rate * 100, // 100 USD en FC
        effective_at: now,
        _updated_at: now,
        _device_id: deviceId
      };

      // ✅ Supprimer les anciennes opérations pending (évite doublons)
      db.prepare(`
        DELETE FROM sync_operations 
        WHERE op_type = 'RATE' 
          AND status = 'pending'
      `).run();

      db.prepare(`
        INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
        VALUES (?, 'RATE', ?, 'current', ?, ?, 'pending')
      `).run(opId, rateUuid, JSON.stringify(payload), deviceId);

      logger.info(`💱 [OUTBOX] RATE queued: ${rate} FC/USD, op_id='${opId}'`);
      
      return opId;
    } catch (error) {
      logger.error('❌ [OUTBOX] Erreur enqueueRate:', error);
      throw error;
    }
  }

  // ========================================
  // USERS (Utilisateurs avec sync vers feuille "Compter Utilisateur")
  // ========================================

  /**
   * Enqueue un utilisateur pour sync vers Google Sheets (feuille "Compter Utilisateur")
   * ✅ Format des colonnes Sheets: Nom, Mode passe, Numero, Valide, date de creation, 
   *    Token Expo Push, marque, Urlprofile, admi, _uuid, Vendeur, Gerent Stock, Porudits est Vender
   * 
   * @param {object} userData - Données de l'utilisateur
   * @param {string} operation - Type d'opération: 'create', 'update', 'delete'
   * @returns {string} op_id de l'opération
   */
  enqueueUser(userData, operation = 'upsert') {
    const db = getDb();
    try {
      const opId = generateUUID();
      const deviceId = this.getDeviceId();
      const now = new Date().toISOString();

      // ✅ Générer UUID si manquant
      const userUuid = userData.uuid || generateUUID();

      // ✅ Payload exact pour Google Sheets (colonnes de la feuille "Compter Utilisateur")
      const payload = {
        // Données utilisateur
        uuid: userUuid,
        username: userData.username || '',
        phone: userData.phone || '',
        is_admin: userData.is_admin || 0,
        is_active: userData.is_active !== undefined ? userData.is_active : 1,
        is_vendeur: userData.is_vendeur !== undefined ? userData.is_vendeur : 1,
        is_gerant_stock: userData.is_gerant_stock || 0,
        can_manage_products: userData.can_manage_products || 0,
        created_at: userData.created_at || now,
        updated_at: userData.updated_at || now,
        device_brand: userData.device_brand || '',
        profile_url: userData.profile_url || '',
        expo_push_token: userData.expo_push_token || '',
        
        // Colonnes techniques
        _uuid: userUuid,
        _updated_at: now,
        _device_id: deviceId
      };

      // ✅ Supprimer les anciennes opérations pending pour cet utilisateur (évite doublons)
      db.prepare(`
        DELETE FROM sync_operations 
        WHERE entity_uuid = ? 
          AND op_type = 'USER'
          AND status = 'pending'
      `).run(userUuid);

      db.prepare(`
        INSERT INTO sync_operations (op_id, op_type, entity_uuid, entity_code, payload_json, device_id, status)
        VALUES (?, 'USER', ?, ?, ?, ?, 'pending')
      `).run(opId, userUuid, userData.username || userUuid, JSON.stringify(payload), deviceId);

      logger.info(`👤 [OUTBOX] USER queued: ${userData.username} (${operation}), op_id='${opId}'`);
      
      return opId;
    } catch (error) {
      logger.error('❌ [OUTBOX] Erreur enqueueUser:', error);
      throw error;
    }
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

      const rows = db.prepare(query).all(...params);
      
      // ✅ LOG: Afficher le nombre d'opérations retournées
      if (opType && rows.length > 0) {
        console.log(`   📌 [getPendingOperations] ${opType}: ${rows.length} opération(s) pending trouvées`);
      }
      
      return rows.map(row => {
        try {
          const payload = JSON.parse(row.payload_json);
          return { ...row, payload };
        } catch (e) {
          logger.error(`[getPendingOperations] JSON parse error pour op_id=${row.op_id}: ${e.message}`);
          logger.error(`   payload_json: ${(row.payload_json || '').substring(0, 100)}`);
          return { ...row, payload: {} };
        }
      });
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
      if (!opIds || opIds.length === 0) {
        logger.warn('⚠️ [OUTBOX] markAsAcked appelée avec 0 opIds');
        return;
      }

      // ✅ Utiliser UPDATE avec WHERE IN au lieu de transaction
      // (Plus robuste et plus simple)
      const placeholders = opIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        UPDATE sync_operations
        SET status = 'acked',
            acked_at = datetime('now'),
            updated_at = datetime('now')
        WHERE op_id IN (${placeholders})
      `);

      const result = stmt.run(...opIds);
      
      if (result.changes === 0) {
        logger.warn(`⚠️ [OUTBOX] markAsAcked: ${opIds.length} opIds fournis mais 0 rows mises à jour!`);
        logger.warn(`   opIds: ${opIds.join(', ')}`);
      } else {
        logger.info(`✅ [OUTBOX] ${result.changes} opération(s) marquée(s) acked (${opIds.length} demandées)`);
      }
    } catch (error) {
      logger.error('❌ Erreur markAsAcked:', error);
      logger.error(`   opIds: ${JSON.stringify(opIds)}`);
      throw error;
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
   * ✅ PRO: Vérifie si un produit a des opérations RÉCENTES pending (< 5 min)
   * Si les opérations sont anciennes, on autorise l'écrasement par Sheets
   * 
   * @param {string} productCode - Code du produit
   * @param {number} maxAgeMinutes - Age max en minutes (défaut: 5)
   * @returns {boolean} true si des opérations RÉCENTES pending existent
   */
  hasProductPending(productCode, maxAgeMinutes = 5) {
    const db = getDb();
    try {
      // Seulement considérer les opérations créées dans les dernières X minutes
      const pending = db.prepare(`
        SELECT COUNT(*) as count
        FROM sync_operations
        WHERE entity_code = ?
          AND status = 'pending'
          AND op_type IN ('PRODUCT_PATCH', 'UNIT_PATCH', 'STOCK_MOVE')
          AND created_at > datetime('now', '-${maxAgeMinutes} minutes')
      `).get(productCode);

      return pending.count > 0;
    } catch (error) {
      logger.error('Erreur hasProductPending:', error);
      return false;
    }
  }

  /**
   * ✅ PRO: Vérifie si une unité a des mouvements de stock RÉCENTS pending (< 5 min)
   * Les anciens mouvements non synced sont ignorés pour permettre l'écrasement par Sheets
   * 
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité
   * @param {string} unitMark - Mark de l'unité
   * @param {number} maxAgeMinutes - Age max en minutes (défaut: 5)
   * @returns {boolean} true si des mouvements RÉCENTS pending existent
   */
  hasStockMovePending(productCode, unitLevel, unitMark = '', maxAgeMinutes = 5) {
    const db = getDb();
    try {
      const pending = db.prepare(`
        SELECT COUNT(*) as count
        FROM stock_moves
        WHERE product_code = ?
          AND unit_level = ?
          AND unit_mark = ?
          AND synced = 0
          AND created_at > datetime('now', '-${maxAgeMinutes} minutes')
      `).get(productCode, unitLevel, unitMark);

      return pending.count > 0;
    } catch (error) {
      logger.error('Erreur hasStockMovePending:', error);
      return false;
    }
  }
  
  /**
   * ✅ PRO: Nettoie les anciens stock_moves non synced (> 1 heure)
   * Ces mouvements sont considérés comme perdus, Sheets est la source de vérité
   * @returns {number} Nombre de mouvements nettoyés
   */
  cleanupOldStockMoves(maxAgeHours = 1) {
    const db = getDb();
    try {
      const result = db.prepare(`
        DELETE FROM stock_moves
        WHERE synced = 0
          AND created_at < datetime('now', '-${maxAgeHours} hours')
      `).run();
      
      if (result.changes > 0) {
        logger.info(`🧹 [CLEANUP] ${result.changes} ancien(s) stock_move(s) supprimé(s) (> ${maxAgeHours}h)`);
      }
      return result.changes;
    } catch (error) {
      logger.error('Erreur cleanupOldStockMoves:', error);
      return 0;
    }
  }
  
  /**
   * ✅ PRO: Nettoie les anciennes opérations pending (> 1 heure)
   * Ces opérations sont considérées comme perdues
   * @returns {number} Nombre d'opérations nettoyées
   */
  cleanupOldPendingOps(maxAgeHours = 1) {
    const db = getDb();
    try {
      const result = db.prepare(`
        DELETE FROM sync_operations
        WHERE status = 'pending'
          AND created_at < datetime('now', '-${maxAgeHours} hours')
      `).run();
      
      if (result.changes > 0) {
        logger.info(`🧹 [CLEANUP] ${result.changes} ancienne(s) opération(s) pending supprimée(s) (> ${maxAgeHours}h)`);
      }
      return result.changes;
    } catch (error) {
      logger.error('Erreur cleanupOldPendingOps:', error);
      return 0;
    }
  }
  
  /**
   * ✅ PRO: Marque tous les stock_moves comme synced pour un produit
   * À appeler quand on écrase avec les données de Sheets
   */
  markAllStockMovesAsSynced(productCode) {
    const db = getDb();
    try {
      const result = db.prepare(`
        UPDATE stock_moves
        SET synced = 1, synced_at = datetime('now')
        WHERE product_code = ? AND synced = 0
      `).run(productCode);
      
      return result.changes;
    } catch (error) {
      logger.error('Erreur markAllStockMovesAsSynced:', error);
      return 0;
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
  // NETTOYAGE ET MAINTENANCE PRO
  // ========================================

  /**
   * ✅ PRO: Nettoie les anciens stock_moves déjà synchronisés (> 24h)
   * Garde l'historique récent mais libère les produits pour la sync Sheets
   * @returns {number} Nombre de mouvements nettoyés
   */
  cleanupOldSyncedMoves(hoursOld = 24) {
    const db = getDb();
    try {
      const result = db.prepare(`
        DELETE FROM stock_moves
        WHERE synced = 1
          AND synced_at < datetime('now', '-' || ? || ' hours')
      `).run(hoursOld);
      
      if (result.changes > 0) {
        logger.info(`🧹 [CLEANUP] ${result.changes} stock_moves anciens supprimés (>${hoursOld}h)`);
      }
      return result.changes;
    } catch (error) {
      logger.error('Erreur cleanupOldSyncedMoves:', error);
      return 0;
    }
  }

  /**
   * ✅ PRO: Force le marquage de TOUS les stock_moves d'un produit comme synced
   * Utilisé quand on veut forcer la mise à jour depuis Sheets
   * @param {string} productCode - Code du produit
   * @returns {number} Nombre de mouvements marqués
   */
  forceMarkProductMovesAsSynced(productCode) {
    const db = getDb();
    try {
      const result = db.prepare(`
        UPDATE stock_moves
        SET synced = 1, synced_at = datetime('now')
        WHERE product_code = ? AND synced = 0
      `).run(productCode);
      
      if (result.changes > 0) {
        logger.info(`✅ [FORCE-SYNC] ${result.changes} stock_moves marqués synced pour ${productCode}`);
      }
      return result.changes;
    } catch (error) {
      logger.error('Erreur forceMarkProductMovesAsSynced:', error);
      return 0;
    }
  }

  /**
   * ✅ PRO: Nettoie les opérations acked/error anciennes (> 7 jours)
   * @returns {number} Nombre d'opérations nettoyées
   */
  cleanupOldOperations(daysOld = 7) {
    const db = getDb();
    try {
      const result = db.prepare(`
        DELETE FROM sync_operations
        WHERE status IN ('acked', 'error')
          AND updated_at < datetime('now', '-' || ? || ' days')
      `).run(daysOld);
      
      if (result.changes > 0) {
        logger.info(`🧹 [CLEANUP] ${result.changes} sync_operations anciennes supprimées (>${daysOld}j)`);
      }
      return result.changes;
    } catch (error) {
      logger.error('Erreur cleanupOldOperations:', error);
      return 0;
    }
  }

  /**
   * ✅ PRO: Vérifie si un produit a des opérations RÉCENTES pending (< 1h)
   * Les anciennes opérations pending sont considérées comme "abandonnées"
   * @param {string} productCode - Code du produit
   * @returns {boolean} true si des opérations RÉCENTES pending existent
   */
  hasRecentProductPending(productCode) {
    const db = getDb();
    try {
      // Vérifier sync_operations récentes
      const pendingOps = db.prepare(`
        SELECT COUNT(*) as count
        FROM sync_operations
        WHERE entity_code = ?
          AND status = 'pending'
          AND op_type IN ('PRODUCT_PATCH', 'UNIT_PATCH', 'STOCK_MOVE')
          AND created_at > datetime('now', '-1 hour')
      `).get(productCode);

      // Vérifier stock_moves récents
      const pendingMoves = db.prepare(`
        SELECT COUNT(*) as count
        FROM stock_moves
        WHERE product_code = ?
          AND synced = 0
          AND created_at > datetime('now', '-1 hour')
      `).get(productCode);

      return (pendingOps?.count || 0) > 0 || (pendingMoves?.count || 0) > 0;
    } catch (error) {
      logger.error('Erreur hasRecentProductPending:', error);
      return false;
    }
  }

  /**
   * ✅ PRO: Marque les anciennes opérations pending comme abandonnées
   * Permet de débloquer les produits qui étaient en attente depuis trop longtemps
   * @param {number} hoursOld - Âge minimum en heures (défaut 2h)
   * @returns {object} { operations: number, moves: number }
   */
  markOldPendingAsAbandoned(hoursOld = 2) {
    const db = getDb();
    const result = { operations: 0, moves: 0 };
    
    try {
      // Marquer les sync_operations anciennes comme "error" (abandonnées)
      const opsResult = db.prepare(`
        UPDATE sync_operations
        SET status = 'acked', 
            last_error = 'Auto-abandoned (too old)',
            updated_at = datetime('now')
        WHERE status = 'pending'
          AND created_at < datetime('now', '-' || ? || ' hours')
      `).run(hoursOld);
      result.operations = opsResult.changes;

      // Marquer les stock_moves anciens comme synced (pour débloquer)
      const movesResult = db.prepare(`
        UPDATE stock_moves
        SET synced = 1, synced_at = datetime('now')
        WHERE synced = 0
          AND created_at < datetime('now', '-' || ? || ' hours')
      `).run(hoursOld);
      result.moves = movesResult.changes;
      
      if (result.operations > 0 || result.moves > 0) {
        logger.info(`🔓 [ABANDON] ${result.operations} ops + ${result.moves} moves marqués comme abandonnés (>${hoursOld}h)`);
      }
      
      return result;
    } catch (error) {
      logger.error('Erreur markOldPendingAsAbandoned:', error);
      return result;
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

      // ✅ PRO: Ajouter stats sur les opérations récentes
      const recentPending = db.prepare(`
        SELECT COUNT(*) as count FROM sync_operations 
        WHERE status = 'pending' AND created_at > datetime('now', '-1 hour')
      `).get();

      const recentMovesPending = db.prepare(`
        SELECT COUNT(*) as count FROM stock_moves 
        WHERE synced = 0 AND created_at > datetime('now', '-1 hour')
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
        recentPending: recentPending?.count || 0,
        errors: errors?.count || 0,
        stockMovesPending: stockMovesPending?.count || 0,
        recentMovesPending: recentMovesPending?.count || 0,
        lastAcked: lastAcked?.acked_at || null
      };
    } catch (error) {
      logger.error('Erreur getStats:', error);
      return { pendingByType: {}, totalPending: 0, recentPending: 0, errors: 0, stockMovesPending: 0, recentMovesPending: 0, lastAcked: null };
    }
  }

  /**
   * ✅ PRO: Statistiques détaillées pour un produit spécifique
   */
  getProductSyncStats(productCode) {
    const db = getDb();
    try {
      const pendingOps = db.prepare(`
        SELECT op_type, COUNT(*) as count, MAX(created_at) as last_created
        FROM sync_operations
        WHERE entity_code = ? AND status = 'pending'
        GROUP BY op_type
      `).all(productCode);

      const pendingMoves = db.prepare(`
        SELECT COUNT(*) as count, 
               COALESCE(SUM(delta), 0) as total_delta,
               MAX(created_at) as last_created
        FROM stock_moves
        WHERE product_code = ? AND synced = 0
      `).get(productCode);

      const recentMoves = db.prepare(`
        SELECT COUNT(*) as count
        FROM stock_moves
        WHERE product_code = ? AND synced = 0 AND created_at > datetime('now', '-1 hour')
      `).get(productCode);

      return {
        productCode,
        pendingOperations: pendingOps,
        stockMoves: {
          pending: pendingMoves?.count || 0,
          totalDelta: pendingMoves?.total_delta || 0,
          lastCreated: pendingMoves?.last_created || null,
          recentPending: recentMoves?.count || 0
        },
        canUpdateFromSheets: (recentMoves?.count || 0) === 0 && pendingOps.length === 0
      };
    } catch (error) {
      logger.error('Erreur getProductSyncStats:', error);
      return { productCode, pendingOperations: [], stockMoves: { pending: 0, totalDelta: 0 }, canUpdateFromSheets: true };
    }
  }
}

export const outboxRepo = new OutboxRepository();

