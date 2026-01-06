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

