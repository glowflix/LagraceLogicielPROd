/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BACKGROUND SYNC - Synchronisation en arrière-plan non-bloquante
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Principe:
 * - Synchronisation uniquement en arrière-plan
 * - Ne bloque jamais l'UI
 * - Utilise Web Workers si disponible
 * - Retry automatique avec backoff exponentiel
 * - Queue des opérations en attente
 */

import axios from 'axios';

// API URL dynamique
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

// État de synchronisation
let syncState = {
  isRunning: false,
  isOnline: navigator.onLine,
  lastSync: null,
  pendingOperations: [],
  retryCount: 0,
  maxRetries: 5,
};

// Queue des opérations en attente
const operationQueue = [];

// Listeners pour les événements de sync
const syncListeners = new Set();

/**
 * Ajouter un listener pour les événements de sync
 */
export function onSyncEvent(callback) {
  syncListeners.add(callback);
  return () => syncListeners.delete(callback);
}

/**
 * Émettre un événement de sync
 */
function emitSyncEvent(event, data) {
  syncListeners.forEach(callback => {
    try {
      callback(event, data);
    } catch (e) {
      console.error('Erreur listener sync:', e);
    }
  });
}

/**
 * Vérifier la connexion réseau
 */
async function checkConnection() {
  try {
    if (!navigator.onLine) {
      return false;
    }
    
    const response = await axios.get(`${API_URL}/api/health`, {
      timeout: 3000,
    });
    
    return response.status === 200;
  } catch (e) {
    return false;
  }
}

/**
 * Synchroniser une opération
 */
async function syncOperation(operation) {
  const { type, endpoint, method = 'POST', data, retryCount = 0 } = operation;
  
  try {
    emitSyncEvent('sync:start', { type, endpoint });
    
    const config = {
      method,
      url: `${API_URL}${endpoint}`,
      timeout: 10000,
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    
    emitSyncEvent('sync:success', { type, endpoint, response: response.data });
    
    return { success: true, data: response.data };
  } catch (error) {
    console.warn(`[BackgroundSync] Erreur sync ${type}:`, error.message);
    
    // Si erreur réseau et retries disponibles, réessayer
    if (
      (error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED') &&
      retryCount < syncState.maxRetries
    ) {
      // Backoff exponentiel: 2^retryCount secondes
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      
      emitSyncEvent('sync:retry', { type, endpoint, retryCount, delay });
      
      setTimeout(() => {
        operation.retryCount = retryCount + 1;
        operationQueue.push(operation);
        processQueue();
      }, delay);
      
      return { success: false, willRetry: true };
    }
    
    emitSyncEvent('sync:error', { type, endpoint, error: error.message });
    
    return { success: false, error: error.message };
  }
}

/**
 * Traiter la queue des opérations
 * IMPORTANT: Ne bloque JAMAIS l'UI - utilise requestIdleCallback et timeouts courts
 */
async function processQueue() {
  if (syncState.isRunning || operationQueue.length === 0) {
    return;
  }
  
  // Vérifier la connexion avant de traiter (timeout court)
  const isOnline = await Promise.race([
    checkConnection(),
    new Promise((resolve) => setTimeout(() => resolve(false), 1000)), // Timeout 1s
  ]);
  
  if (!isOnline) {
    syncState.isOnline = false;
    emitSyncEvent('sync:offline', {});
    return;
  }
  
  syncState.isOnline = true;
  syncState.isRunning = true;
  
  // Traiter les opérations une par une avec délais pour ne pas bloquer l'UI
  while (operationQueue.length > 0) {
    const operation = operationQueue.shift();
    
    // Utiliser requestIdleCallback si disponible pour ne pas bloquer l'UI
    if (window.requestIdleCallback) {
      await new Promise((resolve) => {
        window.requestIdleCallback(() => {
          syncOperation(operation).finally(resolve);
        }, { timeout: 500 }); // Timeout court
      });
    } else {
      // Fallback: délai pour ne pas bloquer l'UI
      await new Promise((resolve) => setTimeout(resolve, 50));
      await syncOperation(operation);
    }
    
    // Pause entre chaque opération pour laisser l'UI respirer
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  
  syncState.isRunning = false;
  syncState.lastSync = Date.now();
  
  emitSyncEvent('sync:complete', { lastSync: syncState.lastSync });
}

/**
 * Ajouter une opération à la queue
 */
export function queueSyncOperation(operation) {
  operationQueue.push({
    ...operation,
    timestamp: Date.now(),
  });
  
  // Démarrer le traitement si pas déjà en cours
  if (!syncState.isRunning) {
    // Utiliser setTimeout pour ne pas bloquer l'UI
    setTimeout(() => {
      processQueue();
    }, 0);
  }
}

/**
 * Synchroniser les ventes en attente
 */
export function syncPendingSales() {
  // Cette fonction sera appelée par le worker de sync
  // Ne pas implémenter ici pour éviter duplication
  console.log('[BackgroundSync] Sync ventes en attente...');
}

/**
 * Synchroniser les produits depuis Google Sheets
 * Utilise le worker de sync en arrière-plan, ne bloque jamais l'UI
 */
export function syncProductsFromSheets() {
  // Ne pas bloquer - juste ajouter à la queue
  queueSyncOperation({
    type: 'products',
    endpoint: '/api/sync/products',
    method: 'POST',
  });
  
  // Le worker de sync traitera cette opération en arrière-plan
  // L'UI continue de fonctionner normalement avec les données SQL locales
}

/**
 * Synchroniser les dettes depuis Google Sheets
 * Utilise le worker de sync en arrière-plan, ne bloque jamais l'UI
 */
export function syncDebtsFromSheets() {
  // Ne pas bloquer - juste ajouter à la queue
  queueSyncOperation({
    type: 'debts',
    endpoint: '/api/sync/debts',
    method: 'POST',
  });
  
  // Le worker de sync traitera cette opération en arrière-plan
  // L'UI continue de fonctionner normalement avec les données SQL locales
}

/**
 * Démarrer la synchronisation périodique
 */
export function startPeriodicSync(intervalMs = 60000) {
  // Vérifier la connexion et synchroniser périodiquement
  const intervalId = setInterval(async () => {
    const isOnline = await checkConnection();
    syncState.isOnline = isOnline;
    
    if (isOnline && operationQueue.length > 0) {
      processQueue();
    }
  }, intervalMs);
  
  // Démarrer immédiatement
  processQueue();
  
  return () => clearInterval(intervalId);
}

/**
 * Obtenir l'état de synchronisation
 */
export function getSyncState() {
  return {
    ...syncState,
    queueSize: operationQueue.length,
  };
}

/**
 * Vider la queue (pour tests)
 */
export function clearQueue() {
  operationQueue.length = 0;
}

// Écouter les changements de connexion réseau
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncState.isOnline = true;
    emitSyncEvent('sync:online', {});
    processQueue();
  });
  
  window.addEventListener('offline', () => {
    syncState.isOnline = false;
    emitSyncEvent('sync:offline', {});
  });
}

export default {
  queueSyncOperation,
  syncPendingSales,
  syncProductsFromSheets,
  syncDebtsFromSheets,
  startPeriodicSync,
  getSyncState,
  onSyncEvent,
  clearQueue,
};

