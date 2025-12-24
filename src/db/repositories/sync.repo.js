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
}

export const syncRepo = new SyncRepository();

