import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';

/**
 * Repository pour la gestion des jobs d'impression
 */
export class PrintJobsRepository {
  /**
   * Crée un nouveau job d'impression
   */
  create(printJobData) {
    const db = getDb();
    try {
      logger.info('🖨️  [PRINT-JOB-REPO] ==========================================');
      logger.info('🖨️  [PRINT-JOB-REPO] CRÉATION D\'UN JOB D\'IMPRESSION (DB)');
      logger.info('🖨️  [PRINT-JOB-REPO] ==========================================');
      logger.info(`📄 [PRINT-JOB-REPO] Invoice: ${printJobData.invoice_number}`);
      logger.info(`📋 [PRINT-JOB-REPO] Template: ${printJobData.template || 'receipt-80'}`);
      logger.info(`📦 [PRINT-JOB-REPO] Payload size: ${JSON.stringify(printJobData.payload_json || {}).length} bytes`);
      
      const stmt = db.prepare(`
        INSERT INTO print_jobs (
          invoice_number, template, payload_json, status
        )
        VALUES (?, ?, ?, 'pending')
      `);

      const result = stmt.run(
        printJobData.invoice_number,
        printJobData.template || 'receipt-80',
        JSON.stringify(printJobData.payload_json || {}),
      );
      
      logger.info(`✅ [PRINT-JOB-REPO] Job créé en DB avec ID: ${result.lastInsertRowid}`);
      logger.info(`📊 [PRINT-JOB-REPO] Status: pending`);
      logger.info('🖨️  [PRINT-JOB-REPO] ==========================================');

      return this.findByInvoice(printJobData.invoice_number);
    } catch (error) {
      logger.error('❌ [PRINT-JOB-REPO] ==========================================');
      logger.error('❌ [PRINT-JOB-REPO] ERREUR CRÉATION JOB D\'IMPRESSION');
      logger.error('❌ [PRINT-JOB-REPO] ==========================================');
      logger.error(`❌ [PRINT-JOB-REPO] Invoice: ${printJobData.invoice_number}`);
      logger.error(`❌ [PRINT-JOB-REPO] Message: ${error.message}`);
      logger.error(`❌ [PRINT-JOB-REPO] Code: ${error.code || 'N/A'}`);
      logger.error(`❌ [PRINT-JOB-REPO] Stack: ${error.stack}`);
      logger.error('❌ [PRINT-JOB-REPO] ==========================================');
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
    };
  }
}

export const printJobsRepo = new PrintJobsRepository();

