/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SOCKET.IO OPTIMISÉ - Configuration LAN robuste + throttling
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Optimisations:
 * - Throttling/debouncing des événements fréquents
 * - Reconnexion automatique avec backoff exponentiel
 * - Batch des événements pour réduire les re-renders
 * - Mode LAN robuste (timeout adaptatif, polling fallback)
 * - Queue des messages offline
 * - Compression automatique
 */

import { io } from 'socket.io-client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocketUrl } from './apiConfig.js';

// ═══════════════════════════════════════════════════════════════════════════
// UTILITAIRES DE THROTTLE/DEBOUNCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Throttle une fonction (max 1 appel par période)
 */
export function throttle(fn, delay) {
  let lastCall = 0;
  let timeoutId = null;
  
  return function throttled(...args) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);
    
    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn.apply(this, args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * Debounce une fonction (attend la fin de l'activité)
 */
export function debounce(fn, delay) {
  let timeoutId = null;
  
  return function debounced(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Batch des appels (regroupe les appels rapides)
 */
export function batchCalls(fn, delay = 100) {
  let queue = [];
  let timeoutId = null;
  
  return function batched(item) {
    queue.push(item);
    
    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        const batch = [...queue];
        queue = [];
        timeoutId = null;
        fn(batch);
      }, delay);
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION SOCKET.IO OPTIMISÉE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIGURATION SOCKET.IO ULTRA-OPTIMISÉE - Version 2.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Objectifs:
 * ⚡ Connexion ultra-rapide (< 1s)
 * 🔄 Reconnexion agressive (jamais perdre la connexion)
 * 💪 Détection rapide des problèmes (heartbeat fréquent)
 * 📦 Messages garantis (buffer offline)
 */

const DEFAULT_CONFIG = {
  // ═══════════════════════════════════════════════════════════════
  // TRANSPORT - WebSocket prioritaire pour latence minimale
  // ═══════════════════════════════════════════════════════════════
  transports: ['websocket', 'polling'], // WebSocket d'abord
  upgrade: true,                         // Upgrade polling → websocket
  rememberUpgrade: true,                 // Se souvenir du transport OK
  
  // ═══════════════════════════════════════════════════════════════
  // RECONNEXION ULTRA-AGRESSIVE
  // ═══════════════════════════════════════════════════════════════
  reconnection: true,
  reconnectionDelay: 200,               // ⚡ 200ms (très rapide!)
  reconnectionDelayMax: 3000,           // ⚡ Max 3s (pas 10s)
  reconnectionAttempts: Infinity,        // Jamais abandonner
  randomizationFactor: 0.2,              // Légère variation
  
  // ═══════════════════════════════════════════════════════════════
  // TIMEOUTS OPTIMISÉS
  // ═══════════════════════════════════════════════════════════════
  timeout: 5000,                        // ⚡ 5s pour connexion (pas 20s)
  
  // ═══════════════════════════════════════════════════════════════
  // HEARTBEAT TRÈS FRÉQUENT - Détection rapide des problèmes
  // ═══════════════════════════════════════════════════════════════
  pingTimeout: 10000,                   // ⚡ 10s (pas 30s)
  pingInterval: 3000,                   // ⚡ Ping toutes les 3s (pas 15s)
  
  // ═══════════════════════════════════════════════════════════════
  // PERFORMANCE & FIABILITÉ
  // ═══════════════════════════════════════════════════════════════
  forceNew: false,
  multiplex: true,
  volatile: false,                      // Garantir livraison
  autoConnect: true,
  
  // ═══════════════════════════════════════════════════════════════
  // COMPRESSION
  // ═══════════════════════════════════════════════════════════════
  perMessageDeflate: {
    threshold: 512,                     // Compresser si > 512 bytes
  },
};

/**
 * Configuration pour mode LAN (réseau local)
 */
const LAN_CONFIG = {
  ...DEFAULT_CONFIG,
  
  // ⚡ LAN = encore plus rapide
  reconnectionDelay: 100,               // 100ms
  reconnectionDelayMax: 2000,           // Max 2s
  timeout: 3000,                        // 3s connexion
  pingTimeout: 8000,                    // 8s
  pingInterval: 2000,                   // Ping toutes les 2s
};

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPER SOCKET OPTIMISÉ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crée un socket optimisé avec throttling automatique
 */
export function createOptimizedSocket(options = {}) {
  const isLAN = options.isLAN || false;
  const config = isLAN ? { ...LAN_CONFIG, ...options } : { ...DEFAULT_CONFIG, ...options };
  
  const socketUrl = getSocketUrl();
  const socket = io(socketUrl, config);
  
  // Queue des messages en attente
  const messageQueue = [];
  let isConnected = false;
  
  // ⚡ Throttlers OPTIMISÉS - Plus réactifs
  const throttlers = {
    'product:updated': throttle((data) => {
      socket._originalEmit('product:updated', data);
    }, 200),  // ⚡ 200ms (pas 500ms)
    
    'stock:updated': throttle((data) => {
      socket._originalEmit('stock:updated', data);
    }, 200),  // ⚡ 200ms (pas 500ms)
    
    'rate:updated': throttle((data) => {
      socket._originalEmit('rate:updated', data);
    }, 500),  // ⚡ 500ms (pas 1000ms)
    
    // ⚡ Nouveau: Événements d'impression ultra-rapides
    'print:job': (data) => {
      socket._originalEmit('print:job', data);
    }, // Pas de throttle pour l'impression
    
    'print:status': throttle((data) => {
      socket._originalEmit('print:status', data);
    }, 100),  // ⚡ 100ms pour statut impression
  };
  
  // Batch pour produits multiples
  const productBatcher = batchCalls((products) => {
    if (products.length === 1) {
      socket._originalEmit('product:updated', products[0]);
    } else {
      socket._originalEmit('products:batch-updated', products);
    }
  }, 200);
  
  // Sauvegarder l'emit original
  socket._originalEmit = socket.emit.bind(socket);
  
  // Override emit avec throttling
  socket.emit = function(event, ...args) {
    if (!isConnected) {
      // Queue le message si offline
      messageQueue.push({ event, args });
      return this;
    }
    
    // Appliquer throttling si configuré
    if (throttlers[event]) {
      throttlers[event](...args);
    } else {
      this._originalEmit(event, ...args);
    }
    
    return this;
  };
  
  // Émetteur de batch
  socket.emitBatch = function(event, items) {
    if (event === 'product:updated') {
      items.forEach(item => productBatcher(item));
    } else {
      this._originalEmit(`${event}:batch`, items);
    }
    return this;
  };
  
  // Gestion connexion
  socket.on('connect', () => {
    isConnected = true;
    console.log('✅ [Socket] Connecté:', socket.id);
    
    // Vider la queue des messages en attente
    while (messageQueue.length > 0) {
      const { event, args } = messageQueue.shift();
      socket._originalEmit(event, ...args);
    }
  });
  
  socket.on('disconnect', (reason) => {
    isConnected = false;
    console.log('❌ [Socket] Déconnecté:', reason);
  });
  
  // Logs de reconnexion
  socket.on('reconnect', (attemptNumber) => {
    console.log(`✅ [Socket] Reconnecté après ${attemptNumber} tentative(s)`);
  });
  
  socket.on('reconnect_attempt', (attemptNumber) => {
    if (attemptNumber % 5 === 0) {
      console.log(`🔄 [Socket] Tentative de reconnexion ${attemptNumber}...`);
    }
  });
  
  socket.on('reconnect_error', (error) => {
    console.warn('⚠️ [Socket] Erreur reconnexion:', error.message);
  });
  
  // Méthodes utilitaires
  socket.isConnected = () => isConnected;
  socket.getQueueSize = () => messageQueue.length;
  socket.clearQueue = () => { messageQueue.length = 0; };
  
  return socket;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT EMITTER THROTTLÉ POUR REACT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚡ Crée un handler d'événements ULTRA-RÉACTIF pour le store
 */
export function createThrottledEventHandler(socket, store) {
  const handlers = {
    // ⚡ Produits: throttle réduit pour réactivité
    'product:updated': throttle((product) => {
      store.setState((state) => ({
        products: state.products.map((p) =>
          p.id === product.id ? { ...p, ...product } : p
        ),
      }));
    }, 100),  // ⚡ 100ms (pas 300ms)
    
    // ⚡ Batch de produits: débounce rapide
    'products:batch-updated': debounce((products) => {
      store.setState((state) => {
        const productMap = new Map(products.map(p => [p.id, p]));
        return {
          products: state.products.map((p) =>
            productMap.has(p.id) ? { ...p, ...productMap.get(p.id) } : p
          ),
        };
      });
    }, 100),  // ⚡ 100ms (pas 200ms)
    
    // ⚡ Stock: throttle réduit
    'stock:updated': throttle((stock) => {
      store.setState((state) => ({
        stock: state.stock.map((s) =>
          s.id === stock.id ? { ...s, ...stock } : s
        ),
      }));
    }, 100),  // ⚡ 100ms (pas 300ms)
    
    // ⚡ Ventes: PAS de throttle (critique, doit être instantané)
    'sale:created': (sale) => {
      store.setState((state) => ({
        sales: [sale, ...state.sales].slice(0, 100),
      }));
    },
    
    // ⚡ Impression: PAS de throttle (critique)
    'print:completed': (data) => {
      console.log('🖨️ Impression terminée:', data.invoice_number);
    },
    
    'print:error': (data) => {
      console.error('🖨️ Erreur impression:', data.error);
    },
    
    // ⚡ Taux: throttle modéré (change rarement)
    'rate:updated': throttle((rate) => {
      store.setState({ currentRate: rate.rate });
    }, 500),  // ⚡ 500ms (pas 2000ms)
    
    // ⚡ Dettes: PAS de throttle
    'debt:updated': (debt) => {
      store.setState((state) => ({
        debts: state.debts.map((d) =>
          d.id === debt.id ? { ...d, ...debt } : d
        ),
      }));
    },
    
    // ⚡ Nouveau: Événement de sync terminée
    'sync:completed': debounce(() => {
      // Rafraîchir les données après sync
      store.getState().loadProducts?.();
    }, 500),
  };
  
  // Attacher les handlers au socket
  for (const [event, handler] of Object.entries(handlers)) {
    socket.on(event, handler);
  }
  
  // Retourner une fonction de cleanup
  return () => {
    for (const event of Object.keys(handlers)) {
      socket.off(event);
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK REACT POUR SOCKET OPTIMISÉ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook pour utiliser le socket optimisé dans React
 */
export function useOptimizedSocket(options = {}) {
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  
  // Créer le socket
  useEffect(() => {
    socketRef.current = createOptimizedSocket(options);
    
    const socket = socketRef.current;
    
    socket.on('connect', () => {
      setIsConnected(true);
      setReconnecting(false);
    });
    
    socket.on('disconnect', () => {
      setIsConnected(false);
    });
    
    socket.on('reconnecting', () => {
      setReconnecting(true);
    });
    
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);
  
  // Émettre un événement
  const emit = useCallback((event, data) => {
    if (socketRef.current) {
      socketRef.current.emit(event, data);
    }
  }, []);
  
  // Écouter un événement
  const on = useCallback((event, handler) => {
    if (socketRef.current) {
      socketRef.current.on(event, handler);
      return () => socketRef.current?.off(event, handler);
    }
    return () => {};
  }, []);
  
  return {
    socket: socketRef.current,
    isConnected,
    reconnecting,
    emit,
    on,
  };
}

export default createOptimizedSocket;

