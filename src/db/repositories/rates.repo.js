import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

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

  /**
   * ✅ PRO: Récupère tous les taux de la base locale
   */
  getAll() {
    const db = getDb();
    try {
      return db.prepare('SELECT * FROM exchange_rates ORDER BY effective_at DESC').all();
    } catch (error) {
      logger.error('Erreur getAll rates:', error);
      return [];
    }
  }

  /**
   * ✅ PRO: Upsert des taux depuis Google Sheets
   * Gère les taux avec ou sans UUID
   * @param {Array} rates - Liste des taux depuis Sheets
   * @returns {Object} - { inserted, updated, latestRate }
   */
  upsertFromSheets(rates) {
    if (!rates || !Array.isArray(rates) || rates.length === 0) {
      return { inserted: 0, updated: 0, latestRate: null };
    }

    const db = getDb();
    let inserted = 0;
    let updated = 0;
    let latestRate = null;
    let latestDate = null;

    const transaction = db.transaction(() => {
      for (const rate of rates) {
        try {
          // Parser le taux - priorité: Taux > rate_fc_per_usd
          let rateValue = parseFloat(rate.Taux || rate.taux || rate.rate_fc_per_usd || 0);
          
          // Valider le taux
          if (!rateValue || rateValue <= 0 || isNaN(rateValue)) {
            continue;
          }

          // Parser la date - plusieurs formats possibles
          let effectiveAt = rate.DATE || rate.date || rate.effective_at || new Date().toISOString();
          
          // Normaliser la date en ISO
          if (typeof effectiveAt === 'string') {
            // Gérer formats: "DD/MM/YYYY", "DD/MM/YYYY HH:mm:ss", "YYYY-MM-DD", ISO
            if (effectiveAt.includes('/')) {
              // Format DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
              const parts = effectiveAt.split(' ');
              const datePart = parts[0].split('/');
              if (datePart.length === 3) {
                const day = datePart[0].padStart(2, '0');
                const month = datePart[1].padStart(2, '0');
                const year = datePart[2];
                const timePart = parts[1] || '00:00:00';
                effectiveAt = `${year}-${month}-${day}T${timePart}.000Z`;
              }
            } else if (!effectiveAt.includes('T')) {
              // Format YYYY-MM-DD sans T
              effectiveAt = `${effectiveAt}T00:00:00.000Z`;
            }
            
            // Valider la date
            const testDate = new Date(effectiveAt);
            if (isNaN(testDate.getTime())) {
              effectiveAt = new Date().toISOString();
            }
          }

          // UUID - générer si manquant
          let uuid = (rate._uuid || rate.uuid || '').trim();
          if (!uuid) {
            // Générer un UUID basé sur la date et le taux pour éviter les doublons
            uuid = generateUUID();
          }

          // Vérifier si ce taux existe déjà (par UUID ou par date+taux)
          const existing = db.prepare(`
            SELECT id, rate_fc_per_usd, effective_at 
            FROM exchange_rates 
            WHERE id = (
              SELECT id FROM exchange_rates 
              WHERE (effective_at = ? AND rate_fc_per_usd = ?)
              LIMIT 1
            )
          `).get(effectiveAt, rateValue);

          if (existing) {
            // Déjà présent - on ne met pas à jour (taux identique)
            // updated++ si on veut compter
          } else {
            // Insérer le nouveau taux
            db.prepare(`
              INSERT INTO exchange_rates (rate_fc_per_usd, effective_at, created_at, synced_at)
              VALUES (?, ?, datetime('now'), datetime('now'))
            `).run(rateValue, effectiveAt);
            inserted++;
          }

          // Tracker le taux le plus récent
          const rateDate = new Date(effectiveAt);
          if (!latestDate || rateDate > latestDate) {
            latestDate = rateDate;
            latestRate = rateValue;
          }

        } catch (error) {
          logger.warn(`Erreur upsert taux: ${error.message}`);
        }
      }

      // ✅ Mettre à jour le setting avec le dernier taux
      if (latestRate && latestRate > 0) {
        db.prepare(`
          INSERT INTO settings (key, value, updated_at)
          VALUES ('exchange_rate_fc_per_usd', ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')
        `).run(latestRate.toString());
      }
    });

    transaction();

    return { inserted, updated, latestRate };
  }

  /**
   * ✅ PRO: Récupère le dernier taux avec sa date
   */
  getLatest() {
    const db = getDb();
    try {
      const rate = db
        .prepare('SELECT * FROM exchange_rates ORDER BY effective_at DESC LIMIT 1')
        .get();
      return rate || null;
    } catch (error) {
      logger.error('Erreur getLatest rate:', error);
      return null;
    }
  }
}

export const ratesRepo = new RatesRepository();

