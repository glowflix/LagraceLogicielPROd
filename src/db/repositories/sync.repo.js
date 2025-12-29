import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';

/**
 * Repository pour la gestion de la synchronisation
 */
export class SyncRepository {
  /**
   * Ajoute une opération à l'outbox
   */
  addToOutbox(entity, entityId, op, payload) {
    const db = getDb();
    try {
      const stmt = db.prepare(`
        INSERT INTO sync_outbox (entity, entity_id, op, payload_json, status)
        VALUES (?, ?, ?, ?, 'pending')
      `);

      stmt.run(entity, entityId, op, JSON.stringify(payload));
    } catch (error) {
      logger.error('Erreur addToOutbox:', error);
      throw error;
    }
  }

  /**
   * Récupère les opérations en attente
   */
  getPending(limit = 50) {
    const db = getDb();
    try {
      return db
        .prepare(`
          SELECT * FROM sync_outbox
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT ?
        `)
        .all(limit)
        .map((row) => ({
          ...row,
          payload: JSON.parse(row.payload_json),
        }));
    } catch (error) {
      logger.error('Erreur getPending:', error);
      throw error;
    }
  }

  /**
   * Marque une opération comme envoyée
   */
  markAsSent(id) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE sync_outbox
        SET status = 'sent', updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
    } catch (error) {
      logger.error('Erreur markAsSent:', error);
      throw error;
    }
  }

  /**
   * Marque une opération comme erreur
   */
  markAsError(id, error) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE sync_outbox
        SET status = 'error', last_error = ?, tries = tries + 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(error.toString(), id);
    } catch (error) {
      logger.error('Erreur markAsError:', error);
      throw error;
    }
  }

  /**
   * Récupère le statut de synchronisation
   */
  getStatus() {
    const db = getDb();
    try {
      // Vérifier si la table existe
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_outbox'")
        .get();
      
      if (!tableExists) {
        return { pending: 0, errors: 0, lastPush: null, lastPull: null };
      }

      const pending = db
        .prepare('SELECT COUNT(*) as count FROM sync_outbox WHERE status = ?')
        .get('pending');

      const errors = db
        .prepare('SELECT COUNT(*) as count FROM sync_outbox WHERE status = ?')
        .get('error');

      const lastSent = db
        .prepare('SELECT updated_at FROM sync_outbox WHERE status = ? ORDER BY updated_at DESC LIMIT 1')
        .get('sent');

      // Récupérer la dernière date de pull depuis settings
      const lastPullSetting = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('last_pull_date');

      return {
        pending: pending.count,
        errors: errors.count,
        lastPush: lastSent?.updated_at || null,
        lastPull: lastPullSetting?.value || null,
      };
    } catch (error) {
      logger.error('Erreur getStatus:', error);
      return { pending: 0, errors: 0, lastPush: null, lastPull: null };
    }
  }

  /**
   * Récupère la dernière date de pull pour une entité
   */
  getLastPullDate(entity) {
    const db = getDb();
    try {
      const setting = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(`last_pull_${entity}`);
      
      if (setting && setting.value) {
        return new Date(setting.value);
      }
      
      // Si pas de date, retourner une date très ancienne pour tout importer
      return new Date(0);
    } catch (error) {
      logger.error('Erreur getLastPullDate:', error);
      return new Date(0);
    }
  }

  /**
   * Définit la dernière date de pull pour une entité
   */
  setLastPullDate(entity, dateISO) {
    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = datetime('now')
      `).run(`last_pull_${entity}`, dateISO);
      
      // Mettre à jour aussi la date globale
      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = datetime('now')
      `).run('last_pull_date', dateISO);
    } catch (error) {
      logger.error('Erreur setLastPullDate:', error);
    }
  }

  /**
   * Vérifie si l'import initial a été fait (basé sur Products réussi)
   */
  isInitialImportDone() {
    const db = getDb();
    try {
      const setting = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('initial_import_done');
      
      return setting && setting.value === '1';
    } catch (error) {
      logger.error('Erreur isInitialImportDone:', error);
      return false;
    }
  }

  /**
   * Marque l'import initial comme terminé (quand Products a réussi)
   */
  setInitialImportDone() {
    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = datetime('now')
      `).run('initial_import_done', '1');
      
      logger.info('✅ Import initial marqué comme terminé');
    } catch (error) {
      logger.error('Erreur setInitialImportDone:', error);
    }
  }

  /**
   * Récupère le cursor de pagination pour une entité
   */
  getCursor(entity, unitLevel = null) {
    const db = getDb();
    try {
      const key = unitLevel ? `cursor_${entity}_${unitLevel}` : `cursor_${entity}`;
      const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return setting && setting.value ? parseInt(setting.value, 10) : null;
    } catch (error) {
      logger.error('Erreur getCursor:', error);
      return null;
    }
  }

  /**
   * Définit le cursor de pagination pour une entité
   */
  setCursor(entity, cursor, unitLevel = null) {
    const db = getDb();
    try {
      const key = unitLevel ? `cursor_${entity}_${unitLevel}` : `cursor_${entity}`;
      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = datetime('now')
      `).run(key, cursor ? cursor.toString() : '');
    } catch (error) {
      logger.error('Erreur setCursor:', error);
    }
  }

  /**
   * Réinitialise tous les cursors (pour full import)
   */
  resetAllCursors() {
    const db = getDb();
    try {
      db.prepare(`
        DELETE FROM settings
        WHERE key LIKE 'cursor_%'
      `).run();
      logger.info('✅ Tous les cursors réinitialisés');
    } catch (error) {
      logger.error('Erreur resetAllCursors:', error);
    }
  }

  /**
   * Vérifie si un produit ou une unité est en pending (modifications locales non synchronisées)
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité (optionnel, pour vérifier une unité spécifique)
   * @returns {boolean} true si le produit/unité est en pending
   */
  isProductPending(productCode, unitLevel = null) {
    const db = getDb();
    try {
      if (unitLevel) {
        // Vérifier si l'unité spécifique est en pending
        const pending = db.prepare(`
          SELECT COUNT(*) as count
          FROM sync_outbox
          WHERE status = 'pending'
            AND (
              (entity = 'products' AND entity_id = ?)
              OR (entity = 'product_units' AND entity_id LIKE ?)
            )
        `).get(productCode, `${productCode}-${unitLevel}%`);
        return pending.count > 0;
      } else {
        // Vérifier si le produit ou une de ses unités est en pending
        const pending = db.prepare(`
          SELECT COUNT(*) as count
          FROM sync_outbox
          WHERE status = 'pending'
            AND (
              (entity = 'products' AND entity_id = ?)
              OR (entity = 'product_units' AND entity_id LIKE ?)
            )
        `).get(productCode, `${productCode}-%`);
        return pending.count > 0;
      }
    } catch (error) {
      logger.error('Erreur isProductPending:', error);
      // En cas d'erreur, considérer comme non-pending pour éviter de bloquer la sync
      return false;
    }
  }

  /**
   * Vérifie si une unité spécifique est en pending
   * @param {string} productCode - Code du produit
   * @param {string} unitLevel - Niveau d'unité
   * @param {string} unitMark - Mark de l'unité (optionnel)
   * @returns {boolean} true si l'unité est en pending
   */
  isUnitPending(productCode, unitLevel, unitMark = '') {
    const db = getDb();
    try {
      const entityId = `${productCode}-${unitLevel}${unitMark ? `-${unitMark}` : ''}`;
      const pending = db.prepare(`
        SELECT COUNT(*) as count
        FROM sync_outbox
        WHERE status = 'pending'
          AND entity = 'product_units'
          AND entity_id LIKE ?
      `).get(`${entityId}%`);
      return pending.count > 0;
    } catch (error) {
      logger.error('Erreur isUnitPending:', error);
      return false;
    }
  }
}

export const syncRepo = new SyncRepository();

