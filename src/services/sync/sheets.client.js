import axios from 'axios';
import { logger } from '../../core/logger.js';
import { syncLogger } from '../../core/logger.js';

/**
 * Client pour communiquer avec Google Apps Script
 */
export class SheetsClient {
  /**
   * Récupère l'URL du Google Apps Script Web App
   */
  getWebAppUrl() {
    return process.env.GOOGLE_SHEETS_WEBAPP_URL;
  }

  /**
   * Push une opération vers Google Sheets
   */
  async push(entity, entityId, op, payload) {
    const GOOGLE_SHEETS_WEBAPP_URL = this.getWebAppUrl();
    
    if (!GOOGLE_SHEETS_WEBAPP_URL) {
      syncLogger.warn('GOOGLE_SHEETS_WEBAPP_URL non configuré, skip push');
      return { success: false, error: 'URL non configurée' };
    }

    try {
      const response = await axios.post(GOOGLE_SHEETS_WEBAPP_URL, {
        entity,
        entity_id: entityId,
        op,
        payload,
      });

      if (response.data.success) {
        syncLogger.info(`Push réussi: ${entity}/${entityId}`);
        return { success: true, result: response.data.result };
      } else {
        syncLogger.error(`Push échoué: ${response.data.error}`);
        return { success: false, error: response.data.error };
      }
    } catch (error) {
      syncLogger.error(`Erreur push ${entity}/${entityId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Pull les données depuis Google Sheets
   */
  async pull(entity, since) {
    const GOOGLE_SHEETS_WEBAPP_URL = this.getWebAppUrl();
    
    if (!GOOGLE_SHEETS_WEBAPP_URL) {
      syncLogger.warn('GOOGLE_SHEETS_WEBAPP_URL non configuré, skip pull');
      return { success: false, data: [] };
    }

    try {
      const sinceDate = since ? (typeof since === 'string' ? since : since.toISOString()) : new Date(0).toISOString();
      syncLogger.info(`📥 Pull ${entity} depuis Google Sheets (since: ${sinceDate})`);
      syncLogger.debug(`   URL utilisée: ${GOOGLE_SHEETS_WEBAPP_URL}`);
      
      // Timeout plus long pour products et sales (beaucoup de données)
      const timeout = (entity === 'products' || entity === 'sales') ? 120000 : 30000; // 2 minutes pour products/sales, 30s pour les autres
      syncLogger.info(`   ⏱️  Timeout configuré: ${timeout / 1000}s pour ${entity}`);
      
      const response = await axios.get(GOOGLE_SHEETS_WEBAPP_URL, {
        params: {
          entity,
          since: sinceDate,
        },
        timeout: timeout,
      });

      if (response.data.success) {
        const count = response.data.count || (response.data.data ? response.data.data.length : 0);
        syncLogger.info(`✅ Pull réussi: ${entity} → ${count} item(s) reçu(s)`);
        
        if (count > 0 && response.data.data) {
          syncLogger.debug(`   Format des données: ${Array.isArray(response.data.data) ? 'array' : typeof response.data.data}`);
          if (response.data.data.length > 0) {
            syncLogger.debug(`   Premier élément: ${JSON.stringify(response.data.data[0]).substring(0, 200)}...`);
          }
        }
        
        return { success: true, data: response.data.data || [] };
      } else {
        syncLogger.error(`❌ Pull échoué: ${entity} - ${response.data.error}`);
        return { success: false, data: [] };
      }
    } catch (error) {
      syncLogger.error(`❌ Erreur pull ${entity}: ${error.message}`);
      if (error.response) {
        syncLogger.error(`   Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      }
      return { success: false, data: [] };
    }
  }
}

export const sheetsClient = new SheetsClient();

