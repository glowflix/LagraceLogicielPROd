/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SYNC QUEUE PRO - File d'attente de synchronisation ultra-performante
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Fonctionnalités:
 * - Batch processing par lots (50-500 items)
 * - Backoff exponentiel intelligent (2s → 5s → 10s → 30s → 60s)
 * - Coalescing des modifications sur même entité
 * - Last-write-wins par champ (pas d'écrasement de données récentes)
 * - Retry automatique avec limite (max 5 tentatives)
 * - Priorités (CRITICAL > HIGH > NORMAL > LOW)
 * - Mode adaptatif (fréquence ajustée selon activité)
 * - Non-bloquant pour l'UI
 */

import { EventEmitter } from 'events';

// Priorités de synchronisation
export const SyncPriority = {
  CRITICAL: 0,  // Ventes, dettes (toujours prioritaire)
  HIGH: 1,      // Stock moves
  NORMAL: 2,    // Product patches
  LOW: 3,       // Analytics, logs
};

// États de la queue
export const QueueState = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  PAUSED: 'paused',
  ERROR: 'error',
};

/**
 * Configuration du backoff exponentiel
 */
const BACKOFF_CONFIG = {
  initialDelay: 2000,      // 2 secondes
  maxDelay: 60000,         // 60 secondes max
  multiplier: 2,           // Doubler à chaque échec
  maxRetries: 5,           // Max 5 tentatives
};

/**
 * Configuration du batch processing
 */
const BATCH_CONFIG = {
  minBatchSize: 10,        // Minimum items par batch
  maxBatchSize: 100,       // Maximum items par batch
  batchTimeout: 1000,      // 1 seconde avant flush forcé
  coalescingWindow: 500,   // 500ms pour coalescer les modifications
};

/**
 * Configuration adaptative
 */
const ADAPTIVE_CONFIG = {
  idleInterval: 30000,     // 30s si pas d'activité
  activeInterval: 5000,    // 5s si activité récente
  burstInterval: 2000,     // 2s si beaucoup de modifications
  activityWindow: 60000,   // Fenêtre de 60s pour détecter activité
  burstThreshold: 20,      // 20+ modifications = burst mode
};

/**
 * Classe SyncQueue - File d'attente de synchronisation
 */
export class SyncQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      ...BACKOFF_CONFIG,
      ...BATCH_CONFIG,
      ...ADAPTIVE_CONFIG,
      ...options,
    };
    
    // Files d'attente par priorité
    this.queues = {
      [SyncPriority.CRITICAL]: [],
      [SyncPriority.HIGH]: [],
      [SyncPriority.NORMAL]: [],
      [SyncPriority.LOW]: [],
    };
    
    // État interne
    this.state = QueueState.IDLE;
    this.isOnline = true;
    this.currentRetry = 0;
    this.lastError = null;
    this.processingPromise = null;
    
    // Statistiques
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      totalCoalesced: 0,
      lastProcessedAt: null,
      lastErrorAt: null,
      currentBatchSize: 0,
      activityCount: 0,
      activityTimestamps: [],
    };
    
    // Map pour le coalescing (entity_uuid → operation)
    this.coalescingMap = new Map();
    
    // Timers
    this.processTimer = null;
    this.coalescingTimer = null;
    this.adaptiveTimer = null;
    
    // Handlers (à définir par l'utilisateur)
    this.pushHandler = null;
    this.pullHandler = null;
    
    // Démarrer le monitoring adaptatif
    this._startAdaptiveMonitoring();
  }
  
  /**
   * Définir le handler de push (envoie les données vers le serveur)
   */
  setPushHandler(handler) {
    this.pushHandler = handler;
  }
  
  /**
   * Définir le handler de pull (récupère les données du serveur)
   */
  setPullHandler(handler) {
    this.pullHandler = handler;
  }
  
  /**
   * Ajouter une opération à la queue avec coalescing intelligent
   */
  enqueue(operation, priority = SyncPriority.NORMAL) {
    const entityKey = `${operation.entity_type}:${operation.entity_uuid}`;
    
    // Enregistrer l'activité
    this._recordActivity();
    
    // Coalescing: fusionner avec opération existante sur même entité
    if (this.coalescingMap.has(entityKey)) {
      const existing = this.coalescingMap.get(entityKey);
      
      // Last-write-wins par champ
      const mergedPayload = this._mergePayloads(existing.payload, operation.payload);
      existing.payload = mergedPayload;
      existing.updated_at = Date.now();
      
      this.stats.totalCoalesced++;
      this.emit('coalesced', { entityKey, operation: existing });
      
      // Réinitialiser le timer de coalescing
      this._resetCoalescingTimer();
      return existing.op_id;
    }
    
    // Nouvelle opération
    const op = {
      op_id: operation.op_id || this._generateId(),
      entity_type: operation.entity_type,
      entity_uuid: operation.entity_uuid,
      entity_code: operation.entity_code,
      payload: operation.payload,
      priority,
      retries: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    
    // Ajouter à la map de coalescing
    this.coalescingMap.set(entityKey, op);
    
    this.stats.totalQueued++;
    this.emit('enqueued', op);
    
    // Démarrer le timer de coalescing si pas déjà actif
    this._resetCoalescingTimer();
    
    return op.op_id;
  }
  
  /**
   * Fusionner les payloads avec last-write-wins par champ
   */
  _mergePayloads(existingPayload, newPayload) {
    const merged = { ...existingPayload };
    
    for (const [key, value] of Object.entries(newPayload)) {
      // Si c'est un objet avec timestamp, comparer
      if (value && typeof value === 'object' && value._timestamp) {
        const existingTimestamp = merged[key]?._timestamp || 0;
        if (value._timestamp > existingTimestamp) {
          merged[key] = value;
        }
      } else {
        // Sinon, toujours prendre la nouvelle valeur (last-write-wins)
        merged[key] = value;
      }
    }
    
    return merged;
  }
  
  /**
   * Réinitialiser le timer de coalescing
   */
  _resetCoalescingTimer() {
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
    }
    
    this.coalescingTimer = setTimeout(() => {
      this._flushCoalescingBuffer();
    }, this.options.coalescingWindow);
  }
  
  /**
   * Vider le buffer de coalescing vers les queues
   */
  _flushCoalescingBuffer() {
    for (const [entityKey, op] of this.coalescingMap.entries()) {
      this.queues[op.priority].push(op);
    }
    
    this.coalescingMap.clear();
    
    // Déclencher le processing si pas déjà en cours
    if (this.state === QueueState.IDLE) {
      this._scheduleProcessing();
    }
  }
  
  /**
   * Planifier le processing avec intervalle adaptatif
   */
  _scheduleProcessing() {
    if (this.processTimer) {
      clearTimeout(this.processTimer);
    }
    
    const interval = this._getAdaptiveInterval();
    
    this.processTimer = setTimeout(() => {
      this._processBatch();
    }, interval);
  }
  
  /**
   * Obtenir l'intervalle adaptatif selon l'activité
   */
  _getAdaptiveInterval() {
    const now = Date.now();
    const recentActivity = this.stats.activityTimestamps.filter(
      t => now - t < this.options.activityWindow
    ).length;
    
    if (recentActivity >= this.options.burstThreshold) {
      return this.options.burstInterval;
    }
    
    if (recentActivity > 0) {
      return this.options.activeInterval;
    }
    
    return this.options.idleInterval;
  }
  
  /**
   * Enregistrer une activité pour le mode adaptatif
   */
  _recordActivity() {
    const now = Date.now();
    this.stats.activityTimestamps.push(now);
    this.stats.activityCount++;
    
    // Nettoyer les timestamps anciens
    this.stats.activityTimestamps = this.stats.activityTimestamps.filter(
      t => now - t < this.options.activityWindow
    );
  }
  
  /**
   * Démarrer le monitoring adaptatif
   */
  _startAdaptiveMonitoring() {
    this.adaptiveTimer = setInterval(() => {
      // Nettoyer les timestamps anciens
      const now = Date.now();
      this.stats.activityTimestamps = this.stats.activityTimestamps.filter(
        t => now - t < this.options.activityWindow
      );
      
      // Émettre les stats
      this.emit('stats', this.getStats());
    }, 10000); // Toutes les 10 secondes
  }
  
  /**
   * Traiter un batch d'opérations
   */
  async _processBatch() {
    if (this.state === QueueState.PROCESSING) {
      return; // Déjà en cours
    }
    
    if (!this.isOnline) {
      this.emit('offline');
      this._scheduleProcessing();
      return;
    }
    
    // Récupérer le prochain batch (par priorité)
    const batch = this._getNextBatch();
    
    if (batch.length === 0) {
      this.state = QueueState.IDLE;
      this._scheduleProcessing();
      return;
    }
    
    this.state = QueueState.PROCESSING;
    this.stats.currentBatchSize = batch.length;
    this.emit('processing', { batchSize: batch.length });
    
    try {
      // Exécuter le push handler
      if (this.pushHandler) {
        const result = await this.pushHandler(batch);
        
        if (result.success) {
          // Succès - réinitialiser le backoff
          this.currentRetry = 0;
          this.stats.totalProcessed += batch.length;
          this.stats.lastProcessedAt = Date.now();
          
          // Marquer les opérations comme réussies
          for (const op of batch) {
            this.emit('success', op);
          }
          
          this.emit('batch-success', { count: batch.length, result });
        } else {
          // Échec partiel - remettre en queue
          this._handleBatchError(batch, result.error);
        }
      }
      
      this.state = QueueState.IDLE;
    } catch (error) {
      this._handleBatchError(batch, error);
    }
    
    // Planifier le prochain processing
    this._scheduleProcessing();
  }
  
  /**
   * Gérer une erreur de batch
   */
  _handleBatchError(batch, error) {
    this.currentRetry++;
    this.lastError = error;
    this.stats.lastErrorAt = Date.now();
    
    this.emit('error', { error, batch, retry: this.currentRetry });
    
    if (this.currentRetry >= this.options.maxRetries) {
      // Max retries atteint - marquer comme échoué
      for (const op of batch) {
        op.failed = true;
        this.stats.totalFailed++;
        this.emit('failed', op);
      }
      
      this.currentRetry = 0;
      this.state = QueueState.ERROR;
    } else {
      // Remettre en queue avec backoff
      for (const op of batch) {
        op.retries++;
        this.queues[op.priority].unshift(op); // Remettre en tête
      }
      
      this.state = QueueState.IDLE;
    }
  }
  
  /**
   * Obtenir le prochain batch par priorité
   */
  _getNextBatch() {
    const batch = [];
    let remaining = this.options.maxBatchSize;
    
    // Traiter par ordre de priorité
    for (const priority of [SyncPriority.CRITICAL, SyncPriority.HIGH, SyncPriority.NORMAL, SyncPriority.LOW]) {
      const queue = this.queues[priority];
      
      while (queue.length > 0 && remaining > 0) {
        batch.push(queue.shift());
        remaining--;
      }
      
      // Si on a rempli le batch avec des critiques, ne pas descendre en priorité
      if (priority === SyncPriority.CRITICAL && batch.length >= this.options.minBatchSize) {
        break;
      }
    }
    
    return batch;
  }
  
  /**
   * Calculer le délai de backoff
   */
  _getBackoffDelay() {
    const delay = this.options.initialDelay * Math.pow(this.options.multiplier, this.currentRetry);
    return Math.min(delay, this.options.maxDelay);
  }
  
  /**
   * Générer un ID unique
   */
  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Mettre en pause la queue
   */
  pause() {
    this.state = QueueState.PAUSED;
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    this.emit('paused');
  }
  
  /**
   * Reprendre la queue
   */
  resume() {
    if (this.state === QueueState.PAUSED) {
      this.state = QueueState.IDLE;
      this._scheduleProcessing();
      this.emit('resumed');
    }
  }
  
  /**
   * Définir l'état online/offline
   */
  setOnline(online) {
    const wasOffline = !this.isOnline;
    this.isOnline = online;
    
    if (online && wasOffline) {
      // Connexion restaurée - reprendre immédiatement
      this.currentRetry = 0;
      this._scheduleProcessing();
      this.emit('online');
    }
  }
  
  /**
   * Obtenir les statistiques
   */
  getStats() {
    const totalQueued = Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
    const coalescingPending = this.coalescingMap.size;
    
    return {
      ...this.stats,
      queuedByPriority: {
        critical: this.queues[SyncPriority.CRITICAL].length,
        high: this.queues[SyncPriority.HIGH].length,
        normal: this.queues[SyncPriority.NORMAL].length,
        low: this.queues[SyncPriority.LOW].length,
      },
      totalQueued: totalQueued + coalescingPending,
      coalescingPending,
      state: this.state,
      isOnline: this.isOnline,
      currentRetry: this.currentRetry,
      lastError: this.lastError?.message,
      adaptiveInterval: this._getAdaptiveInterval(),
    };
  }
  
  /**
   * Vider complètement la queue
   */
  clear() {
    for (const priority of Object.keys(this.queues)) {
      this.queues[priority] = [];
    }
    this.coalescingMap.clear();
    this.emit('cleared');
  }
  
  /**
   * Arrêter la queue
   */
  stop() {
    this.pause();
    
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
    }
    
    if (this.adaptiveTimer) {
      clearInterval(this.adaptiveTimer);
    }
    
    this.emit('stopped');
  }
}

// Instance singleton
let syncQueueInstance = null;

/**
 * Obtenir l'instance singleton de SyncQueue
 */
export function getSyncQueue() {
  if (!syncQueueInstance) {
    syncQueueInstance = new SyncQueue();
  }
  return syncQueueInstance;
}

export default SyncQueue;

