import { syncRepo } from '../../db/repositories/sync.repo.js';
import { sheetsClient } from './sheets.client.js';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { ratesRepo } from '../../db/repositories/rates.repo.js';
import { syncLogger } from '../../core/logger.js';

// Intervalle de synchronisation (augmenté pour réduire la charge)
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS) || 30000; // 30 secondes par défaut (au lieu de 10s)

let syncInterval = null;
let isSyncing = false;
let syncRunning = false; // Mutex global pour empêcher les overlaps
let _started = false; // Flag pour la boucle "après fin"
let _loopTimeout = null; // Timeout de la boucle
let isOnline = true; // État de connexion Internet

/**
 * Worker de synchronisation qui tourne en arrière-plan
 */
export class SyncWorker {
  /**
   * Démarre le worker avec import initial intelligent
   */
  async start() {
    if (syncInterval) {
      return; // Déjà démarré
    }

    syncLogger.info(`🚀 Démarrage du worker de synchronisation (intervalle: ${SYNC_INTERVAL_MS}ms)`);
    syncLogger.info(`📡 URL Google Apps Script: ${process.env.GOOGLE_SHEETS_WEBAPP_URL ? '✅ Configurée' : '❌ Non configurée'}`);

    // Détection automatique de connexion (doit être fait en premier)
    this.setupConnectionDetection();

    // Vérifier si l'import initial a déjà été fait
    const initialImportDone = syncRepo.isInitialImportDone();
    const isDatabaseEmpty = !productsRepo.hasProducts();
    
    // BOOTSTRAP AUTOMATIQUE : Si table vide → full pull (même si flag = 1)
    if (isDatabaseEmpty) {
      syncLogger.warn('⚠️  [BOOTSTRAP] Base de données vide (0 produits) → Bootstrap automatique activé');
      syncLogger.info('   🔄 [BOOTSTRAP] Mode: Full pull (toutes les données) même si initial_import_done = 1');
      syncLogger.info('   📋 [BOOTSTRAP] Le système va télécharger TOUTES les données existantes dans Google Sheets');
      
      // Vérifier la connexion d'abord
      await this.checkConnection();
      
      // Si en ligne, faire le bootstrap immédiatement
      if (isOnline) {
        syncLogger.info('   🚀 [BOOTSTRAP] Démarrage du bootstrap (full pull)...');
        this.pullUpdates(true).catch(err => {
          syncLogger.error('❌ [BOOTSTRAP] Erreur lors du bootstrap:', err);
          syncLogger.warn('   ⚠️  [BOOTSTRAP] Bootstrap échoué, sera réessayé au prochain cycle si base toujours vide');
        });
      } else {
        syncLogger.info('⏳ [BOOTSTRAP] En attente de connexion Internet pour le bootstrap...');
      }
    } else if (!initialImportDone) {
      // Import initial classique (si flag = 0 mais base non vide, c'est suspect mais on continue)
      syncLogger.info('📥 [IMPORT] Flag initial_import_done = 0, mais base contient des données');
      syncLogger.info('   🔄 [IMPORT] Synchronisation incrémentale normale');
      if (isOnline) {
        await this.runSyncSafe();
      }
    } else {
      // Mode normal : base non vide + flag = 1
      syncLogger.info('📊 [SYNC] Mode normal : synchronisation incrémentale uniquement');
      if (isOnline) {
        await this.runSyncSafe();
      }
    }

    // Boucle "après fin" au lieu de setInterval (évite les overlaps)
    syncLogger.info(`⏰ [AUTO-SYNC] Synchronisation automatique configurée: toutes les ${SYNC_INTERVAL_MS / 1000} secondes (TEMPS RÉEL)`);
    syncLogger.info(`   🔄 [AUTO-SYNC] Mode: Détection Internet auto + Sync auto toutes les ${SYNC_INTERVAL_MS / 1000}s`);
    syncLogger.info(`   📊 [AUTO-SYNC] Les données seront stockées dans SQL et disponibles immédiatement dans les pages`);
    syncLogger.info(`   ⚡ [AUTO-SYNC] Mode PRO: Boucle "après fin" (pas de setInterval) pour éviter les overlaps`);
    
    _started = true;
    const loop = async () => {
      if (!_started) return;
      
      // Utiliser setImmediate pour différer la sync et ne pas bloquer l'event loop
      setImmediate(async () => {
        const t0 = Date.now();
        if (isOnline) {
          // Utiliser process.nextTick pour donner la priorité aux requêtes API
          process.nextTick(async () => {
            await this.runSyncSafe().catch(err => {
              syncLogger.error(`❌ [AUTO-SYNC] Erreur sync automatique: ${err.message}`);
            });
          });
        } else {
          syncLogger.debug(`⏸️  [AUTO-SYNC] Sync ignorée: pas de connexion Internet`);
        }
        
        const elapsed = Date.now() - t0;
        const wait = Math.max(2000, SYNC_INTERVAL_MS - elapsed); // min 2s (au lieu de 1s)
        
        if (_started) {
          _loopTimeout = setTimeout(loop, wait);
        }
      });
    };
    
    // Démarrer la boucle avec un délai initial pour ne pas bloquer le démarrage
    setTimeout(loop, 5000); // Attendre 5s avant la première sync
  }

  /**
   * Configure la détection automatique de connexion Internet (en temps réel)
   * Optimisé pour ne pas bloquer l'event loop
   */
  setupConnectionDetection() {
    // Vérifier la connexion toutes les 15 secondes (réduit la charge)
    setInterval(() => {
      // Utiliser setImmediate pour ne pas bloquer l'event loop
      setImmediate(() => {
        this.checkConnection().catch(() => {
          // Ignorer les erreurs silencieusement pour ne pas polluer les logs
        });
      });
    }, 15000); // Vérifier toutes les 15 secondes (au lieu de 5s)
  }

  /**
   * Vérifie si une connexion Internet est disponible (détection automatique en arrière-plan)
   */
  async checkConnection() {
    const webAppUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    if (!webAppUrl) {
      return; // Pas d'URL configurée
    }

    try {
      const axios = (await import('axios')).default;
      
      // Essayer de pinger Google Sheets avec un timeout court
      const response = await axios.get(webAppUrl, {
        params: { entity: 'test' },
        timeout: 3000, // 3 secondes de timeout
        validateStatus: (status) => status < 500, // Accepter même les erreurs 4xx (signe de connexion)
      });
      
      // Si on arrive ici, la connexion est disponible
      if (!isOnline) {
        syncLogger.info('🌐 [INTERNET] Connexion Internet détectée automatiquement, reprise de la synchronisation');
        isOnline = true;
        
        // Si l'import initial n'a pas été fait, charger immédiatement tous les produits
        const initialImportDone = syncRepo.isInitialImportDone();
        const isDatabaseEmpty = !productsRepo.hasProducts();
        if (!initialImportDone && isDatabaseEmpty) {
          syncLogger.info('📥 [AUTO-SYNC] Base de données vide, import initial automatique depuis Google Sheets...');
          // Import initial complet en arrière-plan (non-bloquant)
          this.pullUpdates(true).catch(err => {
            syncLogger.error('❌ [AUTO-SYNC] Erreur lors de l\'import initial automatique:', err);
          });
        } else {
          // Relancer une sync immédiate (non-bloquant)
          syncLogger.info('🔄 [AUTO-SYNC] Synchronisation automatique déclenchée après détection Internet');
          this.runSyncSafe().catch(err => {
            syncLogger.error('❌ [AUTO-SYNC] Erreur lors de la sync automatique:', err);
          });
        }
      }
    } catch (error) {
      // Pas de connexion ou timeout
      if (isOnline && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout'))) {
        syncLogger.warn('⚠️ [INTERNET] Connexion Internet perdue, synchronisation en attente');
        isOnline = false;
      }
    }
  }

  /**
   * Arrête le worker
   */
  stop() {
    _started = false;
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    if (_loopTimeout) {
      clearTimeout(_loopTimeout);
      _loopTimeout = null;
    }
      syncLogger.info('Worker de synchronisation arrêté');
  }

  /**
   * Wrapper sécurisé pour sync() avec mutex anti-overlap et timeout
   * Optimisé pour ne pas bloquer l'event loop
   */
  async runSyncSafe() {
    if (syncRunning) {
      syncLogger.warn('⏭️ Sync déjà en cours, skip');
      return;
    }
    syncRunning = true;
    
    // Timeout de sécurité (3 minutes max, réduit de 5min)
    const timeout = setTimeout(() => {
      if (syncRunning) {
        syncLogger.error('⏱️ Timeout: Sync prend trop de temps (>3min), arrêt forcé');
        syncRunning = false;
        isSyncing = false;
      }
    }, 3 * 60 * 1000);
    
    try {
      // Utiliser setImmediate pour différer la sync et donner priorité aux requêtes API
      await new Promise((resolve, reject) => {
        setImmediate(async () => {
          try {
            await this.sync();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      syncLogger.error('❌ Sync error', error);
      // Ne pas planter l'application, juste logger l'erreur
      if (error.message?.includes('ECONNREFUSED') || error.message?.includes('ETIMEDOUT')) {
        syncLogger.warn('⚠️ Problème de connexion, sync sera réessayée au prochain cycle');
      }
    } finally {
      clearTimeout(timeout);
      // Utiliser setImmediate pour libérer le mutex de manière non-bloquante
      setImmediate(() => {
        syncRunning = false;
      });
    }
  }

  /**
   * Effectue une synchronisation complète avec gestion d'erreurs robuste
   * Optimisé pour ne pas bloquer l'event loop
   */
  async sync() {
    if (isSyncing) {
      return; // Déjà en cours
    }

    isSyncing = true;
    const syncStartTime = Date.now();

    try {
      // Utiliser setImmediate pour différer chaque étape et donner priorité aux requêtes API
      // Push: envoyer les opérations en attente (avec timeout)
      try {
        await new Promise((resolve, reject) => {
          setImmediate(async () => {
            try {
              await Promise.race([
                this.pushPending(),
                new Promise((_, rejectTimeout) => 
                  setTimeout(() => rejectTimeout(new Error('Push timeout')), 2 * 60 * 1000)
                )
              ]);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
      } catch (pushError) {
        syncLogger.warn('⚠️ Erreur push (non bloquant):', pushError.message);
        // Continue même si push échoue
      }

      // Pull: récupérer les données depuis Sheets (avec timeout)
      // Utiliser process.nextTick pour donner encore plus de priorité aux requêtes API
      try {
        await new Promise((resolve, reject) => {
          process.nextTick(async () => {
            try {
              await Promise.race([
                this.pullUpdates(),
                new Promise((_, rejectTimeout) => 
                  setTimeout(() => rejectTimeout(new Error('Pull timeout')), 3 * 60 * 1000)
                )
              ]);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
      } catch (pullError) {
        syncLogger.warn('⚠️ Erreur pull (non bloquant):', pullError.message);
        // Continue même si pull échoue partiellement
      }
      
      const duration = Date.now() - syncStartTime;
      syncLogger.debug(`✅ Sync terminée en ${duration}ms`);
    } catch (error) {
      syncLogger.error('❌ Erreur lors de la synchronisation:', error);
      // Ne pas propager l'erreur pour éviter de planter l'application
    } finally {
      // Libérer le flag de manière non-bloquante
      setImmediate(() => {
        isSyncing = false;
      });
    }
  }

  /**
   * Push les opérations en attente vers Google Sheets (mode PRO avec batch ou concurrence limitée)
   */
  async pushPending() {
    // Ne pas push si pas de connexion
    if (!isOnline) {
      return;
    }

    try {
      const pending = syncRepo.getPending(200); // Max 200 par batch

      if (pending.length === 0) {
        return;
      }

      syncLogger.info(`📤 [PUSH] Push de ${pending.length} opération(s)...`);

      // Préparer les ops pour batch
      const ops = pending.map(op => ({
        op_id: op.id,
        entity: op.entity,
        entity_id: op.entity_id,
        op: op.op,
        payload: JSON.parse(op.payload_json || JSON.stringify(op.payload || {}))
      }));

      // Essayer batch d'abord, sinon fallback en concurrence limitée
      const batchResult = await sheetsClient.pushBatch(ops, { timeout: 9000 });

      // Traiter les résultats
      if (batchResult.applied) {
        for (const applied of batchResult.applied) {
          syncRepo.markAsSent(applied.op_id);
        }
        syncLogger.info(`   ✅ [PUSH] ${batchResult.applied.length} opération(s) appliquée(s)`);
      }

      if (batchResult.conflicts && batchResult.conflicts.length > 0) {
        for (const conflict of batchResult.conflicts) {
          syncRepo.markAsError(conflict.op_id, new Error(conflict.error || 'Conflit'));
        }
        syncLogger.warn(`   ⚠️  [PUSH] ${batchResult.conflicts.length} conflit(s)`);
      }

            // Si erreur réseau, marquer comme hors ligne
      if (!batchResult.success && batchResult.error) {
        if (batchResult.error.includes('network') || batchResult.error.includes('ECONNREFUSED') || batchResult.error.includes('timeout')) {
              isOnline = false;
            }
          }
        } catch (error) {
      syncLogger.error('❌ [PUSH] Erreur pushPending:', error.message);
          // Si erreur réseau, marquer comme hors ligne
          if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            isOnline = false;
          }
    }
  }

  /**
   * Pull les mises à jour depuis Google Sheets - Mode PRO avec pagination
   * Télécharge TOUTES les feuilles (Carton, Piece, Milliers, Ventes, Dettes, etc.)
   * @param {boolean} isInitialImport - Si true, import complet paginé (ignore les dates)
   */
  async pullUpdates(isInitialImport = false) {
    // Vérifier la connexion Internet
    if (!isOnline && !isInitialImport) {
      syncLogger.debug('Hors ligne, pull ignoré');
      return;
    }

    // BOOTSTRAP AUTOMATIQUE : Si table vide → forcer full pull
    const isProductsEmpty = !productsRepo.hasProducts();
    if (isProductsEmpty && !isInitialImport) {
      syncLogger.warn('⚠️  [BOOTSTRAP AUTO] Table products vide détectée → Passage en mode FULL PULL');
      isInitialImport = true; // Forcer le mode full pull
    }

    const globalStartTime = Date.now();
    syncLogger.info(`🔄 Début pull depuis Google Sheets${isInitialImport ? ' (BOOTSTRAP/FULL - TOUT EN UNE FOIS)' : ' (synchronisation incrémentale)'}`);
    syncLogger.info(`   ⏰ Début: ${new Date().toISOString()}`);
    syncLogger.info(`   📋 Téléchargement de TOUTES les feuilles: Products (Carton/Piece/Milliers), Sales, Debts, Rates, Users`);

    try {
      const entities = ['users', 'rates', 'debts', 'products', 'sales'];
      const results = [];
      
      // Construire sinceMap pour tous
      const sinceMap = {};
      syncLogger.info(`   📅 [SYNC] Dates 'since' utilisées pour chaque entité:`);
      for (const e of entities) {
        const lastPullDate = syncRepo.getLastPullDate(e);
        // Si bootstrap/full import → date très ancienne (1970)
        sinceMap[e] = isInitialImport ? new Date(0).toISOString() : (lastPullDate || new Date(0).toISOString());
        const sinceDate = new Date(sinceMap[e]);
        syncLogger.info(`      - ${e.toUpperCase()}: ${sinceMap[e]} (${sinceDate.toLocaleString('fr-FR')})${isInitialImport ? ' 🚀 BOOTSTRAP/FULL' : (!lastPullDate ? ' ⚠️ AUCUNE DATE PRÉCÉDENTE - Import complet' : '')}`);
      }
      
      // Mode PRO: Full import paginé si initial, sinon incrémental
      if (isInitialImport) {
        syncLogger.info(`   🚀 [FULL IMPORT] Mode paginé activé pour import complet`);
        
        // 1) Légers (users, rates, debts) - pas de pagination nécessaire
        const lightEntities = ['users', 'rates', 'debts'];
        syncLogger.info(`   ⚡ [FULL IMPORT] Pull des entités légères: ${lightEntities.join(', ')}`);
        
        for (const entity of lightEntities) {
          const entityStartTime = Date.now();
          try {
            const result = await sheetsClient.pullAllPaged(entity, sinceMap[entity], {
              full: true,
              maxRetries: 8,
              timeout: 30000
            });
            
            if (result.success && result.data.length > 0) {
              syncLogger.info(`   ✅ [${entity.toUpperCase()}] ${result.data.length} item(s) téléchargé(s) en ${Date.now() - entityStartTime}ms`);
              await this.applyUpdates(entity, result.data);
              syncRepo.setLastPullDate(entity, new Date().toISOString());
              results.push({ entity, success: true, data: result.data, duration: Date.now() - entityStartTime });
            } else {
              syncLogger.warn(`   ⏭️  [${entity.toUpperCase()}] Aucune donnée ou erreur`);
              results.push({ entity, success: result.success, data: result.data || [], error: result.error, skipped: !result.success });
            }
          } catch (error) {
            syncLogger.error(`   ❌ [${entity.toUpperCase()}] Erreur: ${error.message}`);
            results.push({ entity, success: false, data: [], error: error.message, skipped: true });
          }
        }
        
        // 2) Products - paginé par unit_level (Carton, Milliers, Piece)
        syncLogger.info(`   📦 [FULL IMPORT] Pull paginé Products (Carton, Milliers, Piece)...`);
        const productUnitLevels = ['CARTON', 'MILLIER', 'PIECE'];
        const allProducts = [];
        
        for (const unitLevel of productUnitLevels) {
          const unitStartTime = Date.now();
          syncLogger.info(`   📄 [PRODUCTS] Feuille: ${unitLevel}`);
          
          try {
            const cursor = syncRepo.getCursor('products', unitLevel);
            const result = await sheetsClient.pullAllPaged('products', sinceMap['products'], {
              full: true,
              unitLevel: unitLevel,
              startCursor: cursor,
              maxRetries: 8,
              timeout: 30000,
              limit: 300
            });
            
            if (result.success) {
              allProducts.push(...result.data);
              syncLogger.info(`   ✅ [PRODUCTS/${unitLevel}] ${result.data.length} produit(s) en ${Date.now() - unitStartTime}ms`);
              syncRepo.setCursor('products', result.last_cursor || null, unitLevel);
            } else {
              syncLogger.warn(`   ⚠️ [PRODUCTS/${unitLevel}] Erreur: ${result.error}`);
            }
          } catch (error) {
            syncLogger.error(`   ❌ [PRODUCTS/${unitLevel}] Erreur: ${error.message}`);
          }
        }
        
        // Grouper products par code et appliquer
        if (allProducts.length > 0) {
          syncLogger.info(`   📦 [PRODUCTS] Total: ${allProducts.length} produit(s) à appliquer`);
          try {
            await this.applyUpdates('products', allProducts);
            syncRepo.setLastPullDate('products', new Date().toISOString());
            if (!syncRepo.isInitialImportDone()) {
              syncRepo.setInitialImportDone();
              syncLogger.info(`   🎉 [IMPORT] Import initial terminé avec succès (${allProducts.length} produit(s))`);
            }
            results.push({ entity: 'products', success: true, data: allProducts, duration: 0 });
          } catch (applyError) {
            syncLogger.error(`   ❌ [PRODUCTS] Erreur application: ${applyError.message}`);
            results.push({ entity: 'products', success: false, data: [], error: applyError.message, skipped: true });
          }
        }
        
        // 3) Sales - paginé
        syncLogger.info(`   💰 [FULL IMPORT] Pull paginé Sales...`);
        const salesStartTime = Date.now();
        try {
          const cursor = syncRepo.getCursor('sales');
          const result = await sheetsClient.pullAllPaged('sales', sinceMap['sales'], {
            full: true,
            startCursor: cursor,
            maxRetries: 8,
            timeout: 30000,
            limit: 300
          });
          
          if (result.success && result.data.length > 0) {
            syncLogger.info(`   ✅ [SALES] ${result.data.length} vente(s) téléchargée(s) en ${Date.now() - salesStartTime}ms`);
            await this.applyUpdates('sales', result.data);
            syncRepo.setLastPullDate('sales', new Date().toISOString());
            syncRepo.setCursor('sales', result.last_cursor || null);
            results.push({ entity: 'sales', success: true, data: result.data, duration: Date.now() - salesStartTime });
          } else {
            syncLogger.warn(`   ⏭️ [SALES] Aucune donnée ou erreur`);
            results.push({ entity: 'sales', success: result.success, data: result.data || [], error: result.error, skipped: !result.success });
          }
        } catch (error) {
          syncLogger.error(`   ❌ [SALES] Erreur: ${error.message}`);
          results.push({ entity: 'sales', success: false, data: [], error: error.message, skipped: true });
        }
        
      } else {
        // Mode incrémental normal (rapide)
        syncLogger.info(`   🔄 [SYNC INCRÉMENTALE] Mode rapide (depuis lastPullDate)`);
        
        // Pull en parallèle limité (légers d'abord)
        const lightEntities = ['users', 'rates', 'debts'];
        const heavyEntities = ['products', 'sales'];
        
        syncLogger.info(`   ⚡ [SYNC] Pull parallèle des entités légères: ${lightEntities.join(', ')}`);
        const lightResults = await sheetsClient.pullMany(lightEntities, sinceMap, { 
          maxRetries: 1 
        });
        
        // Appliquer immédiatement les résultats légers
        for (const r of lightResults) {
          if (r.success && r.data && r.data.length > 0) {
            syncLogger.info(`   ✅ [${r.entity.toUpperCase()}] ${r.data.length} item(s) téléchargé(s)`);
            try {
              await this.applyUpdates(r.entity, r.data);
              // Utiliser max_updated_at si disponible
              const maxUpdated = r.data.reduce((max, item) => {
                const itemDate = item._remote_updated_at || item.last_update || item.created_at || item.sold_at;
                if (itemDate) {
                  const d = new Date(itemDate);
                  return !max || d > max ? d : max;
                }
                return max;
              }, null);
              syncRepo.setLastPullDate(r.entity, maxUpdated ? maxUpdated.toISOString() : new Date().toISOString());
              results.push({ entity: r.entity, success: true, data: r.data, duration: 0 });
            } catch (applyError) {
              syncLogger.error(`   ❌ [${r.entity.toUpperCase()}] Erreur application: ${applyError.message}`);
              results.push({ entity: r.entity, success: false, data: [], error: applyError.message, skipped: true });
            }
          } else if (r.success) {
            syncLogger.info(`   ℹ️  [${r.entity.toUpperCase()}] Aucune donnée (0 item)`);
            syncRepo.setLastPullDate(r.entity, new Date().toISOString());
            results.push({ entity: r.entity, success: true, data: [], duration: 0 });
          } else {
            syncLogger.warn(`   ⏭️  [${r.entity.toUpperCase()}] Skip: ${r.error || 'Erreur'}`);
            results.push({ entity: r.entity, success: false, data: [], error: r.error, skipped: true });
          }
        }
        
        // Puis les lourds en séquentiel (avec timeout court)
        for (const entity of heavyEntities) {
        const entityStartTime = Date.now();
        let attempt = 0;
        
        // Backoff exponentiel : 1s, 2s, 4s, 8s, ... max 60s
        const getRetryDelay = (attemptNum) => {
          const delay = Math.min(60_000, 1000 * Math.pow(2, attemptNum - 1));
          return delay;
        };
        
        while (true) {
          attempt++;
          try {
            const lastSync = isInitialImport ? new Date(0) : syncRepo.getLastPullDate(entity);
            const sinceDate = lastSync ? (typeof lastSync === 'string' ? lastSync : lastSync.toISOString()) : new Date(0).toISOString();
            
            if (attempt === 1) {
              syncLogger.info(`📥 [${entity.toUpperCase()}] Début téléchargement depuis Google Sheets`);
              syncLogger.info(`   📅 [${entity.toUpperCase()}] Date 'since' utilisée: ${sinceDate} (${new Date(sinceDate).toLocaleString('fr-FR')})`);
              syncLogger.info(`   🔍 [${entity.toUpperCase()}] Mode: ${isInitialImport ? 'IMPORT INITIAL (toutes les données)' : 'SYNC INCRÉMENTALE (depuis lastPullDate)'}`);
            } else {
              syncLogger.info(`📥 [${entity.toUpperCase()}] Tentative ${attempt}${isInitialImport ? ' (retry infini activé)' : ''}`);
            }
            
            // Timeout depuis ENV ou valeurs par défaut (PRO : utilise les variables d'environnement)
            const envTimeout = parseInt(process.env.SYNC_TIMEOUT_MS || '30000', 10);
            const timeouts = {
              products: isInitialImport ? 60_000 : parseInt(process.env.SHEETS_TIMEOUT_PRODUCTS_MS || envTimeout.toString(), 10),
              sales: isInitialImport ? 60_000 : parseInt(process.env.SHEETS_TIMEOUT_SALES_MS || envTimeout.toString(), 10),
            };
            const timeout = timeouts[entity] || envTimeout;
            syncLogger.info(`   ⏱️  [${entity.toUpperCase()}] Timeout configuré: ${timeout}ms (${isInitialImport ? 'IMPORT INITIAL' : 'SYNC NORMALE'}) depuis ENV: ${process.env.SYNC_TIMEOUT_MS || 'défaut'}`);
            
            const result = await sheetsClient.pull(entity, sinceDate, {
              maxRetries: isInitialImport ? 2 : 1,
              retryDelay: 400,
              timeout: timeout
            });
            
            const pullDuration = Date.now() - entityStartTime;
            
            if (result.success) {
              if (result.data && result.data.length > 0) {
                syncLogger.info(`   ✅ [${entity.toUpperCase()}] ${result.data.length} item(s) téléchargé(s) en ${pullDuration}ms`);
                
                // Logs détaillés uniquement si SYNC_VERBOSE=1 (optimisation)
                const VERBOSE = process.env.SYNC_VERBOSE === '1';
                if (VERBOSE) {
                if (entity === 'products' && result.data.length > 0) {
                    syncLogger.info(`   📋 Détail produits: ${result.data.length} produit(s)`);
                    result.data.slice(0, 3).forEach((product, index) => {
                    const unitsCount = product.units ? product.units.length : 0;
                      syncLogger.info(`      [${index + 1}] Code: "${product.code || 'N/A'}", Nom: "${product.name || 'N/A'}", Unités: ${unitsCount}`);
                      });
                    }
                if (entity === 'sales' && result.data.length > 0) {
                    syncLogger.info(`   📋 Détail ventes: ${result.data.length} ligne(s)`);
                    result.data.slice(0, 3).forEach((sale, index) => {
                      syncLogger.info(`      [${index + 1}] Facture: ${sale.invoice_number || 'N/A'}, Client: ${sale.client_name || 'N/A'}`);
                    });
                  }
                }
                
                // APPLIQUER IMMÉDIATEMENT après téléchargement réussi (pas d'attente)
                try {
                  const applyStartTime = Date.now();
                  const upsertStats = await this.applyUpdates(entity, result.data);
                  const applyDuration = Date.now() - applyStartTime;
                  
                  syncRepo.setLastPullDate(entity, new Date().toISOString());
                  
                  // Si Products a réussi et c'était un import initial, marquer comme fait
                  if (entity === 'products' && isInitialImport && !syncRepo.isInitialImportDone()) {
                    syncRepo.setInitialImportDone();
                    syncLogger.info(`   🎉 [IMPORT] Import initial terminé avec succès (${result.data.length} produit(s))`);
                  }
                  
                  // Logs optimisés (stats seulement)
                  if (upsertStats) {
                    syncLogger.info(`   ✅ [${entity.toUpperCase()}] ${result.data.length} item(s) → SQL: ${upsertStats.inserted || 0} inséré(s), ${upsertStats.updated || 0} mis à jour, ${upsertStats.skipped || 0} ignoré(s) (${applyDuration}ms)`);
                  } else {
                    syncLogger.info(`   ✅ [${entity.toUpperCase()}] ${result.data.length} item(s) appliqué(s) en ${applyDuration}ms`);
                  }
                } catch (applyError) {
                  syncLogger.error(`   ❌ [${entity.toUpperCase()}] Erreur application SQL: ${applyError.message}`);
                  // Continuer quand même, on a réussi le téléchargement
                }
                
                results.push({ entity, success: true, data: result.data, duration: pullDuration });
                break; // Succès, sortir de la boucle de retry
              } else {
                syncLogger.warn(`   ⚠️  [${entity.toUpperCase()}] Aucune donnée retournée (0 item)`);
                syncLogger.warn(`   🔍 [${entity.toUpperCase()}] Diagnostic détaillé:`);
                syncLogger.warn(`      - Date 'since' utilisée: ${sinceDate} (${new Date(sinceDate).toLocaleString('fr-FR')})`);
                syncLogger.warn(`      - Mode: ${isInitialImport ? 'IMPORT INITIAL (devrait retourner toutes les données)' : 'SYNC INCRÉMENTALE (seulement les données modifiées depuis lastPullDate)'}`);
                syncLogger.warn(`      - Si sync incrémentale: Vérifier que lastPullDate n'est pas trop récent`);
                syncLogger.warn(`      - Si import initial: Vérifier que les données existent dans Google Sheets`);
                syncLogger.warn(`      - ⚠️  ATTENTION: lastPullDate sera mis à jour même si 0 items → risque de ne jamais récupérer les données`);
                
                // IMPORTANT: Ne pas mettre à jour lastPullDate si 0 items en sync incrémentale
                // (sinon on ne récupérera jamais les données)
                if (!isInitialImport) {
                  syncLogger.warn(`      - ⏭️  [${entity.toUpperCase()}] Ne pas mettre à jour lastPullDate (0 items, sync incrémentale)`);
                } else {
                  // Pour import initial, mettre à jour quand même (mais c'est suspect)
                  syncLogger.warn(`      - ⚠️  [${entity.toUpperCase()}] Import initial avec 0 items - Vérifier les données dans Sheets`);
                  syncRepo.setLastPullDate(entity, new Date().toISOString());
                }
                
                results.push({ entity, success: true, data: [], duration: pullDuration });
                break; // Succès (mais vide), sortir de la boucle de retry
              }
            } else {
              // Erreur dans la réponse
              syncLogger.error(`   ❌ [${entity.toUpperCase()}] Échec tentative ${attempt}: ${result.error || 'Erreur inconnue'}`);
              
              // Si import initial, retry infini avec backoff exponentiel
              if (isInitialImport) {
                const delay = getRetryDelay(attempt);
                syncLogger.info(`   🔄 Retry dans ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; // Réessayer indéfiniment
              } else {
                // Pour sync normale, max 1 tentative (skip rapidement)
                syncLogger.warn(`   ⏭️  [${entity.toUpperCase()}] Skip après erreur (sync normale, pas de retry)`);
                syncLogger.warn(`   💡 [${entity.toUpperCase()}] Sera réessayé au prochain cycle de sync (dans 10s)`);
                results.push({ entity, success: false, data: [], error: result.error, duration: Date.now() - entityStartTime, skipped: true });
                break; // Skip immédiatement pour sync normale
              }
            }
          } catch (error) {
            const errorDuration = Date.now() - entityStartTime;
            const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
            
            if (isTimeout) {
              syncLogger.warn(`   ⏱️  [${entity.toUpperCase()}] Timeout après ${(errorDuration / 1000).toFixed(1)}s`);
            } else {
            syncLogger.error(`   ❌ [${entity.toUpperCase()}] Erreur tentative ${attempt} après ${errorDuration}ms: ${error.message}`);
            }
            
            // Si import initial, retry infini avec backoff exponentiel
            if (isInitialImport) {
              const delay = getRetryDelay(attempt);
              syncLogger.info(`   🔄 Retry dans ${delay / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue; // Réessayer indéfiniment
            } else {
              // Pour sync normale : skip rapidement si timeout (pas de retry)
              if (isTimeout) {
                syncLogger.warn(`   ⏭️  [${entity.toUpperCase()}] Skip après timeout (sync normale, pas de retry)`);
                syncLogger.warn(`   💡 [${entity.toUpperCase()}] Sera réessayé au prochain cycle de sync (dans 10s)`);
                results.push({ entity, success: false, data: [], error: `Timeout après ${(errorDuration / 1000).toFixed(1)}s`, duration: errorDuration, skipped: true });
                break; // Skip immédiatement pour sync normale
              }
              
              // Pour autres erreurs, max 2 tentatives (pas 3)
              if (attempt >= 2) {
                syncLogger.warn(`   ⏭️  [${entity.toUpperCase()}] Skip après ${attempt} tentative(s) (sync normale)`);
                results.push({ entity, success: false, data: [], error: error.message, duration: errorDuration, skipped: true });
                break; // Échec après 2 tentatives
              }
              const delay = getRetryDelay(attempt);
              syncLogger.info(`   🔄 Retry dans ${delay / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
        }
        
          // Délai entre chaque entité pour ne pas surcharger Apps Script (réduit pour rapidité)
          if (entity !== heavyEntities[heavyEntities.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms de pause
          }
        }
      }
      
      // Résumé final (les données ont déjà été appliquées au fur et à mesure)
      const totalItems = results.reduce((sum, r) => sum + (r.data?.length || 0), 0);
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success && !r.skipped).length;
      const skippedCount = results.filter(r => r.skipped).length;
      const totalDuration = Date.now() - globalStartTime;
      
      syncLogger.info(`✅ [SYNC] Synchronisation terminée en ${(totalDuration / 1000).toFixed(1)}s`);
      syncLogger.info(`   📊 [SYNC] Résumé global:`);
      syncLogger.info(`      ✅ ${successCount}/${entities.length} entité(s) synchronisée(s) avec succès`);
      if (skippedCount > 0) {
        syncLogger.info(`      ⏭️  ${skippedCount}/${entities.length} entité(s) skipée(s) (sera réessayé au prochain cycle)`);
      }
      if (failedCount > 0) {
        syncLogger.warn(`      ❌ ${failedCount}/${entities.length} entité(s) en échec`);
      }
      syncLogger.info(`      📦 ${totalItems} item(s) téléchargé(s) et STOCKÉ(S) dans SQLite`);
      
      if (skippedCount > 0) {
        results.filter(r => r.skipped).forEach(r => {
          syncLogger.info(`      ⏭️  ${r.entity}: ${r.error || 'Skip'}`);
        });
        syncLogger.info(`   🔄 [SYNC] Entités skipées seront réessayées dans ${SYNC_INTERVAL_MS / 1000} secondes`);
      }
      
      if (failedCount > 0) {
        syncLogger.warn(`   ⚠️  [SYNC] ${failedCount} entité(s) n'ont pas pu être synchronisée(s)`);
        results.filter(r => !r.success && !r.skipped).forEach(r => {
          syncLogger.warn(`      ❌ ${r.entity}: ${r.error || 'Erreur inconnue'}`);
        });
      }
      
      if (totalDuration < 30000) {
        syncLogger.info(`   ⚡ [SYNC] Synchronisation RAPIDE (< 30s) ✅`);
      } else {
        syncLogger.warn(`   ⚠️  [SYNC] Synchronisation lente (${(totalDuration / 1000).toFixed(1)}s) - vérifier la connexion`);
      }
      
    } catch (error) {
      syncLogger.error('❌ Erreur pullUpdates:', error);
      // Marquer comme hors ligne si erreur réseau
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.message?.includes('network') || error.message?.includes('timeout')) {
        isOnline = false;
      }
    }
  }

  /**
   * Applique les mises à jour récupérées depuis Sheets
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applyUpdates(entity, data) {
    try {
      syncLogger.info(`⚙️  Application des mises à jour pour ${entity} (${data.length} item(s))...`);
      
      let stats = { inserted: 0, updated: 0, skipped: 0 };
      
      switch (entity) {
        case 'products':
        case 'product_units':
          stats = await this.applyProductUpdates(data);
          break;
        case 'sales':
          stats = await this.applySalesUpdates(data);
          break;
        case 'debts':
          stats = await this.applyDebtsUpdates(data);
          break;
        case 'rates':
          await this.applyRatesUpdates(data);
          stats = { inserted: 0, updated: data.length, skipped: 0 };
          break;
        case 'users':
          await this.applyUsersUpdates(data);
          stats = { inserted: 0, updated: data.length, skipped: 0 };
          break;
        default:
          syncLogger.warn(`⚠️  Type d'entité non géré pour pull: ${entity}`);
      }
      
      syncLogger.info(`✅ Application des mises à jour pour ${entity} terminée`);
      return stats;
    } catch (error) {
      syncLogger.error(`❌ Erreur applyUpdates ${entity}:`, error.message || error);
      throw error;
    }
  }

  /**
   * Applique les mises à jour de produits
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applyProductUpdates(data) {
    const startTime = Date.now();
    
    if (!data || data.length === 0) {
      syncLogger.warn('⚠️  [PRODUCTS] Aucune donnée produit à appliquer');
      return;
    }

    syncLogger.info(`📦 [PRODUCTS] Début application de ${data.length} item(s) dans SQLite...`);
    syncLogger.info(`   💾 [SQL] Tables: products + product_units, Opération: INSERT/UPDATE`);
    syncLogger.info(`   📊 [SQL] Type de données: ${Array.isArray(data) ? 'array' : typeof data}, ${data.length} ligne(s) à traiter`);
    
    if (data.length > 0) {
      syncLogger.info(`   🔍 [SQL] Premier item: ${JSON.stringify(data[0]).substring(0, 200)}...`);
    }

    // Grouper les produits par code
    const productsByCode = {};
    let itemsSkipped = 0;
    let itemsWithoutCode = 0;
    let itemsWithoutUnitLevel = 0;
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      // Normaliser le code : trim et convertir en string
      let code = item.code;
      if (code) {
        code = String(code).trim();
      }
      
      if (!code || code === '' || code === 'undefined' || code === 'null') {
        itemsSkipped++;
        itemsWithoutCode++;
        syncLogger.warn(`   ⚠️  Item ${i+1}/${data.length} ignoré: code vide ou invalide (code="${item.code}")`);
        if (i < 5) { // Log les 5 premiers items ignorés pour diagnostic
          syncLogger.warn(`      Détail item ignoré: ${JSON.stringify(item).substring(0, 200)}`);
        }
        continue;
      }
      
      syncLogger.debug(`   📝 Item ${i+1}/${data.length}: code="${code}", name="${item.name || 'N/A'}", unit_level="${item.unit_level || 'N/A'}"`);
      
      // Si l'item a une propriété 'units', c'est un produit avec ses unités (format de getProductsSince pour 'products')
      if (item.units && Array.isArray(item.units)) {
        // Format: { code, name, uuid, units: [...] }
        if (!productsByCode[code]) {
          productsByCode[code] = {
            code: code,
            name: item.name || '',
            uuid: item.uuid,
            units: []
          };
        }
        
        // Ajouter toutes les unités du produit
        for (const unit of item.units) {
          productsByCode[code].units.push({
            uuid: unit.uuid,
            unit_level: unit.unit_level || 'PIECE',
            unit_mark: unit.unit_mark || '',
            stock_initial: unit.stock_initial || unit.stock_current || 0,
            stock_current: unit.stock_current || unit.stock_initial || 0,
            purchase_price_usd: unit.purchase_price_usd || 0,
            sale_price_fc: unit.sale_price_fc || 0,
            sale_price_usd: unit.sale_price_usd || 0,
            auto_stock_factor: unit.auto_stock_factor || 1,
            qty_step: unit.qty_step || 1,
            last_update: unit.last_update || new Date().toISOString()
          });
        }
      } else if (item.unit_level) {
        // Format: unité individuelle (format de getProductsPage/getProductsSince pour 'product_units')
        if (!productsByCode[code]) {
          productsByCode[code] = {
            code: code,
            name: item.name || '',
            uuid: item.uuid,
            units: []
          };
        }
        
        productsByCode[code].units.push({
          uuid: item.uuid,
          unit_level: item.unit_level || 'PIECE',
          unit_mark: item.unit_mark || '',
          stock_initial: item.stock_initial || item.stock_current || 0,
          stock_current: item.stock_current || item.stock_initial || 0,
          purchase_price_usd: item.purchase_price_usd || 0,
          sale_price_fc: item.sale_price_fc || 0,
          sale_price_usd: item.sale_price_usd || 0,
          auto_stock_factor: item.auto_stock_factor || 1,
          qty_step: item.qty_step || 1,
          last_update: item.last_update || new Date().toISOString()
        });
      } else {
        // Item sans unit_level - on l'ajoute quand même avec PIECE par défaut
        itemsWithoutUnitLevel++;
        syncLogger.warn(`   ⚠️  Item ${i+1}/${data.length} sans unit_level, utilisation de PIECE par défaut (code="${code}")`);
        
        if (!productsByCode[code]) {
          productsByCode[code] = {
            code: code,
            name: item.name || '',
            uuid: item.uuid,
            units: []
          };
        }
        
        productsByCode[code].units.push({
          uuid: item.uuid,
          unit_level: 'PIECE',
          unit_mark: item.unit_mark || '',
          stock_initial: item.stock_initial || item.stock_current || 0,
          stock_current: item.stock_current || item.stock_initial || 0,
          purchase_price_usd: item.purchase_price_usd || 0,
          sale_price_fc: item.sale_price_fc || 0,
          sale_price_usd: item.sale_price_usd || 0,
          auto_stock_factor: item.auto_stock_factor || 1,
          qty_step: item.qty_step || 1,
          last_update: item.last_update || new Date().toISOString()
        });
      }
    }
    
    syncLogger.info(`   📊 Groupement terminé: ${Object.keys(productsByCode).length} produit(s) unique(s) trouvé(s)`);
    syncLogger.info(`   ⏭️  Items ignorés: ${itemsSkipped} (${itemsWithoutCode} sans code, ${itemsWithoutUnitLevel} sans unit_level)`);
    
    if (itemsSkipped > 0 && itemsSkipped === data.length) {
      syncLogger.error(`   ❌ CRITIQUE: TOUS les items ont été ignorés ! Vérifier que les colonnes "Code produit" dans Sheets (Carton/Milliers/Piece) sont bien remplies.`);
      syncLogger.error(`   💡 Solution: Vérifier dans Google Sheets que chaque ligne a un code produit valide dans la colonne "Code produit"`);
    }
    
    // Insérer ou mettre à jour chaque produit
    let insertedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const upsertStartTime = Date.now();
    
    for (const code in productsByCode) {
      try {
        const product = productsByCode[code];
        syncLogger.info(`   💾 [${code}] Upsert produit "${product.name || 'sans nom'}" avec ${product.units.length} unité(s)`);
        
        // Vérifier si le produit existe déjà
        const existing = productsRepo.findByCode(code);
        const isNew = !existing;
        
        const upsertItemStart = Date.now();
        productsRepo.upsert({
          ...product,
          is_active: 1,
          _origin: 'SHEETS'
        });
        const upsertItemDuration = Date.now() - upsertItemStart;
        
        if (isNew) {
          insertedCount++;
          syncLogger.info(`      ✅ Produit "${code}" INSÉRÉ en ${upsertItemDuration}ms`);
        } else {
          updatedCount++;
          syncLogger.info(`      ✅ Produit "${code}" MIS À JOUR en ${upsertItemDuration}ms`);
        }
      } catch (error) {
        errorCount++;
        syncLogger.error(`      ❌ Erreur upsert produit ${code}:`);
        syncLogger.error(`         Message: ${error.message}`);
        syncLogger.error(`         Stack: ${error.stack?.substring(0, 300)}`);
      }
    }
    
    const totalDuration = Date.now() - startTime;
    syncLogger.info(`✅ [PRODUCTS] Application SQL terminée en ${totalDuration}ms`);
    syncLogger.info(`   📊 [SQL] Résumé SQL:`);
    syncLogger.info(`      ✅ ${insertedCount} produit(s) INSÉRÉ(S) (INSERT INTO products + product_units)`);
    syncLogger.info(`      ✅ ${updatedCount} produit(s) MIS À JOUR (UPDATE products + product_units)`);
    syncLogger.info(`      ❌ ${errorCount} produit(s) EN ERREUR`);
    syncLogger.info(`   ⏱️  [SQL] Temps moyen par produit: ${(insertedCount + updatedCount) > 0 ? Math.round(totalDuration / (insertedCount + updatedCount)) : 0}ms`);
    
    if (insertedCount + updatedCount > 0) {
      syncLogger.info(`   🎉 [SQL] ${insertedCount + updatedCount} produit(s) maintenant STOCKÉ(S) dans SQLite et DISPONIBLE(S) dans la page Produits!`);
      syncLogger.info(`   📊 [SQL] Vérification: SELECT COUNT(*) FROM products WHERE is_active = 1; devrait retourner au moins ${insertedCount + updatedCount} ligne(s)`);
    }
    
    return { inserted: insertedCount, updated: updatedCount, skipped: 0 };
  }

  /**
   * Applique les mises à jour de ventes
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applySalesUpdates(data) {
    syncLogger.info(`💰 Application de ${data.length} vente(s)/item(s) de vente...`);
    
    // Grouper par facture
    const salesByInvoice = {};
    
    for (const item of data) {
      const invoiceNumber = item.invoice_number;
      if (!invoiceNumber) continue;
      
      if (!salesByInvoice[invoiceNumber]) {
        salesByInvoice[invoiceNumber] = {
          invoice_number: invoiceNumber,
          sold_at: item.sold_at,
          client_name: item.client_name || '',
          seller_name: item.seller_name || '',
          items: []
        };
      }
      
      // Trouver le product_id depuis le code
      const product = productsRepo.findByCode(item.product_code);
      
      salesByInvoice[invoiceNumber].items.push({
        product_id: product?.id || null,
        product_code: item.product_code || '',
        product_name: item.product_name || product?.name || '',
        unit_level: item.unit_level || 'PIECE',
        unit_mark: item.unit_mark || '',
        qty: item.qty || 0,
        qty_label: item.qty_label || (item.qty ? item.qty.toString() : '0'),
        unit_price_fc: item.unit_price_fc || 0,
        subtotal_fc: item.subtotal_fc || (item.qty * item.unit_price_fc),
        unit_price_usd: item.unit_price_usd || 0,
        subtotal_usd: item.subtotal_usd || (item.qty * item.unit_price_usd)
      });
    }
    
    // Vérifier si la vente existe déjà (pour éviter les doublons)
    // Si elle existe et vient de Sheets, on ne l'écrase pas si elle est locale
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const invoiceNumber in salesByInvoice) {
      try {
        const saleData = salesByInvoice[invoiceNumber];
        // Calculer les totaux
        let totalFC = 0;
        let totalUSD = 0;
        for (const item of saleData.items) {
          totalFC += item.subtotal_fc;
          totalUSD += item.subtotal_usd;
        }
        
        // Vérifier si la vente existe
        const existing = salesRepo.findByInvoice(invoiceNumber);
        if (!existing || existing.origin === 'SHEETS') {
          // Créer la vente (sans décrémenter le stock car elle vient de Sheets)
          // TODO: Gérer le stock différemment pour les ventes Sheets
          const isNew = !existing;
          syncLogger.info(`   💰 ${isNew ? 'Création' : 'Mise à jour'} vente ${invoiceNumber} avec ${saleData.items.length} item(s) (Total: ${totalFC} FC)`);
          salesRepo.create({
            ...saleData,
            total_fc: totalFC,
            total_usd: totalUSD,
            payment_mode: 'cash',
            status: 'paid',
            origin: 'SHEETS',
            rate_fc_per_usd: 2800 // Par défaut, sera calculé si nécessaire
          });
          if (isNew) {
            insertedCount++;
          } else {
            updatedCount++;
          }
        } else {
          skippedCount++;
          syncLogger.debug(`   ⏭️  Vente ${invoiceNumber} déjà existante (locale), ignorée`);
        }
      } catch (error) {
        errorCount++;
        syncLogger.error(`   ❌ Erreur upsert vente ${invoiceNumber}:`, error.message || error);
      }
    }
    
    syncLogger.info(`✅ Ventes traitées: ${insertedCount} insérée(s), ${updatedCount} mise(s) à jour, ${skippedCount} ignorée(s), ${errorCount} erreur(s)`);
    return { inserted: insertedCount, updated: updatedCount, skipped: skippedCount };
  }

  /**
   * Applique les mises à jour de dettes
   * @returns {Promise<{inserted: number, updated: number, skipped: number}>} Stats d'upsert
   */
  async applyDebtsUpdates(data) {
    const startTime = Date.now();
    syncLogger.info(`💳 [DEBTS] Début application de ${data.length} dette(s) dans SQLite...`);
    syncLogger.info(`   💾 [SQL] Table: debts, Opération: INSERT/UPDATE`);
    
    if (!data || data.length === 0) {
      syncLogger.warn(`⚠️  [DEBTS] Aucune donnée dette à appliquer dans SQL`);
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    
    syncLogger.info(`   📊 [SQL] Type de données: ${Array.isArray(data) ? 'array' : typeof data}, ${data.length} ligne(s) à traiter`);
    if (data.length > 0) {
      syncLogger.info(`   🔍 [SQL] Premier item: ${JSON.stringify(data[0]).substring(0, 300)}...`);
    }
    
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const itemStartTime = Date.now();
      
      try {
        if (!item.invoice_number) {
          syncLogger.warn(`   ⚠️  [${i+1}/${data.length}] Dette ignorée: pas de numéro de facture`);
          skippedCount++;
          continue;
        }
        
        // Vérifier si la dette existe déjà
        const existing = debtsRepo.findByInvoice(item.invoice_number);
        const isNew = !existing;
        
        // Créer ou mettre à jour la dette
        syncLogger.info(`   💳 [${i+1}/${data.length}] ${isNew ? 'INSERT' : 'UPDATE'} SQL pour dette ${item.invoice_number}`);
        syncLogger.info(`      📋 [SQL] Client: ${item.client_name || 'N/A'}`);
        syncLogger.info(`      📋 [SQL] Total: ${item.total_fc || 0} FC`);
        syncLogger.info(`      📋 [SQL] Payé: ${item.paid_fc || 0} FC`);
        syncLogger.info(`      📋 [SQL] Reste: ${item.remaining_fc !== undefined ? item.remaining_fc : (item.total_fc || 0) - (item.paid_fc || 0)} FC`);
        syncLogger.info(`      📋 [SQL] Status: ${item.status || 'open'}`);
        
        // Générer un UUID si non fourni
        const debtUuid = item.uuid || null;
        
        const debtData = {
          uuid: debtUuid,
          invoice_number: item.invoice_number,
          client_name: item.client_name || '',
          client_phone: item.client_phone || null,
          product_description: item.product_description || null,
          total_fc: item.total_fc || 0,
          paid_fc: item.paid_fc || 0,
          remaining_fc: item.remaining_fc !== undefined ? item.remaining_fc : (item.total_fc || 0) - (item.paid_fc || 0),
          total_usd: item.total_usd || 0,
          debt_fc_in_usd: item.debt_fc_in_usd || null,
          note: item.note || null,
          status: item.status || 'open',
          created_at: item.created_at || new Date().toISOString()
        };
        
        syncLogger.debug(`      📋 Données complètes: ${JSON.stringify(debtData).substring(0, 400)}...`);
        
        const upsertResult = debtsRepo.upsert(debtData);
        
        const itemDuration = Date.now() - itemStartTime;
        if (isNew) {
          insertedCount++;
          syncLogger.info(`      ✅ [SQL] INSERT réussie: Dette "${item.invoice_number}" INSÉRÉE dans SQL en ${itemDuration}ms`);
          syncLogger.info(`      📊 [SQL] ID SQLite: ${upsertResult?.id || 'N/A'}, UUID: ${upsertResult?.uuid || 'N/A'}`);
          syncLogger.info(`      ✅ [SQL] Dette maintenant DISPONIBLE dans la page Dettes`);
        } else {
          updatedCount++;
          syncLogger.info(`      ✅ [SQL] UPDATE réussie: Dette "${item.invoice_number}" MIS À JOUR dans SQL en ${itemDuration}ms`);
          syncLogger.info(`      📊 [SQL] ID SQLite: ${upsertResult?.id || 'N/A'}, UUID: ${upsertResult?.uuid || 'N/A'}`);
          syncLogger.info(`      ✅ [SQL] Dette maintenant À JOUR dans la page Dettes`);
        }
      } catch (error) {
        errorCount++;
        const errorDuration = Date.now() - itemStartTime;
        syncLogger.error(`      ❌ [${i+1}/${data.length}] Erreur après ${errorDuration}ms`);
        syncLogger.error(`         Invoice: ${item.invoice_number || 'N/A'}`);
        syncLogger.error(`         Message: ${error.message}`);
        syncLogger.error(`         Code: ${error.code || 'N/A'}`);
        
        if (error.message && (error.message.includes('uuid') || error.message.includes('client_phone'))) {
          syncLogger.error(`         ⚠️  Problème de schéma détecté: ${error.message}`);
          syncLogger.error(`         💡 La migration devrait corriger cela au prochain redémarrage`);
        }
        
        syncLogger.error(`         Stack: ${error.stack?.substring(0, 400)}...`);
      }
    }
    
    const totalDuration = Date.now() - startTime;
    syncLogger.info(`✅ [DEBTS] Application SQL terminée en ${totalDuration}ms`);
    syncLogger.info(`   📊 [SQL] Résumé SQL:`);
    syncLogger.info(`      ✅ ${insertedCount} dette(s) INSÉRÉE(S) (INSERT INTO debts)`);
    syncLogger.info(`      ✅ ${updatedCount} dette(s) MIS(E) À JOUR (UPDATE debts)`);
    syncLogger.info(`      ⏭️  ${skippedCount} dette(s) IGNORÉE(S) (déjà existantes)`);
    syncLogger.info(`      ❌ ${errorCount} dette(s) EN ERREUR`);
    syncLogger.info(`   ⏱️  [SQL] Temps moyen par dette: ${(insertedCount + updatedCount) > 0 ? Math.round(totalDuration / (insertedCount + updatedCount)) : 0}ms`);
    
    if (insertedCount + updatedCount > 0) {
      syncLogger.info(`   🎉 [SQL] ${insertedCount + updatedCount} dette(s) maintenant STOCKÉE(S) dans SQLite et DISPONIBLE(S) dans la page Dettes!`);
      syncLogger.info(`   📊 [SQL] Vérification: SELECT COUNT(*) FROM debts; devrait retourner au moins ${insertedCount + updatedCount} ligne(s)`);
    }
    
    if (errorCount > 0) {
      syncLogger.warn(`   ⚠️  [SQL] ${errorCount} dette(s) n'ont pas pu être synchronisée(s) dans SQL`);
      syncLogger.warn(`   💡 [SQL] Vérifier les logs ci-dessus pour plus de détails`);
    }
    
    return { inserted: insertedCount, updated: updatedCount, skipped: skippedCount };
  }

  /**
   * Applique les mises à jour de taux
   */
  async applyRatesUpdates(data) {
    syncLogger.info(`💱 Application de ${data.length} taux de change...`);
    
    // Prendre le taux le plus récent
    if (data.length > 0) {
      const latestRate = data[data.length - 1]; // Déjà trié par date
      try {
        syncLogger.info(`   💱 Mise à jour taux de change: ${latestRate.rate_fc_per_usd} FC/USD`);
        ratesRepo.updateCurrent(latestRate.rate_fc_per_usd, null);
        syncLogger.info(`✅ Taux de change mis à jour avec succès`);
      } catch (error) {
        syncLogger.error(`   ❌ Erreur mise à jour taux:`, error.message || error);
      }
    } else {
      syncLogger.info(`   ℹ️  Aucun taux de change à appliquer`);
    }
  }

  /**
   * Applique les mises à jour d'utilisateurs
   */
  async applyUsersUpdates(data) {
    syncLogger.info(`👥 Application de ${data.length} utilisateur(s)...`);
    
    // Note: usersRepo.upsert n'existe peut-être pas encore
    // Pour l'instant, on log juste
    for (const user of data) {
      syncLogger.info(`   👥 Utilisateur: ${user.name || user.nom || 'Inconnu'} (${user.numero || 'N/A'})`);
    }
    
    syncLogger.info(`✅ ${data.length} utilisateur(s) logué(s) (fonctionnalité à implémenter)`);
  }

  /**
   * Force une synchronisation immédiate
   */
  async syncNow() {
    await this.runSyncSafe();
  }
}

export const syncWorker = new SyncWorker();

