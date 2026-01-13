import axios from 'axios';
import http from 'http';
import https from 'https';
import { syncLogger } from '../../core/logger.js';

// Utilise le système de niveau de log intelligent du syncLogger
const VERBOSE = syncLogger.isVerbose();

// Timeouts recommandés pour une sync fréquente (10s)
// Ajustez par ENV si besoin.
const TIMEOUTS = {
  users:       parseInt(process.env.SHEETS_TIMEOUT_USERS_MS || '6000', 10),
  rates:       parseInt(process.env.SHEETS_TIMEOUT_RATES_MS || '6000', 10),
  debts:       parseInt(process.env.SHEETS_TIMEOUT_DEBTS_MS || '7000', 10),
  products:    parseInt(process.env.SHEETS_TIMEOUT_PRODUCTS_MS || '30000', 10), // 30s pour products
  sales:       parseInt(process.env.SHEETS_TIMEOUT_SALES_MS || '30000', 10),   // 30s pour sales
  stock_move:  parseInt(process.env.SHEETS_TIMEOUT_STOCKMOVE_MS || '15000', 10), // 15s pour stock moves
  stock_moves: parseInt(process.env.SHEETS_TIMEOUT_STOCKMOVE_MS || '15000', 10), // alias
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
   * VERSION OPTIMISÉE: Logs minimaux
   */
  async push(entity, entityId, op, payload, options = {}) {
    const url = this.getWebAppUrl();
    if (!url) {
      syncLogger.warn(`[${entity}] URL non configurée`);
      return { success: false, error: 'URL non configurée' };
    }

    const timeout = options.timeout ?? (TIMEOUTS[entity] || DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.axios.post(url, { entity, entity_id: entityId, op, payload }, { timeout });

      if (res?.data?.success) {
        syncLogger.incrementPushed(entity);
        syncLogger.verbose(`📤 [${entity}] ↑1 OK`);
        return { success: true, result: res.data.result };
      }

      const err = res?.data?.error || `HTTP ${res.status}`;
      syncLogger.incrementErrors(entity);
      return { success: false, error: err };
    } catch (e) {
      syncLogger.incrementErrors(entity);
      return { success: false, error: e.message };
    }
  }

  /**
   * PUSH BATCH - VERSION OPTIMISÉE
   * Logs résumés uniquement, pas de détail par opération
   */
  async pushBatch(ops, options = {}) {
    const url = this.getWebAppUrl();
    if (!url) {
      syncLogger.warn('[BATCH] URL non configurée');
      return { success: false, error: 'URL non configurée', applied: [], conflicts: [], failed: [], stats: {} };
    }

    // ✅ PRO: Toujours utiliser le batch mode pour plus de fiabilité
    const mode = true; // (process.env.SHEETS_BATCH_MODE || '0') === '1';
    // ✅ PRO: Timeout 60s pour permettre traitement de gros batches
    const timeout = options.timeout ?? parseInt(process.env.SHEETS_TIMEOUT_BATCHPUSH_MS || '60000', 10);
    const t0 = Date.now();

    // ✅ PRO: Log visible dans le terminal
    console.log(`   📡 pushBatch: ${ops.length} ops vers ${url.substring(0, 50)}...`);

    if (mode) {
      try {
        const res = await this.axios.post(url, {
          action: 'batchPush',
          device_id: process.env.DEVICE_ID || 'PC-1',
          ops
        }, { timeout });

        const ms = Date.now() - t0;

        // ✅ PRO: Nouvelle logique qui gère à la fois les anciennes et nouvelles réponses
        const data = res?.data || {};
        const success = data.success === true;
        const applied = Array.isArray(data.applied) ? data.applied : [];
        const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
        const failed = Array.isArray(data.failed) ? data.failed : [];
        const stats = data.stats || {};
        
        // ✅ ANTI-LOSS: Log brut si réponse suspecte (pour déboguer les format mismatches)
        if (success && applied.length === 0 && conflicts.length === 0 && failed.length === 0) {
          console.log('   ⚠️  BATCH RESPONSE (no arrays):', JSON.stringify(data).substring(0, 400));
          const received = Number.isFinite(stats.received) ? stats.received : ops.length;
          const skipped = Number.isFinite(stats.skipped) ? stats.skipped : 0;
          console.log(`   ⚠️  Counts: received=${received}, applied=${applied.length}, skipped=${skipped}, failed=${failed.length}`);
        }
        
        // ✅ PRO: Deux cas de succès:
        // 1. success=true ET (applied>0 OU conflits>0)  [ancien format avec opérations]
        // 2. success=true ET failed=0 ET skipped=received [nouveau format: noop OK]
        const appliedCount = applied.length;
        const failedCount = failed.length;
        const conflictCount = conflicts.length;
        const isNoopOk = (appliedCount === 0 && failedCount === 0 && (stats.skipped ?? 0) === (stats.received ?? ops.length));
        const hasOperations = (appliedCount > 0 || conflictCount > 0);
        const isValid = success && (hasOperations || isNoopOk);

        if (isValid) {
          // Log résumé unique
          const msg = isNoopOk ? `(noop: all ${stats.skipped} skipped)` : `(${appliedCount} applied)`;
          console.log(`   ✅ BATCH OK: ${appliedCount} appliqués, ${conflictCount} conflits ${msg} (${ms}ms)`);
          syncLogger.info(`📤 [BATCH] ↑${appliedCount} OK${conflictCount > 0 ? `, ${conflictCount} conflits` : ''} ${msg} (${ms}ms)`);
          // ✅ FIX: Utiliser 'batch' au lieu de 'products' (car on peut pusher stock_move, sales, debts, etc.)
          syncLogger.incrementPushed('batch', appliedCount);
          
          return {
            success: true,
            applied,
            conflicts,
            failed,
            stats,
            server_time: res.data.server_time || null
          };
        }

        // Réponse invalide - log détaillé pour déboguer
        let err = res?.data?.error || `HTTP ${res.status}`;
        
        // Cas 1: success=false avec failed array (Apps Script a rejeté des ops)
        if (!success && failedCount > 0) {
          err = `${failedCount} operations failed`;
          console.log(`   ❌ BATCH FAIL: ${err} (${failedCount} failed ops)`);
        }
        // Cas 2: success=true mais ZERO_APPLIED (données perdues)
        else if (success && appliedCount === 0 && conflictCount === 0 && !isNoopOk) {
          err = 'ZERO_APPLIED: Apps Script returned success=true but 0 operations were applied - forcing retry to prevent data loss';
          console.log(`   ⚠️  ${err}`);
        }
        
        console.log(`   ❌ BATCH FAIL: ${err}`);
        console.log(`      Réponse: success=${success}, applied=${appliedCount}, conflicts=${conflictCount}, failed=${failedCount}`);
        syncLogger.warn(`❌ [BATCH] FAIL: ${err}`);
        // ✅ FIX: Utiliser 'batch' au lieu de 'products' pour les compteurs
        syncLogger.incrementErrors('batch', ops.length);
        return { success: false, error: err, applied, conflicts, failed, stats };
      } catch (e) {
        const ms = Date.now() - t0;
        console.log(`   ❌ BATCH ERROR: ${e.message} (${ms}ms)`);
        syncLogger.warn(`❌ [BATCH] ERROR: ${e.message}`);
        // ✅ FIX: Utiliser 'batch' au lieu de 'products'
        syncLogger.incrementErrors('batch', ops.length);
        return { success: false, error: e.message, applied: [], conflicts: [], failed: [], stats: {} };
      }
    }

    // Fallback: push en parallèle limité (sans logs par item)
    const applied = [];
    const conflicts = [];
    await runPool(ops, PUSH_CONCURRENCY, async (op) => {
      const r = await this.push(op.entity, op.entity_id, op.op, op.payload, { timeout: TIMEOUTS[op.entity] });
      if (r.success) applied.push({ op_id: op.op_id || op.id });
      else conflicts.push({ op_id: op.op_id || op.id, error: r.error });
    });

    const ms = Date.now() - t0;
    syncLogger.info(`📤 [BATCH-FALLBACK] ↑${applied.length} OK, ${conflicts.length} conflits (${ms}ms)`);

    return { success: true, applied, conflicts, failed: [], stats: { received: ops.length, applied: applied.length, failed: 0 }, server_time: null };
  }

  /**
   * PULL 1 entité (mode paginé PRO)
   * VERSION OPTIMISÉE: Logs minimaux par défaut, détaillés si VERBOSE
   */
  async pull(entity, since, options = {}) {
    const url = this.getWebAppUrl();
    if (!url) {
      syncLogger.warn(`[${entity}] URL non configurée`);
      return { success: false, data: [], error: 'URL non configurée' };
    }

    const sinceDate = since ? (typeof since === 'string' ? since : since.toISOString()) : new Date(0).toISOString();
    const timeout = options.timeout ?? (TIMEOUTS[entity] || DEFAULT_TIMEOUT_MS);
    const maxRetries = options.maxRetries ?? 1;
    const retryDelay = options.retryDelay ?? 400;
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

        // Log condensé (niveau 2+)
        syncLogger.verbose(`📥 [${entity}] Pull${full ? ' FULL' : ''} attempt ${attempt}/${maxRetries + 1}`);

        const res = await this.axios.get(url, { params, timeout });
        const ms = Date.now() - t0;

        if (res?.data?.success) {
          const data = Array.isArray(res.data.data) ? res.data.data : [];
          const nextCursor = res.data.next_cursor || null;
          const done = res.data.done || false;
          
          // Log résumé unique (niveau 2)
          syncLogger.info(`📥 [${entity}] ↓${data.length} items (${ms}ms)${done ? ' ✓' : ''}`);
          
          // Incrémenter le compteur
          syncLogger.incrementPulled(entity, data.length);
          
          // Logs détaillés uniquement si VERBOSE (niveau 3+)
          if (syncLogger.isVerbose() && data.length > 0) {
            data.slice(0, 2).forEach((item, idx) => {
              if (entity === 'products') {
                syncLogger.verbose(`   [${idx + 1}] ${item.code}: ${item.name}`);
              } else if (entity === 'sales') {
                syncLogger.verbose(`   [${idx + 1}] ${item.invoice_number}: ${item.client_name}`);
              }
            });
            if (data.length > 2) syncLogger.verbose(`   ... +${data.length - 2} items`);
          }
          
          return { success: true, data, next_cursor: nextCursor, done };
        }

        const err = res?.data?.error || `HTTP ${res.status}`;
        lastErr = err;
        
        // Log d'erreur (toujours affiché niveau 1+)
        if (attempt === maxRetries + 1) {
          syncLogger.warn(`❌ [${entity}] Pull FAIL: ${err}`);
          syncLogger.incrementErrors(entity);
        }

        if (res.status >= 400 && res.status < 500) break;
      } catch (e) {
        lastErr = e.message;
        if (attempt === maxRetries + 1) {
          syncLogger.warn(`❌ [${entity}] Pull ERROR: ${e.message}`);
          syncLogger.incrementErrors(entity);
        }
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
   * VERSION OPTIMISÉE: Logs minimaux, compteurs intelligents
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
    const seenUuids = new Set();
    let cursor = options.startCursor || null;
    let tries = 0;
    let pageCount = 0;
    let duplicatesRemoved = 0;
    const startTime = Date.now();

    // Log de démarrage condensé
    syncLogger.start(entity.toUpperCase(), full ? 'FULL IMPORT' : 'incremental');

    while (true) {
      try {
        const params = { entity, since: sinceDate, limit: limit.toString() };
        if (full) params.full = '1';
        if (cursor) params.cursor = cursor.toString();
        if (unitLevel) params.unit_level = unitLevel;

        const t0 = Date.now();
        const res = await this.axios.get(url, { params, timeout });
        const ms = Date.now() - t0;
        pageCount++;

        if (res?.data?.success) {
          let pageData = Array.isArray(res.data.data) ? res.data.data : [];
          const nextCursor = res.data.next_cursor || null;
          const done = res.data.done || false;

          // DEDUPLICATION silencieuse
          const filteredPageData = [];
          for (const item of pageData) {
            if (item.uuid && seenUuids.has(item.uuid)) {
              duplicatesRemoved++;
            } else {
              if (item.uuid) seenUuids.add(item.uuid);
              filteredPageData.push(item);
            }
          }

          allData.push(...filteredPageData);
          
          // Log de progression condensé (niveau 3 seulement)
          syncLogger.verbose(`   [${entity}] Page ${pageCount}: +${filteredPageData.length} (total: ${allData.length})${done ? ' ✓' : ''}`);

          if (done || !nextCursor) {
            const totalMs = Date.now() - startTime;
            syncLogger.end(entity.toUpperCase(), `${allData.length} items, ${pageCount} pages${duplicatesRemoved > 0 ? `, ${duplicatesRemoved} dups` : ''}`, totalMs);
            syncLogger.incrementPulled(entity, allData.length);
            return { success: true, data: allData, last_cursor: null, done: true };
          }

          cursor = nextCursor;
          tries = 0;
          
          // Batch intermédiaire pour les ventes (sans log détaillé)
          if (entity === 'sales' && allData.length >= limit * 2) {
            syncLogger.progress(entity.toUpperCase(), allData.length, '?', 'batch intermédiaire');
            return { success: true, data: allData, last_cursor: cursor, done: false };
          }
        } else {
          throw new Error(res?.data?.error || `HTTP ${res.status}`);
        }
      } catch (e) {
        tries++;
        const waitMs = Math.min(60000, 2000 * Math.pow(1.6, tries));
        
        if (tries >= maxRetries) {
          syncLogger.error(`❌ [${entity}] Max retries (${maxRetries}): ${e.message}`);
          syncLogger.incrementErrors(entity);
          return { success: false, data: allData, error: e.message, last_cursor: cursor };
        }

        syncLogger.verbose(`   [${entity}] Retry ${tries}/${maxRetries} dans ${(waitMs / 1000).toFixed(0)}s...`);
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

// Créer l'instance et ajouter l'alias batchPush pour compatibilité
export const sheetsClient = new SheetsClient();
// Alias: batchPush = pushBatch (pour compatibilité avec le code existant)
sheetsClient.batchPush = sheetsClient.pushBatch.bind(sheetsClient);
