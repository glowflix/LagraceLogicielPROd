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
 * Configuration par défaut pour Socket.IO
 */
const DEFAULT_CONFIG = {
  // Transport
  transports: ['websocket', 'polling'], // WebSocket prioritaire, polling fallback
  
  // Reconnexion robuste
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,  // Max 10s entre tentatives
  reconnectionAttempts: Infinity,
  
  // Timeouts adaptés au LAN
  timeout: 20000,               // 20s pour connexion
  pingTimeout: 30000,           // 30s avant de considérer déconnecté
  pingInterval: 15000,          // Ping toutes les 15s
  
  // Performance
  forceNew: false,
  multiplex: true,
  
  // Buffer pour messages offline
  volatile: false,              // Garantir la livraison
  
  // Options avancées
  autoConnect: true,
  upgrade: true,                // Tenter upgrade polling → websocket
  rememberUpgrade: true,        // Se souvenir du transport fonctionnel
  
  // Compression (si supporté)
  perMessageDeflate: {
    threshold: 1024,            // Compresser si > 1KB
  },
};

/**
 * Configuration spécifique pour le mode LAN
 */
const LAN_CONFIG = {
  ...DEFAULT_CONFIG,
  
  // Timeouts plus longs pour le LAN
  timeout: 30000,               // 30s (réseau peut être plus lent)
  pingTimeout: 60000,           // 60s
  pingInterval: 25000,          // 25s
  
  // Reconnexion plus agressive
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
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
  
  // Throttlers pour événements fréquents
  const throttlers = {
    'product:updated': throttle((data) => {
      socket._originalEmit('product:updated', data);
    }, 500),
    
    'stock:updated': throttle((data) => {
      socket._originalEmit('stock:updated', data);
    }, 500),
    
    'rate:updated': throttle((data) => {
      socket._originalEmit('rate:updated', data);
    }, 1000),
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
 * Crée un handler d'événements throttlé pour le store
 */
export function createThrottledEventHandler(socket, store) {
  const handlers = {
    // Produits: batch + throttle
    'product:updated': throttle((product) => {
      store.setState((state) => ({
        products: state.products.map((p) =>
          p.id === product.id ? { ...p, ...product } : p
        ),
      }));
    }, 300),
    
    // Batch de produits
    'products:batch-updated': debounce((products) => {
      store.setState((state) => {
        const productMap = new Map(products.map(p => [p.id, p]));
        return {
          products: state.products.map((p) =>
            productMap.has(p.id) ? { ...p, ...productMap.get(p.id) } : p
          ),
        };
      });
    }, 200),
    
    // Stock: throttle pour éviter trop de re-renders
    'stock:updated': throttle((stock) => {
      store.setState((state) => ({
        stock: state.stock.map((s) =>
          s.id === stock.id ? { ...s, ...stock } : s
        ),
      }));
    }, 300),
    
    // Ventes: pas de throttle (critique)
    'sale:created': (sale) => {
      store.setState((state) => ({
        sales: [sale, ...state.sales].slice(0, 100), // Garder les 100 dernières
      }));
    },
    
    // Taux: throttle fort (change rarement)
    'rate:updated': throttle((rate) => {
      store.setState({ currentRate: rate.rate });
    }, 2000),
    
    // Dettes: pas de throttle
    'debt:updated': (debt) => {
      store.setState((state) => ({
        debts: state.debts.map((d) =>
          d.id === debt.id ? { ...d, ...debt } : d
        ),
      }));
    },
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

