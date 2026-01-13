import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRINT JOBS REPOSITORY - Version ULTRA-OPTIMISÉE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ⚠️  IMPORTANT: Le retry est UNIQUEMENT pour les ERREURS d'impression !
 * - Si l'impression RÉUSSIT → status = 'printed', FIN (pas de retry)
 * - Si l'impression ÉCHOUE → retry jusqu'à MAX_ATTEMPTS
 * - Une facture N'EST JAMAIS imprimée plusieurs fois si elle réussit
 * 
 * Améliorations:
 * - ⚡ Création rapide sans logs excessifs
 * - 🔄 Retry UNIQUEMENT en cas d'ERREUR (pas de double impression)
 * - ⏱️  Timeout pour jobs bloqués (relance si pas de réponse)
 * - 📊 Priorité pour jobs urgents
 * - 🧹 Nettoyage automatique des vieux jobs
 */

// Configuration
const CONFIG = {
  MAX_ATTEMPTS: 3,            // Max 3 tentatives EN CAS D'ERREUR
  RETRY_DELAYS: [2000, 5000, 10000], // Délais entre retry: 2s, 5s, 10s
  JOB_TIMEOUT_MS: 60000,      // 60s max par job (temps pour imprimer)
  STALE_JOB_HOURS: 24,        // Jobs > 24h considérés comme abandonnés
  CLEANUP_DAYS: 7,            // Supprimer jobs > 7 jours
};

// ══════════════════════════════════════════════════════════════════════════════
// ✅ AUTO-MIGRATION: Ajoute les colonnes manquantes au démarrage
// ══════════════════════════════════════════════════════════════════════════════
let migrationApplied = false;

function ensurePrintJobsColumns() {
  if (migrationApplied) return;
  
  const db = getDb();
  try {
    // Vérifier si la table existe
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='print_jobs'
    `).get();
    
    if (!tableExists) {
      logger.debug('[PRINT-JOBS] Table print_jobs n\'existe pas encore');
      migrationApplied = true;
      return;
    }
    
    // Vérifier les colonnes existantes
    const columns = db.prepare('PRAGMA table_info(print_jobs)').all();
    const columnNames = columns.map(c => c.name);
    
    // Ajouter priority si manquante
    if (!columnNames.includes('priority')) {
      logger.info('[PRINT-JOBS] ✅ Migration: Ajout colonne priority...');
      db.exec('ALTER TABLE print_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
      logger.info('[PRINT-JOBS] ✅ Colonne priority ajoutée');
    }
    
    // Ajouter retry_at si manquante
    if (!columnNames.includes('retry_at')) {
      logger.info('[PRINT-JOBS] ✅ Migration: Ajout colonne retry_at...');
      db.exec('ALTER TABLE print_jobs ADD COLUMN retry_at TEXT');
      logger.info('[PRINT-JOBS] ✅ Colonne retry_at ajoutée');
    }
    
    // Créer les index si nécessaires
    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_print_jobs_priority ON print_jobs(priority DESC, created_at ASC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_print_jobs_retry ON print_jobs(status, retry_at)');
    } catch (e) {
      // Ignorer si déjà existants
    }
    
    migrationApplied = true;
    logger.info('[PRINT-JOBS] ✅ Migration print_jobs vérifiée/appliquée');
  } catch (error) {
    logger.error('[PRINT-JOBS] ❌ Erreur migration:', error.message);
    // Ne pas bloquer, marquer comme appliqué pour éviter boucle
    migrationApplied = true;
  }
}

export class PrintJobsRepository {
  constructor() {
    // ✅ Appliquer migration au premier accès
    ensurePrintJobsColumns();
  }
  /**
   * ⚠️  Vérifie si une facture a déjà été imprimée avec succès
   * Empêche les doubles impressions
   */
  isAlreadyPrinted(invoiceNumber) {
    const db = getDb();
    try {
      const job = db.prepare(`
        SELECT id FROM print_jobs 
        WHERE invoice_number = ? AND status = 'printed'
        LIMIT 1
      `).get(invoiceNumber);
      return !!job;
    } catch (error) {
      return false;
    }
  }

  /**
   * Crée un nouveau job d'impression (ULTRA-RAPIDE)
   * 
   * ⚠️  SÉCURITÉ: Vérifie que la facture n'a pas déjà été imprimée
   */
  create(printJobData) {
    const db = getDb();
    try {
      // ⚠️  SÉCURITÉ: Vérifier si déjà imprimé
      if (this.isAlreadyPrinted(printJobData.invoice_number)) {
        logger.warn(`⚠️  [PRINT] Facture ${printJobData.invoice_number} déjà imprimée, pas de nouveau job`);
        return this.findByInvoice(printJobData.invoice_number);
      }

      // ⚡ Log minimal pour vitesse maximale
      logger.debug(`🖨️  [PRINT] Création job: ${printJobData.invoice_number}`);
      
      const stmt = db.prepare(`
        INSERT INTO print_jobs (
          invoice_number, template, payload_json, status, priority
        )
        VALUES (?, ?, ?, 'pending', ?)
      `);

      const result = stmt.run(
        printJobData.invoice_number,
        printJobData.template || 'receipt-80',
        JSON.stringify(printJobData.payload_json || {}),
        printJobData.priority || 0 // 0=normal, 1=haute, 2=urgente
      );
      
      logger.info(`✅ [PRINT] Job #${result.lastInsertRowid} créé: ${printJobData.invoice_number}`);

      return this.findByInvoice(printJobData.invoice_number);
    } catch (error) {
      logger.error(`❌ [PRINT] Erreur création job ${printJobData.invoice_number}:`, error.message);
      throw error;
    }
  }

  /**
   * Trouve un job par numéro de facture
   */
  findByInvoice(invoiceNumber) {
    const db = getDb();
    try {
      const job = db
        .prepare('SELECT * FROM print_jobs WHERE invoice_number = ? ORDER BY created_at DESC LIMIT 1')
        .get(invoiceNumber);
      
      if (!job) return null;
      
      return {
        ...job,
        payload_json: JSON.parse(job.payload_json || '{}'),
      };
    } catch (error) {
      logger.error('Erreur findByInvoice print_job:', error);
      return null;
    }
  }

  /**
   * Récupère les jobs en attente
   */
  getPending(limit = 10) {
    const db = getDb();
    try {
      return db
        .prepare(`
          SELECT * FROM print_jobs
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT ?
        `)
        .all(limit)
        .map((row) => ({
          ...row,
          payload_json: JSON.parse(row.payload_json || '{}'),
        }));
    } catch (error) {
      logger.error('Erreur getPending print_jobs:', error);
      return [];
    }
  }

  /**
   * Marque un job comme en cours de traitement
   */
  markProcessing(id) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE print_jobs
        SET status = 'processing', updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
    } catch (error) {
      logger.error('Erreur markProcessing print_job:', error);
      throw error;
    }
  }

  /**
   * Marque un job comme imprimé
   */
  markPrinted(id) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE print_jobs
        SET status = 'printed', printed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
    } catch (error) {
      logger.error('Erreur markPrinted print_job:', error);
      throw error;
    }
  }

  /**
   * Marque un job comme erreur
   */
  markError(id, errorMessage) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE print_jobs
        SET status = 'error', last_error = ?, attempts = attempts + 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(errorMessage || 'Erreur inconnue', id);
    } catch (error) {
      logger.error('Erreur markError print_job:', error);
      throw error;
    }
  }

  /**
   * Récupère le statut d'impression pour une facture
   */
  getStatus(invoiceNumber) {
    const job = this.findByInvoice(invoiceNumber);
    if (!job) return { status: 'none', message: 'Aucun job trouvé' };
    
    return {
      status: job.status,
      attempts: job.attempts,
      last_error: job.last_error,
      created_at: job.created_at,
      printed_at: job.printed_at,
      // ⚡ Ajouter info retry
      canRetry: job.attempts < CONFIG.MAX_ATTEMPTS,
      nextRetryDelay: CONFIG.RETRY_DELAYS[job.attempts] || CONFIG.RETRY_DELAYS[CONFIG.RETRY_DELAYS.length - 1],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUVELLES MÉTHODES - Optimisations pour fiabilité et vitesse
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ⚡ Récupère les jobs en attente avec priorité (jobs urgents d'abord)
   * 
   * ⚠️  NE RETOURNE JAMAIS les jobs déjà imprimés (status = 'printed')
   */
  getPendingWithPriority(limit = 10) {
    const db = getDb();
    try {
      return db
        .prepare(`
          SELECT * FROM print_jobs
          WHERE status IN ('pending', 'retry')
          AND status != 'printed'
          AND attempts < ?
          ORDER BY priority DESC, created_at ASC
          LIMIT ?
        `)
        .all(CONFIG.MAX_ATTEMPTS, limit)
        .map((row) => ({
          ...row,
          payload_json: JSON.parse(row.payload_json || '{}'),
        }));
    } catch (error) {
      logger.error('❌ [PRINT] Erreur getPendingWithPriority:', error.message);
      return [];
    }
  }

  /**
   * 🔄 Marque un job pour retry (UNIQUEMENT en cas d'ERREUR)
   * 
   * ⚠️  IMPORTANT: Cette méthode ne doit être appelée QUE si:
   * - L'imprimante n'a pas répondu
   * - L'impression a échoué (erreur matérielle)
   * - Le job est en timeout
   * 
   * NE PAS appeler si l'impression a RÉUSSI !
   */
  markForRetry(id, errorMessage) {
    const db = getDb();
    try {
      const job = db.prepare('SELECT attempts, status FROM print_jobs WHERE id = ?').get(id);
      if (!job) return false;

      // ⚠️  SÉCURITÉ: NE JAMAIS retry un job déjà imprimé !
      if (job.status === 'printed') {
        logger.warn(`⚠️  [PRINT] Job #${id} déjà imprimé, pas de retry`);
        return false;
      }

      const nextAttempt = job.attempts + 1;
      const canRetry = nextAttempt < CONFIG.MAX_ATTEMPTS;

      if (canRetry) {
        const retryDelay = CONFIG.RETRY_DELAYS[job.attempts] || 10000;
        const retryAt = new Date(Date.now() + retryDelay).toISOString();
        
        db.prepare(`
          UPDATE print_jobs
          SET status = 'retry', 
              last_error = ?, 
              attempts = ?,
              retry_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND status != 'printed'
        `).run(errorMessage, nextAttempt, retryAt, id);
        
        logger.info(`🔄 [PRINT] Job #${id} planifié pour retry dans ${retryDelay/1000}s (tentative ${nextAttempt}/${CONFIG.MAX_ATTEMPTS})`);
        return true;
      } else {
        // Max tentatives atteint → erreur définitive (pas d'impression)
        this.markError(id, `Échec après ${CONFIG.MAX_ATTEMPTS} tentatives: ${errorMessage}`);
        return false;
      }
    } catch (error) {
      logger.error('❌ [PRINT] Erreur markForRetry:', error.message);
      return false;
    }
  }

  /**
   * ⏱️  Récupère les jobs prêts pour retry (délai écoulé)
   * 
   * ⚠️  NE RETOURNE JAMAIS les jobs déjà imprimés
   */
  getReadyForRetry(limit = 5) {
    const db = getDb();
    try {
      const now = new Date().toISOString();
      return db
        .prepare(`
          SELECT * FROM print_jobs
          WHERE status = 'retry'
          AND status != 'printed'
          AND (retry_at IS NULL OR retry_at <= ?)
          AND attempts < ?
          ORDER BY priority DESC, retry_at ASC
          LIMIT ?
        `)
        .all(now, CONFIG.MAX_ATTEMPTS, limit)
        .map((row) => ({
          ...row,
          payload_json: JSON.parse(row.payload_json || '{}'),
        }));
    } catch (error) {
      logger.error('❌ [PRINT] Erreur getReadyForRetry:', error.message);
      return [];
    }
  }

  /**
   * 🧹 Nettoie les jobs bloqués (processing depuis trop longtemps)
   * 
   * ⚠️  IMPORTANT: Ne retry que les jobs en 'processing' qui n'ont pas répondu
   * Les jobs 'printed' ne sont JAMAIS retouchés
   */
  cleanupStaleJobs() {
    const db = getDb();
    try {
      // Jobs processing depuis > JOB_TIMEOUT_MS → retry SEULEMENT si pas printed
      const staleTime = new Date(Date.now() - CONFIG.JOB_TIMEOUT_MS).toISOString();
      
      // ⚠️  Exclure les jobs déjà imprimés
      const staleJobs = db.prepare(`
        SELECT id, status FROM print_jobs
        WHERE status = 'processing'
        AND updated_at < ?
      `).all(staleTime);

      let retried = 0;
      for (const job of staleJobs) {
        // Double vérification: ne jamais retry un job imprimé
        if (job.status !== 'printed') {
          this.markForRetry(job.id, 'Job timeout - aucune réponse de l\'imprimante');
          retried++;
        }
      }

      if (retried > 0) {
        logger.info(`🧹 [PRINT] ${retried} job(s) bloqué(s) remis en queue`);
      }

      return retried;
    } catch (error) {
      logger.error('❌ [PRINT] Erreur cleanupStaleJobs:', error.message);
      return 0;
    }
  }

  /**
   * 🧹 Supprime les vieux jobs (> CLEANUP_DAYS jours)
   */
  cleanupOldJobs() {
    const db = getDb();
    try {
      const cutoffDate = new Date(Date.now() - CONFIG.CLEANUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
      
      const result = db.prepare(`
        DELETE FROM print_jobs
        WHERE created_at < ?
        AND status IN ('printed', 'error')
      `).run(cutoffDate);

      if (result.changes > 0) {
        logger.info(`🧹 [PRINT] ${result.changes} vieux job(s) supprimé(s)`);
      }

      return result.changes;
    } catch (error) {
      logger.error('❌ [PRINT] Erreur cleanupOldJobs:', error.message);
      return 0;
    }
  }

  /**
   * 📊 Statistiques des jobs d'impression
   */
  getStats() {
    const db = getDb();
    try {
      const stats = db.prepare(`
        SELECT 
          status,
          COUNT(*) as count
        FROM print_jobs
        GROUP BY status
      `).all();

      const result = {
        pending: 0,
        processing: 0,
        retry: 0,
        printed: 0,
        error: 0,
        total: 0,
      };

      for (const row of stats) {
        result[row.status] = row.count;
        result.total += row.count;
      }

      return result;
    } catch (error) {
      logger.error('❌ [PRINT] Erreur getStats:', error.message);
      return { pending: 0, processing: 0, retry: 0, printed: 0, error: 0, total: 0 };
    }
  }

  /**
   * ⚡ Création rapide avec haute priorité (pour ventes)
   */
  createUrgent(printJobData) {
    return this.create({
      ...printJobData,
      priority: 2, // Priorité maximale
    });
  }
}

export const printJobsRepo = new PrintJobsRepository();

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG EXPORTÉE pour utilisation dans d'autres modules
// ═══════════════════════════════════════════════════════════════════════════
export { CONFIG as PRINT_CONFIG };

