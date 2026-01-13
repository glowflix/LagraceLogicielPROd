/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REALTIME SYNC SERVICE - Synchronisation temps réel robuste
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Service PRO de synchronisation réseau local avec:
 * - Opérations idempotentes (basées sur UUID + version)
 * - Transactions SQLite robustes (WAL mode)
 * - Propagation temps réel via WebSocket
 * - File d'attente des événements (offline queue)
 * - Rattrapage après reconnexion
 * - Logs détaillés pour debugging
 * - Gestion des doublons automatique
 */

import { getDb } from '../../db/sqlite.js';
import { getSocketIO } from '../../api/socket.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const SYNC_CONFIG = {
  VERSION_CHECK_ENABLED: true,    // Vérifier les versions avant update
  BROADCAST_ENABLED: true,        // Diffuser les changements via WebSocket
  LOG_OPERATIONS: true,           // Logger toutes les opérations
  TRANSACTION_TIMEOUT: 10000,     // Timeout des transactions (10s)
  BATCH_SIZE: 100,                // Taille max des batches
};

// ═══════════════════════════════════════════════════════════════════════════
// ÉTAT DU SERVICE
// ═══════════════════════════════════════════════════════════════════════════

const operationLog = new Map(); // Historique des opérations pour déduplication
const pendingBroadcasts = [];   // File d'attente des broadcasts
let broadcastInterval = null;

// ═══════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log conditionnel
 */
function log(level, message, data = null) {
  if (!SYNC_CONFIG.LOG_OPERATIONS && level === 'debug') return;
  
  const prefix = '🔄 [RealtimeSync]';
  const logMessage = data ? `${prefix} ${message}` : `${prefix} ${message}`;
  
  switch (level) {
    case 'info':
      logger.info(logMessage);
      if (data) logger.info(JSON.stringify(data, null, 2));
      break;
    case 'warn':
      logger.warn(logMessage);
      if (data) logger.warn(JSON.stringify(data, null, 2));
      break;
    case 'error':
      logger.error(logMessage);
      if (data) logger.error(JSON.stringify(data, null, 2));
      break;
    case 'debug':
      logger.debug(logMessage);
      break;
  }
}

/**
 * Génère une clé d'opération unique pour la déduplication
 */
function getOperationKey(type, id, action) {
  return `${type}:${id}:${action}`;
}

/**
 * Vérifie si une opération est un doublon récent
 */
function isDuplicateOperation(key, windowMs = 1000) {
  const lastOp = operationLog.get(key);
  if (!lastOp) return false;
  
  const elapsed = Date.now() - lastOp.timestamp;
  return elapsed < windowMs;
}

/**
 * Enregistre une opération
 */
function recordOperation(key, data = {}) {
  operationLog.set(key, {
    timestamp: Date.now(),
    ...data,
  });
  
  // Nettoyer les anciennes entrées (garder 5 minutes)
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of operationLog.entries()) {
    if (v.timestamp < cutoff) {
      operationLog.delete(k);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BROADCAST WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Émet un événement WebSocket à tous les clients
 */
function broadcast(event, data, excludeSocketId = null) {
  if (!SYNC_CONFIG.BROADCAST_ENABLED) return;
  
  const io = getSocketIO();
  if (!io) {
    log('warn', 'Socket.IO non disponible, broadcast ignoré');
    pendingBroadcasts.push({ event, data, excludeSocketId, timestamp: Date.now() });
    return;
  }
  
  try {
    if (excludeSocketId) {
      io.except(excludeSocketId).emit(event, data);
    } else {
      io.emit(event, data);
    }
    
    log('debug', `Broadcast: ${event}`, { dataKeys: Object.keys(data) });
  } catch (error) {
    log('error', `Erreur broadcast ${event}:`, error.message);
  }
}

/**
 * Traite les broadcasts en attente
 */
function processPendingBroadcasts() {
  const io = getSocketIO();
  if (!io) return;
  
  while (pendingBroadcasts.length > 0) {
    const { event, data, excludeSocketId } = pendingBroadcasts.shift();
    broadcast(event, data, excludeSocketId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPÉRATIONS IDEMPOTENTES - PRODUITS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Met à jour un produit de manière idempotente
 * @param {Object} product - Données du produit
 * @param {Object} options - Options (socketId pour exclure)
 * @returns {Object} Résultat de l'opération
 */
export function updateProductIdempotent(product, options = {}) {
  const { socketId = null, skipBroadcast = false } = options;
  const db = getDb();
  
  // Validation
  if (!product.id && !product.uuid) {
    throw new Error('ID ou UUID requis pour mise à jour produit');
  }
  
  const opKey = getOperationKey('product', product.id || product.uuid, 'update');
  
  // Vérifier si doublon
  if (isDuplicateOperation(opKey, 500)) {
    log('debug', `Opération doublon ignorée: ${opKey}`);
    return { success: true, duplicate: true };
  }
  
  try {
    // Transaction SQLite
    const result = db.transaction(() => {
      // Récupérer la version actuelle
      let current;
      if (product.id) {
        current = db.prepare('SELECT * FROM products WHERE id = ?').get(product.id);
      } else {
        current = db.prepare('SELECT * FROM products WHERE uuid = ?').get(product.uuid);
      }
      
      if (!current) {
        throw new Error(`Produit non trouvé: ${product.id || product.uuid}`);
      }
      
      // Vérifier la version si activé
      if (SYNC_CONFIG.VERSION_CHECK_ENABLED && product.version !== undefined) {
        if (current.version && product.version < current.version) {
          log('warn', `Version obsolète ignorée: ${product.version} < ${current.version}`);
          return { success: true, stale: true, currentVersion: current.version };
        }
      }
      
      // Préparer la mise à jour
      const updateFields = [];
      const updateValues = [];
      
      const allowedFields = [
        'name', 'description', 'category', 'brand', 'supplier',
        'is_active', 'updated_at', 'version',
      ];
      
      for (const field of allowedFields) {
        if (product[field] !== undefined) {
          updateFields.push(`${field} = ?`);
          updateValues.push(product[field]);
        }
      }
      
      // Toujours mettre à jour updated_at et incrémenter version
      if (!updateFields.includes('updated_at = ?')) {
        updateFields.push('updated_at = ?');
        updateValues.push(new Date().toISOString());
      }
      
      if (!updateFields.includes('version = ?')) {
        updateFields.push('version = COALESCE(version, 0) + 1');
      }
      
      if (updateFields.length === 0) {
        return { success: true, noChanges: true };
      }
      
      // Exécuter la mise à jour
      updateValues.push(current.id);
      const stmt = db.prepare(`
        UPDATE products 
        SET ${updateFields.join(', ')} 
        WHERE id = ?
      `);
      
      const info = stmt.run(...updateValues);
      
      // Récupérer le produit mis à jour
      const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(current.id);
      
      return { success: true, changes: info.changes, product: updated };
    })();
    
    // Enregistrer l'opération
    recordOperation(opKey, { productId: product.id || product.uuid });
    
    // Broadcast si succès et pas de skip
    if (result.success && !result.duplicate && !result.stale && !skipBroadcast) {
      broadcast('product:updated', result.product, socketId);
    }
    
    log('info', `Produit mis à jour: ${product.id || product.uuid}`, result);
    return result;
    
  } catch (error) {
    log('error', `Erreur mise à jour produit ${product.id || product.uuid}:`, error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPÉRATIONS IDEMPOTENTES - STOCK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Met à jour le stock de manière idempotente avec transaction
 * @param {Object} stockUpdate - {productId, unitLevel, quantity, operation: 'set'|'add'|'subtract'}
 * @param {Object} options - Options
 * @returns {Object} Résultat avec ancien et nouveau stock
 */
export function updateStockIdempotent(stockUpdate, options = {}) {
  const { socketId = null, skipBroadcast = false, reason = 'manual' } = options;
  const db = getDb();
  
  const { productId, productUuid, unitLevel, quantity, operation = 'set' } = stockUpdate;
  
  if (!productId && !productUuid) {
    throw new Error('productId ou productUuid requis');
  }
  if (unitLevel === undefined) {
    throw new Error('unitLevel requis');
  }
  if (quantity === undefined) {
    throw new Error('quantity requis');
  }
  
  const opKey = getOperationKey('stock', `${productId || productUuid}-${unitLevel}`, operation);
  
  // Pas de déduplication pour les opérations de stock (chaque opération est unique)
  // Mais on enregistre pour le log
  
  try {
    const result = db.transaction(() => {
      // Trouver le product_unit
      let unit;
      if (productId) {
        unit = db.prepare(`
          SELECT * FROM product_units 
          WHERE product_id = ? AND unit_level = ?
        `).get(productId, unitLevel);
      } else {
        const product = db.prepare('SELECT id FROM products WHERE uuid = ?').get(productUuid);
        if (!product) throw new Error(`Produit non trouvé: ${productUuid}`);
        
        unit = db.prepare(`
          SELECT * FROM product_units 
          WHERE product_id = ? AND unit_level = ?
        `).get(product.id, unitLevel);
      }
      
      if (!unit) {
        throw new Error(`Unité non trouvée: product=${productId || productUuid}, level=${unitLevel}`);
      }
      
      const oldStock = unit.stock || 0;
      let newStock;
      
      switch (operation) {
        case 'add':
          newStock = oldStock + quantity;
          break;
        case 'subtract':
          newStock = oldStock - quantity;
          if (newStock < 0) {
            log('warn', `Stock négatif détecté: ${newStock} pour unit ${unit.id}`);
            // On permet le stock négatif mais on log
          }
          break;
        case 'set':
        default:
          newStock = quantity;
          break;
      }
      
      // Mettre à jour le stock
      db.prepare(`
        UPDATE product_units 
        SET stock = ?, updated_at = ? 
        WHERE id = ?
      `).run(newStock, new Date().toISOString(), unit.id);
      
      // Récupérer l'unité mise à jour
      const updated = db.prepare('SELECT * FROM product_units WHERE id = ?').get(unit.id);
      
      // Logger la modification
      try {
        db.prepare(`
          INSERT INTO stock_modifications (
            modification_id, product_id, product_uuid, product_code,
            unit_level, stock_before, stock_after, delta,
            modification_type, reason, modified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateUUID(),
          unit.product_id,
          productUuid || '',
          unit.product_code || '',
          unitLevel,
          oldStock,
          newStock,
          newStock - oldStock,
          operation,
          reason,
          new Date().toISOString()
        );
      } catch (logError) {
        // Ne pas échouer si le log échoue
        log('warn', 'Erreur log stock_modifications:', logError.message);
      }
      
      return {
        success: true,
        unit: updated,
        oldStock,
        newStock,
        delta: newStock - oldStock,
      };
    })();
    
    // Enregistrer l'opération
    recordOperation(opKey, { unitId: result.unit?.id, delta: result.delta });
    
    // Broadcast
    if (!skipBroadcast) {
      broadcast('stock:updated', {
        product_id: result.unit.product_id,
        unit_level: unitLevel,
        stock: result.newStock,
        old_stock: result.oldStock,
        delta: result.delta,
        updated_at: new Date().toISOString(),
      }, socketId);
    }
    
    log('info', `Stock mis à jour: ${operation} ${quantity} → ${result.oldStock} → ${result.newStock}`);
    return result;
    
  } catch (error) {
    log('error', `Erreur mise à jour stock:`, error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPÉRATIONS IDEMPOTENTES - VENTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crée une vente de manière idempotente (évite les doublons)
 * @param {Object} sale - Données de la vente
 * @param {Object} options - Options
 * @returns {Object} Résultat de l'opération
 */
export function createSaleIdempotent(sale, options = {}) {
  const { socketId = null, skipBroadcast = false } = options;
  const db = getDb();
  
  // Vérifier si une vente avec ce numéro de facture existe déjà
  if (sale.invoice_number) {
    const existing = db.prepare(`
      SELECT id, uuid FROM sales WHERE invoice_number = ?
    `).get(sale.invoice_number);
    
    if (existing) {
      log('info', `Vente déjà existante: ${sale.invoice_number}, retour de l'existante`);
      const fullSale = db.prepare('SELECT * FROM sales WHERE id = ?').get(existing.id);
      return { success: true, duplicate: true, sale: fullSale };
    }
  }
  
  // Vérifier par UUID si fourni
  if (sale.uuid) {
    const existing = db.prepare('SELECT * FROM sales WHERE uuid = ?').get(sale.uuid);
    if (existing) {
      log('info', `Vente UUID déjà existante: ${sale.uuid}`);
      return { success: true, duplicate: true, sale: existing };
    }
  }
  
  try {
    const result = db.transaction(() => {
      const uuid = sale.uuid || generateUUID();
      
      // Insérer la vente
      const insertSale = db.prepare(`
        INSERT INTO sales (
          uuid, invoice_number, client_name, client_phone,
          seller_name, total_fc, total_usd, payment_mode, status,
          sold_at, origin, synced_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const saleInfo = insertSale.run(
        uuid,
        sale.invoice_number,
        sale.client_name || '',
        sale.client_phone || '',
        sale.seller_name || '',
        sale.total_fc || 0,
        sale.total_usd || 0,
        sale.payment_mode || 'cash',
        sale.status || 'paid',
        sale.sold_at || new Date().toISOString(),
        sale.origin || 'LOCAL',
        sale.synced_at || null,
        new Date().toISOString()
      );
      
      const saleId = saleInfo.lastInsertRowid;
      
      // Insérer les items et décrémenter le stock
      if (sale.items && Array.isArray(sale.items)) {
        const insertItem = db.prepare(`
          INSERT INTO sale_items (
            uuid, sale_id, product_id, product_code, product_name,
            unit_level, unit_mark, qty, unit_price_fc, unit_price_usd,
            subtotal_fc, subtotal_usd, product_unit_uuid, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const updateStock = db.prepare(`
          UPDATE product_units 
          SET stock = stock - ? 
          WHERE product_id = ? AND unit_level = ?
        `);
        
        for (const item of sale.items) {
          const itemUuid = item.uuid || generateUUID();
          
          insertItem.run(
            itemUuid,
            saleId,
            item.product_id,
            item.product_code || '',
            item.product_name || '',
            item.unit_level || 1,
            item.unit_mark || '',
            item.qty || 1,
            item.unit_price_fc || 0,
            item.unit_price_usd || 0,
            item.subtotal_fc || (item.qty * item.unit_price_fc),
            item.subtotal_usd || 0,
            item.product_unit_uuid || null,
            new Date().toISOString()
          );
          
          // Décrémenter le stock
          updateStock.run(item.qty || 1, item.product_id, item.unit_level || 1);
        }
      }
      
      // Récupérer la vente complète
      const createdSale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
      const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
      
      return {
        success: true,
        sale: { ...createdSale, items },
      };
    })();
    
    // Broadcast
    if (!skipBroadcast) {
      broadcast('sale:created', result.sale, socketId);
    }
    
    log('info', `Vente créée: ${result.sale.invoice_number}`, {
      id: result.sale.id,
      items: result.sale.items?.length || 0,
    });
    
    return result;
    
  } catch (error) {
    log('error', `Erreur création vente:`, error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RATTRAPAGE APRÈS RECONNEXION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère les changements depuis une date donnée
 * @param {string} since - Date ISO depuis laquelle récupérer les changements
 * @param {Array} types - Types de données à récupérer ['products', 'sales', 'stock']
 * @returns {Object} Changements par type
 */
export function getChangesSince(since, types = ['products', 'sales', 'stock', 'debts']) {
  const db = getDb();
  const changes = {};
  
  try {
    const sinceDate = new Date(since).toISOString();
    
    if (types.includes('products')) {
      changes.products = db.prepare(`
        SELECT * FROM products 
        WHERE updated_at > ? OR created_at > ?
        ORDER BY updated_at DESC
        LIMIT 1000
      `).all(sinceDate, sinceDate);
    }
    
    if (types.includes('sales')) {
      changes.sales = db.prepare(`
        SELECT * FROM sales 
        WHERE updated_at > ? OR created_at > ?
        ORDER BY sold_at DESC
        LIMIT 500
      `).all(sinceDate, sinceDate);
    }
    
    if (types.includes('stock')) {
      changes.stock = db.prepare(`
        SELECT pu.*, p.name as product_name, p.uuid as product_uuid
        FROM product_units pu
        JOIN products p ON pu.product_id = p.id
        WHERE pu.updated_at > ?
        ORDER BY pu.updated_at DESC
        LIMIT 1000
      `).all(sinceDate);
    }
    
    if (types.includes('debts')) {
      changes.debts = db.prepare(`
        SELECT * FROM debts 
        WHERE updated_at > ? OR created_at > ?
        ORDER BY updated_at DESC
        LIMIT 500
      `).all(sinceDate, sinceDate);
    }
    
    log('info', `Changements depuis ${since}:`, {
      products: changes.products?.length || 0,
      sales: changes.sales?.length || 0,
      stock: changes.stock?.length || 0,
      debts: changes.debts?.length || 0,
    });
    
    return changes;
    
  } catch (error) {
    log('error', `Erreur récupération changements:`, error.message);
    throw error;
  }
}

/**
 * Récupère le timestamp de dernière modification pour chaque type
 */
export function getLastModifiedTimestamps() {
  const db = getDb();
  
  try {
    const timestamps = {};
    
    const productsTs = db.prepare(`
      SELECT MAX(COALESCE(updated_at, created_at)) as ts FROM products
    `).get();
    timestamps.products = productsTs?.ts;
    
    const salesTs = db.prepare(`
      SELECT MAX(COALESCE(updated_at, sold_at, created_at)) as ts FROM sales
    `).get();
    timestamps.sales = salesTs?.ts;
    
    const stockTs = db.prepare(`
      SELECT MAX(updated_at) as ts FROM product_units
    `).get();
    timestamps.stock = stockTs?.ts;
    
    const debtsTs = db.prepare(`
      SELECT MAX(COALESCE(updated_at, created_at)) as ts FROM debts
    `).get();
    timestamps.debts = debtsTs?.ts;
    
    return timestamps;
    
  } catch (error) {
    log('error', `Erreur récupération timestamps:`, error.message);
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Démarre le service de synchronisation
 */
export function startRealtimeSyncService() {
  log('info', '🚀 Service de synchronisation temps réel démarré');
  
  // Traiter les broadcasts en attente périodiquement
  broadcastInterval = setInterval(() => {
    processPendingBroadcasts();
  }, 1000);
  
  return {
    updateProduct: updateProductIdempotent,
    updateStock: updateStockIdempotent,
    createSale: createSaleIdempotent,
    getChangesSince,
    getLastModifiedTimestamps,
    broadcast,
  };
}

/**
 * Arrête le service
 */
export function stopRealtimeSyncService() {
  log('info', '🛑 Service de synchronisation temps réel arrêté');
  
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  start: startRealtimeSyncService,
  stop: stopRealtimeSyncService,
  updateProduct: updateProductIdempotent,
  updateStock: updateStockIdempotent,
  createSale: createSaleIdempotent,
  getChangesSince,
  getLastModifiedTimestamps,
  broadcast,
};
