import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';

/**
 * Repository pour la gestion de l'audit
 */
export class AuditRepository {
  /**
   * Enregistre une action d'audit
   */
  log(userId, action, details = {}) {
    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO audit_log (user_id, action, details_json)
        VALUES (?, ?, ?)
      `).run(userId, action, JSON.stringify(details));
    } catch (error) {
      logger.error('Erreur audit log:', error);
      // Ne pas faire échouer l'opération si l'audit échoue
    }
  }

  /**
   * Récupère les logs d'audit
   */
  findAll(filters = {}) {
    const db = getDb();
    try {
      let query = 'SELECT * FROM audit_log WHERE 1=1';
      const params = [];

      if (filters.user_id) {
        query += ' AND user_id = ?';
        params.push(filters.user_id);
      }

      if (filters.action) {
        query += ' AND action = ?';
        params.push(filters.action);
      }

      query += ' ORDER BY at DESC LIMIT 1000';

      return db
        .prepare(query)
        .all(...params)
        .map((row) => ({
          ...row,
          details: row.details_json ? JSON.parse(row.details_json) : null,
        }));
    } catch (error) {
      logger.error('Erreur findAll audit:', error);
      throw error;
    }
  }
}

export const auditRepo = new AuditRepository();

