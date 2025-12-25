import axios from 'axios';
import http from 'http';
import https from 'https';
import { syncLogger } from '../../core/logger.js';

const VERBOSE = process.env.SYNC_VERBOSE === '1';

// Timeouts recommandés pour une sync fréquente (10s)
// Ajustez par ENV si besoin.
const TIMEOUTS = {
  users:   parseInt(process.env.SHEETS_TIMEOUT_USERS_MS || '6000', 10),
  rates:   parseInt(process.env.SHEETS_TIMEOUT_RATES_MS || '6000', 10),
  debts:   parseInt(process.env.SHEETS_TIMEOUT_DEBTS_MS || '7000', 10),
  products:parseInt(process.env.SHEETS_TIMEOUT_PRODUCTS_MS || '30000', 10), // 30s pour products
  sales:   parseInt(process.env.SHEETS_TIMEOUT_SALES_MS || '30000', 10),   // 30s pour sales
};

const DEFAULT_TIMEOUT_MS = parseInt(process.env.SHEETS_TIMEOUT_DEFAULT_MS || '7000', 10);

// Concurrence (évite de bombarder Apps Script)
const PULL_CONCURRENCY = parseInt(process.env.SHEETS_PULL_CONCURRENCY || '3', 10);
const PUSH_CONCURRENCY = parseInt(process.env.SHEETS_PUSH_CONCURRENCY || '5', 10);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runPool(items, concurrency, fn) {
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/**
 * Client professionnel pour communiquer avec Google Apps Script
 * Optimisé pour synchronisation rapide (< 10s par cycle)
 */
export class SheetsClient {
  constructor() {
    // Keep-alive: très important pour des calls fréquents
    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
    this.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
    this.axios = axios.create({
      timeout: DEFAULT_TIMEOUT_MS,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        // compression si supportée
        'Accept-Encoding': 'gzip, deflate, br',
      },
      // Ne pas throw sur 4xx, on gère nous-mêmes
      validateStatus: (status) => status < 500,
    });
  }

  getWebAppUrl() {
    return process.env.GOOGLE_SHEETS_WEBAPP_URL;
  }

  /**
   * PUSH 1 opération (fallback / compatibilité)
   */
  async push(entity, entityId, op, payload, options = {}) {
    const url = this.getWebAppUrl();
    if (!url) {
      if (VERBOSE) syncLogger.warn('GOOGLE_SHEETS_WEBAPP_URL non configuré, skip push');
      return { success: false, error: 'URL non configurée' };
    }

    const timeout = options.timeout ?? (TIMEOUTS[entity] || DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.axios.post(
        url,
        { entity, entity_id: entityId, op, payload },
        { timeout }
      );

      if (res?.data?.success) {
        if (VERBOSE) syncLogger.info(`✅ push OK ${entity}/${entityId}`);
        return { success: true, result: res.data.result };
      }

      const err = res?.data?.error || `HTTP ${res.status}`;
      if (VERBOSE) syncLogger.warn(`❌ push FAIL ${entity}/${entityId}: ${err}`);
      return { success: false, error: err };
    } catch (e) {
      if (VERBOSE) syncLogger.warn(`❌ push ERROR ${entity}/${entityId}: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  /**
   * PUSH BATCH (si votre Apps Script supporte action=batchPush)
   * Sinon fallback: push en concurrence limitée.
   */
  async pushBatch(ops, options = {}) {
    const url = this.getWebAppUrl();
    if (!url) {
      if (VERBOSE) syncLogger.warn('GOOGLE_SHEETS_WEBAPP_URL non configuré, skip pushBatch');
      return { success: false, error: 'URL non configurée', applied: [], conflicts: [] };
    }

    const mode = (process.env.SHEETS_BATCH_MODE || '0') === '1';
    const timeout = options.timeout ?? parseInt(process.env.SHEETS_TIMEOUT_BATCHPUSH_MS || '9000', 10);

    if (mode) {
      // Mode PRO: 1 requête
      try {
        const res = await this.axios.post(
          url,
          {
            action: 'batchPush',
            device_id: process.env.DEVICE_ID || 'PC-1',
            ops
          },
          { timeout }
        );

        if (res?.data?.success) {
          return {
            success: true,
            applied: res.data.applied || [],
            conflicts: res.data.conflicts || [],
            server_time: res.data.server_time || null
          };
        }

        const err = res?.data?.error || `HTTP ${res.status}`;
        if (VERBOSE) syncLogger.warn(`❌ batchPush FAIL: ${err}`);
        return { success: false, error: err, applied: [], conflicts: [] };
      } catch (e) {
        if (VERBOSE) syncLogger.warn(`❌ batchPush ERROR: ${e.message}`);
        return { success: false, error: e.message, applied: [], conflicts: [] };
      }
    }

    // Fallback compatible: pousser en parallèle limité
    const applied = [];
    const conflicts = [];
    await runPool(ops, PUSH_CONCURRENCY, async (op) => {
      const r = await this.push(op.entity, op.entity_id, op.op, op.payload, { timeout: TIMEOUTS[op.entity] });
      if (r.success) applied.push({ op_id: op.op_id || op.id });
      else conflicts.push({ op_id: op.op_id || op.id, error: r.error });
    });

    return { success: true, applied, conflicts, server_time: null };
  }

  /**
   * PULL 1 entité (mode paginé PRO)
   * IMPORTANT: pas de JSON.stringify massif, pas de logs lourds
   */
  async pull(entity, since, options = {}) {
    const url = this.getWebAppUrl();
    if (!url) {
      if (VERBOSE) syncLogger.warn('GOOGLE_SHEETS_WEBAPP_URL non configuré, skip pull');
      return { success: false, data: [], error: 'URL non configurée' };
    }

    const sinceDate =
      since ? (typeof since === 'string' ? since : since.toISOString()) : new Date(0).toISOString();

    const timeout = options.timeout ?? (TIMEOUTS[entity] || DEFAULT_TIMEOUT_MS);
    const maxRetries = options.maxRetries ?? 1; // en sync normale: 1 retry max
    const retryDelay = options.retryDelay ?? 400; // petit délai
    const full = options.full || false;
    const cursor = options.cursor || null;
    const limit = options.limit || 300;
    const unitLevel = options.unitLevel || null;

    let lastErr = null;

    for (let attempt = 1; attempt <= (maxRetries + 1); attempt++) {
      const t0 = Date.now();

      try {
        if (attempt > 1) await sleep(retryDelay);

        const params = { entity, since: sinceDate };
        if (full || cursor) {
          params.full = full ? '1' : '0';
          if (cursor) params.cursor = cursor.toString();
          params.limit = limit.toString();
          if (unitLevel) params.unit_level = unitLevel;
        }

        // Logs DÉTAILLÉS pour diagnostic
        const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
        syncLogger.info(`📥 [${entity.toUpperCase()}] Pull${full ? ' (FULL)' : ''}${cursor ? ` cursor=${cursor}` : ''} | Tentative ${attempt}/${maxRetries + 1}`);
        syncLogger.info(`   🔗 URL: ${fullUrl.substring(0, 200)}${fullUrl.length > 200 ? '...' : ''}`);
        syncLogger.info(`   📅 Since: ${sinceDate} (${new Date(sinceDate).toLocaleString('fr-FR')})`);
        syncLogger.info(`   ⏱️  Timeout: ${timeout}ms`);

        const res = await this.axios.get(url, {
          params,
          timeout,
        });

        const ms = Date.now() - t0;

        // Logs DÉTAILLÉS de la réponse
        syncLogger.info(`   📥 [${entity.toUpperCase()}] Réponse reçue en ${ms}ms`);
        syncLogger.info(`   📊 [${entity.toUpperCase()}] Réponse Apps Script: success=${res?.data?.success}, count=${res?.data?.count || 0}, data.length=${Array.isArray(res?.data?.data) ? res.data.data.length : 'N/A'}`);
        if (res?.data?.error) {
          syncLogger.warn(`   ⚠️  [${entity.toUpperCase()}] Erreur Apps Script: ${res.data.error}`);
        }

        if (res?.data?.success) {
          const data = Array.isArray(res.data.data) ? res.data.data : [];
          const nextCursor = res.data.next_cursor || null;
          const done = res.data.done || false;
          
          syncLogger.info(`✅ [${entity.toUpperCase()}] Pull OK: ${data.length} item(s) en ${ms}ms${nextCursor ? ` | Next cursor: ${nextCursor}` : ''}${done ? ' | ✅ Terminé' : ''}`);
          
          // Logs DÉTAILLÉS des premiers items si disponibles
          if (data.length > 0) {
            syncLogger.info(`   📋 [${entity.toUpperCase()}] Premiers items:`);
            data.slice(0, 3).forEach((item, idx) => {
              if (entity === 'products') {
                syncLogger.info(`      [${idx + 1}] Code: "${item.code || 'N/A'}", Nom: "${item.name || 'N/A'}", Unités: ${item.units?.length || 0}`);
              } else if (entity === 'sales') {
                syncLogger.info(`      [${idx + 1}] Facture: ${item.invoice_number || 'N/A'}, Client: ${item.client_name || 'N/A'}, Date: ${item.sold_at || 'N/A'}`);
              } else if (entity === 'debts') {
                syncLogger.info(`      [${idx + 1}] Client: ${item.client_name || 'N/A'}, Facture: ${item.invoice_number || 'N/A'}, Total: ${item.total_fc || 0} FC`);
              }
            });
          } else {
            syncLogger.warn(`   ⚠️  [${entity.toUpperCase()}] Aucun item retourné (data.length=0) - Vérifier la date 'since' ou les données dans Sheets`);
          }
          
          return { 
            success: true, 
            data,
            next_cursor: nextCursor,
            done: done
          };
        }

        const err = res?.data?.error || `HTTP ${res.status}`;
        lastErr = err;
        syncLogger.warn(`❌ [${entity.toUpperCase()}] Pull FAIL (tentative ${attempt}): ${err}`);

        // 4xx = généralement pas "retryable"
        if (res.status >= 400 && res.status < 500) break;
      } catch (e) {
        lastErr = e.message;
        syncLogger.warn(`❌ [${entity.toUpperCase()}] Pull ERROR (tentative ${attempt}): ${e.message}`);
        // timeout / réseau : retryable
      }
    }

    return { success: false, data: [], error: lastErr || 'Erreur inconnue', next_cursor: null, done: false };
  }

  /**
   * PULL MANY (sans changer Apps Script)
   * Récupère plusieurs entités en pool (concurrence limitée).
   */
  async pullMany(entities, sinceMap, options = {}) {
    const out = [];
    const maxRetries = options.maxRetries ?? 1;

    await runPool(entities, PULL_CONCURRENCY, async (entity) => {
      const since = sinceMap?.[entity] || new Date(0).toISOString();
      const r = await this.pull(entity, since, {
        timeout: TIMEOUTS[entity] || DEFAULT_TIMEOUT_MS,
        maxRetries,
        retryDelay: 400,
        full: options.full || false,
        cursor: options.cursorMap?.[entity] || null,
        limit: options.limit || 300,
        unitLevel: options.unitLevelMap?.[entity] || null
      });
      out.push({ entity, ...r });
    });

    return out;
  }

  /**
   * PULL PAGINÉ (PRO) - Récupère toutes les pages d'une entité avec auto-retry
   * @param {string} entity - Entité à récupérer
   * @param {string} since - Date since
   * @param {Object} options - Options (full, unitLevel, maxRetries, etc.)
   * @returns {Promise<{success: boolean, data: Array, error?: string}>}
   */
  async pullAllPaged(entity, since, options = {}) {
    const url = this.getWebAppUrl();
    if (!url) {
      return { success: false, data: [], error: 'URL non configurée' };
    }

    const full = options.full || false;
    const unitLevel = options.unitLevel || null;
    const limit = options.limit || 300;
    const maxRetries = options.maxRetries || 8;
    const timeout = options.timeout || (TIMEOUTS[entity] || DEFAULT_TIMEOUT_MS);
    
    const sinceDate = since ? (typeof since === 'string' ? since : since.toISOString()) : new Date(0).toISOString();
    const allData = [];
    let cursor = options.startCursor || null;
    let tries = 0;
    let pageCount = 0;

    syncLogger.info(`📥 [${entity.toUpperCase()}] Début pull paginé${full ? ' (FULL IMPORT)' : ''}${unitLevel ? ` | Unit level: ${unitLevel}` : ''}`);

    while (true) {
      try {
        const params = {
          entity,
          since: sinceDate,
          limit: limit.toString()
        };
        
        if (full) params.full = '1';
        if (cursor) params.cursor = cursor.toString();
        if (unitLevel) params.unit_level = unitLevel;

        const t0 = Date.now();
        const res = await this.axios.get(url, { params, timeout });
        const ms = Date.now() - t0;
        pageCount++;

        if (res?.data?.success) {
          const pageData = Array.isArray(res.data.data) ? res.data.data : [];
          const nextCursor = res.data.next_cursor || null;
          const done = res.data.done || false;

          allData.push(...pageData);
          syncLogger.info(`   ✅ [${entity.toUpperCase()}] Page ${pageCount}: ${pageData.length} item(s) en ${ms}ms | Total: ${allData.length}${nextCursor ? ` | Next: ${nextCursor}` : ''}${done ? ' | ✅ Terminé' : ''}`);

          if (done || !nextCursor) {
            syncLogger.info(`✅ [${entity.toUpperCase()}] Pull paginé terminé: ${allData.length} item(s) en ${pageCount} page(s)`);
            return { success: true, data: allData };
          }

          cursor = nextCursor;
          tries = 0; // Reset retry après succès
        } else {
          const err = res?.data?.error || `HTTP ${res.status}`;
          throw new Error(err);
        }
      } catch (e) {
        tries++;
        const waitMs = Math.min(60000, 2000 * Math.pow(1.6, tries)); // Backoff exponentiel
        
        syncLogger.warn(`   ⚠️ [${entity.toUpperCase()}] Erreur page ${pageCount + 1} (tentative ${tries}/${maxRetries}): ${e.message}`);
        
        if (tries >= maxRetries) {
          syncLogger.error(`   ❌ [${entity.toUpperCase()}] Max retries atteint, arrêt du pull paginé`);
          return { 
            success: false, 
            data: allData, // Retourner ce qu'on a récupéré jusqu'ici
            error: `Max retries atteint: ${e.message}`,
            last_cursor: cursor // Pour reprendre plus tard
          };
        }

        syncLogger.info(`   🔄 [${entity.toUpperCase()}] Retry dans ${(waitMs / 1000).toFixed(1)}s...`);
        await sleep(waitMs);
      }
    }
  }

  /**
   * PULL BATCH (si Apps Script supporte action=batchPull)
   * Sinon, vous utilisez pullMany().
   */
  async pullBatch(sinceMap, options = {}) {
    const url = this.getWebAppUrl();
    if (!url) return { success: false, data: {}, error: 'URL non configurée' };

    const mode = (process.env.SHEETS_BATCH_MODE || '0') === '1';
    if (!mode) return { success: false, data: {}, error: 'Batch mode désactivé' };

    const timeout = options.timeout ?? parseInt(process.env.SHEETS_TIMEOUT_BATCHPULL_MS || '9000', 10);

    try {
      const res = await this.axios.get(url, {
        params: { action: 'batchPull', since: JSON.stringify(sinceMap || {}) },
        timeout,
      });

      if (res?.data?.success) {
        return {
          success: true,
          data: res.data.data || {},
          server_time: res.data.server_time || null
        };
      }

      const err = res?.data?.error || `HTTP ${res.status}`;
      return { success: false, data: {}, error: err };
    } catch (e) {
      return { success: false, data: {}, error: e.message };
    }
  }
}

export const sheetsClient = new SheetsClient();
