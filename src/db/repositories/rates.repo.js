import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';

/**
 * Repository pour la gestion des taux de change
 */
export class RatesRepository {
  /**
   * Récupère le taux actuel
   */
  getCurrent() {
    const db = getDb();
    try {
      // D'abord vérifier dans settings
      const setting = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('exchange_rate_fc_per_usd');

      if (setting) {
        return parseFloat(setting.value);
      }

      // Sinon, prendre le dernier taux enregistré
      const rate = db
        .prepare('SELECT * FROM exchange_rates ORDER BY effective_at DESC LIMIT 1')
        .get();

      return rate ? rate.rate_fc_per_usd : 2800; // Valeur par défaut
    } catch (error) {
      logger.error('Erreur getCurrent rate:', error);
      return 2800;
    }
  }

  /**
   * Met à jour le taux actuel
   */
  updateCurrent(rate, userId) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        // Mettre à jour le setting
        db.prepare(`
          INSERT INTO settings (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')
        `).run('exchange_rate_fc_per_usd', rate.toString());

        // Créer un historique
        db.prepare(`
          INSERT INTO exchange_rates (rate_fc_per_usd, effective_at, created_by)
          VALUES (?, datetime('now'), ?)
        `).run(rate, userId || null);

        return rate;
      } catch (error) {
        logger.error('Erreur updateCurrent rate:', error);
        throw error;
      }
    });

    return transaction();
  }
}

export const ratesRepo = new RatesRepository();

