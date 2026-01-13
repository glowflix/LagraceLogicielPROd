/**
 * ═══════════════════════════════════════════════════════════════════════════
 * USE SMART SYNC - Auto-actualisation intelligente temps réel
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Système PRO de synchronisation réseau local avec:
 * - Polling intelligent toutes les 2 secondes
 * - Détection de changements via hash/version
 * - ✅ PROTECTION SAISIE: Ne perturbe JAMAIS l'utilisateur qui tape
 * - Ne re-render que si données changées
 * - WebSocket pour propagation temps réel
 * - Reconnexion automatique + rattrapage
 * - Opérations idempotentes (basées sur UUID/timestamp)
 */

import { useState, useEffect, useRef, useCallback, startTransition } from 'react';
import { io } from 'socket.io-client';
import { getSocketUrl } from '../utils/apiConfig.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const SMART_SYNC_CONFIG = {
  POLL_INTERVAL: 2000,           // 2 secondes
  RECONNECT_DELAY: 500,          // 500ms avant reconnexion
  MAX_RECONNECT_DELAY: 5000,     // Max 5s entre reconnexions
  CATCHUP_ON_RECONNECT: true,    // Rattrapage après reconnexion
  LOG_ENABLED: false,            // ✅ Logs désactivés par défaut (moins de spam)
  HASH_ALGORITHM: 'simple',      // Algorithme de hash simplifié
  
  // ✅ PROTECTION SAISIE UTILISATEUR
  USER_TYPING_DELAY: 3000,       // Délai après dernière frappe avant sync (3s)
  MIN_IDLE_BEFORE_SYNC: 1500,    // Minimum 1.5s d'inactivité avant de sync
};

// #region agent log
// ✅ DEBUG: Système de logs localStorage (pour Debug Mode)
const DEBUG_LOG_KEY = 'smart_sync_debug_logs';
function debugLog(location, message, data = {}) {
  try {
    const logs = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || '[]');
    logs.push({ t: Date.now(), loc: location, msg: message, d: data });
    // Garder seulement les 100 derniers logs
    if (logs.length > 100) logs.shift();
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(logs));
    console.log(`[DEBUG ${location}]`, message, data);
  } catch (e) { /* ignore */ }
}
// Pour lire les logs: JSON.parse(localStorage.getItem('smart_sync_debug_logs'))
// Pour effacer: localStorage.removeItem('smart_sync_debug_logs')
// #endregion

// ═══════════════════════════════════════════════════════════════════════════
// SYSTÈME GLOBAL DE PROTECTION DES SAISIES + PRÉSERVATION POSITION
// ═══════════════════════════════════════════════════════════════════════════

let globalIsUserTyping = false;
let globalLastInputAt = 0;
let globalActiveInput = null;
let globalTypingTimeoutId = null;

/**
 * ✅ Détecte si l'utilisateur est en train de taper
 * Renvoie true si l'utilisateur a tapé dans les dernières 3 secondes
 */
export function isUserCurrentlyTyping() {
  const now = Date.now();
  const timeSinceLastInput = now - globalLastInputAt;
  
  // L'utilisateur est considéré "en train de taper" si:
  // 1. Le flag global est actif
  // 2. OU il a tapé dans les dernières 3 secondes
  // 3. ET un input est actuellement focus
  return globalIsUserTyping || (
    timeSinceLastInput < SMART_SYNC_CONFIG.USER_TYPING_DELAY && 
    globalActiveInput !== null
  );
}

/**
 * ✅ Vérifie si on peut faire un sync maintenant sans perturber
 */
export function canSyncNow() {
  if (isUserCurrentlyTyping()) return false;
  
  const now = Date.now();
  const timeSinceLastInput = now - globalLastInputAt;
  
  // On peut sync si aucune activité depuis MIN_IDLE_BEFORE_SYNC
  return timeSinceLastInput >= SMART_SYNC_CONFIG.MIN_IDLE_BEFORE_SYNC;
}

/**
 * ✅ Enregistre l'activité de saisie (appelé par les composants)
 */
export function registerUserTyping(inputElement = null) {
  globalIsUserTyping = true;
  globalLastInputAt = Date.now();
  globalActiveInput = inputElement;
  
  // Reset le timeout
  if (globalTypingTimeoutId) {
    clearTimeout(globalTypingTimeoutId);
  }
  
  // Marquer comme "plus en train de taper" après le délai
  globalTypingTimeoutId = setTimeout(() => {
    globalIsUserTyping = false;
  }, SMART_SYNC_CONFIG.USER_TYPING_DELAY);
}

/**
 * ✅ Signale que l'utilisateur a fini de taper
 */
export function clearUserTyping() {
  globalIsUserTyping = false;
  globalActiveInput = null;
  
  if (globalTypingTimeoutId) {
    clearTimeout(globalTypingTimeoutId);
    globalTypingTimeoutId = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ✅ SYSTÈME DE PRÉSERVATION DE POSITION (scroll, focus, curseur)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ✅ Sauvegarde l'état actuel de l'UI (scroll, focus, curseur)
 */
export function saveUIState() {
  const state = {
    // Position du scroll de la fenêtre
    scrollX: window.scrollX || window.pageXOffset || 0,
    scrollY: window.scrollY || window.pageYOffset || 0,
    
    // Element focus actuel
    activeElement: document.activeElement,
    activeElementId: document.activeElement?.id || null,
    activeElementName: document.activeElement?.name || null,
    activeElementSelector: null,
    
    // Position du curseur dans l'input
    selectionStart: null,
    selectionEnd: null,
    inputValue: null,
    
    // Scrolls des conteneurs scrollables visibles
    scrollableContainers: [],
  };
  
  // #region agent log
  debugLog('saveUIState', 'H2: Saving UI state', {activeTagName:document.activeElement?.tagName,activeId:document.activeElement?.id,activeName:document.activeElement?.name,scrollY:state.scrollY,hasActiveInput:!!globalActiveInput});
  // #endregion
  
  // Sauvegarder la sélection du curseur si c'est un input/textarea
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    try {
      state.selectionStart = active.selectionStart;
      state.selectionEnd = active.selectionEnd;
      state.inputValue = active.value;
    } catch (e) {
      // Certains types d'input ne supportent pas selectionStart
    }
    
    // Créer un sélecteur unique pour retrouver l'élément
    if (active.id) {
      state.activeElementSelector = `#${active.id}`;
    } else if (active.name) {
      state.activeElementSelector = `[name="${active.name}"]`;
    } else if (active.dataset?.rowid) {
      state.activeElementSelector = `[data-rowid="${active.dataset.rowid}"] input, [data-rowid="${active.dataset.rowid}"] textarea`;
    } else {
      // ✅ FALLBACK: Chercher data-rowid dans le parent (pour les inputs dans les tableaux)
      const parentWithRowId = active.closest?.('[data-rowid]');
      if (parentWithRowId) {
        const rowId = parentWithRowId.dataset.rowid;
        state.activeElementSelector = `[data-rowid="${rowId}"] ${active.tagName.toLowerCase()}:focus, [data-rowid="${rowId}"] ${active.tagName.toLowerCase()}[autofocus]`;
        // Aussi stocker le rowid pour référence
        state.parentRowId = rowId;
      } else if (active.placeholder) {
        // ✅ FALLBACK 2: Utiliser le placeholder comme sélecteur
        const escaped = active.placeholder.replace(/"/g, '\\"');
        state.activeElementSelector = `${active.tagName.toLowerCase()}[placeholder="${escaped}"]`;
      } else if (active.className) {
        // ✅ FALLBACK 3: Utiliser les classes uniques
        const classes = active.className.split(' ').filter(c => c && !c.includes('focus') && !c.includes('hover')).slice(0, 3).join('.');
        if (classes) {
          state.activeElementSelector = `${active.tagName.toLowerCase()}.${classes}`;
        }
      }
    }
  }
  
  // Sauvegarder les scrolls des conteneurs principaux
  try {
    const scrollableSelectors = [
      '.overflow-y-auto',
      '.overflow-auto', 
      '[data-scroll-container]',
      'main',
      '.main-content',
      '.card',
    ];
    
    scrollableSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach((el, idx) => {
        if (el.scrollTop > 0 || el.scrollLeft > 0) {
          state.scrollableContainers.push({
            selector: selector,
            index: idx,
            scrollTop: el.scrollTop,
            scrollLeft: el.scrollLeft,
            // Identifier unique basé sur position/taille
            rect: el.getBoundingClientRect(),
          });
        }
      });
    });
  } catch (e) {
    // Ignorer les erreurs
  }
  
  return state;
}

/**
 * ✅ Restaure l'état de l'UI après une mise à jour
 */
export function restoreUIState(state, options = {}) {
  if (!state) return;
  
  const { restoreFocus = true, restoreScroll = true, restoreCursor = true } = options;
  
  // Utiliser requestAnimationFrame pour s'assurer que le DOM est stable
  requestAnimationFrame(() => {
    // 1. Restaurer le scroll de la fenêtre
    if (restoreScroll && (state.scrollX > 0 || state.scrollY > 0)) {
      try {
        window.scrollTo({
          left: state.scrollX,
          top: state.scrollY,
          behavior: 'instant', // Pas d'animation pour éviter les glitchs
        });
      } catch (e) {
        window.scrollTo(state.scrollX, state.scrollY);
      }
    }
    
    // 2. Restaurer les scrolls des conteneurs
    if (restoreScroll && state.scrollableContainers?.length > 0) {
      state.scrollableContainers.forEach(container => {
        try {
          const elements = document.querySelectorAll(container.selector);
          const el = elements[container.index];
          if (el) {
            el.scrollTop = container.scrollTop;
            el.scrollLeft = container.scrollLeft;
          }
        } catch (e) {
          // Ignorer
        }
      });
    }
    
    // 3. Restaurer le focus
    // #region agent log
    debugLog('restoreUIState', 'H4: Restoring UI state', {restoreFocus,restoreCursor,selector:state.activeElementSelector,selectionStart:state.selectionStart,inputValue:state.inputValue?.substring(0,20)});
    // #endregion
    if (restoreFocus && state.activeElementSelector) {
      try {
        // Essayer de retrouver l'élément par sélecteur
        const targetElement = document.querySelector(state.activeElementSelector);
        
        // #region agent log
        debugLog('restoreUIState-focus', 'H4: Focus target found', {found:!!targetElement,selector:state.activeElementSelector,currentActiveTag:document.activeElement?.tagName});
        // #endregion
        
        if (targetElement && targetElement !== document.body) {
          // Focus sans scroll
          targetElement.focus({ preventScroll: true });
          
          // 4. Restaurer la position du curseur
          if (restoreCursor && state.selectionStart !== null) {
            try {
              // Restaurer la valeur si elle a été écrasée
              if (state.inputValue !== null && targetElement.value !== state.inputValue) {
                // Ne PAS restaurer la valeur si elle a changé (l'utilisateur a tapé)
                // Mais restaurer la position du curseur à la fin
                const len = targetElement.value.length;
                targetElement.setSelectionRange(len, len);
              } else {
                // Restaurer la position exacte du curseur
                targetElement.setSelectionRange(state.selectionStart, state.selectionEnd);
              }
            } catch (e) {
              // Certains inputs ne supportent pas setSelectionRange
            }
          }
        }
      } catch (e) {
        // L'élément n'existe peut-être plus
      }
    }
  });
}

/**
 * ✅ Exécute une mise à jour de données en préservant l'état de l'UI
 * @param {Function} updateFn - Fonction qui fait la mise à jour
 * @param {Object} options - Options de restauration
 */
export async function updateWithUIPreservation(updateFn, options = {}) {
  // 1. Sauvegarder l'état actuel
  const savedState = saveUIState();
  
  // 2. Exécuter la mise à jour
  try {
    await updateFn();
  } finally {
    // 3. Restaurer l'état après un court délai (pour que React ait fini)
    setTimeout(() => {
      restoreUIState(savedState, options);
    }, 10);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LISTENER GLOBAL DE SAISIE (s'active automatiquement)
// ═══════════════════════════════════════════════════════════════════════════

if (typeof document !== 'undefined') {
  // Détecter quand l'utilisateur tape
  document.addEventListener('input', (e) => {
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      // #region agent log
      debugLog('input-listener', 'H1: Input detected', {tagName:target.tagName,id:target.id,name:target.name,value:target.value?.substring(0,30),placeholder:target.placeholder});
      // #endregion
      registerUserTyping(target);
    }
  }, { capture: true, passive: true });
  
  // Détecter quand l'utilisateur focus un input
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      globalActiveInput = target;
    }
  }, { capture: true, passive: true });
  
  // Détecter quand l'utilisateur quitte un input
  document.addEventListener('focusout', (e) => {
    const target = e.target;
    if (target === globalActiveInput) {
      // Petit délai avant de marquer comme "plus actif"
      setTimeout(() => {
        if (globalActiveInput === target) {
          globalActiveInput = null;
        }
      }, 100);
    }
  }, { capture: true, passive: true });
  
  // Détecter les frappes clavier
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      registerUserTyping(target);
    }
  }, { capture: true, passive: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Génère un hash simple pour comparer les données
 */
function generateSimpleHash(data) {
  if (!data) return '0';
  if (Array.isArray(data)) {
    const len = data.length;
    if (len === 0) return 'empty';
    
    const first = data[0];
    const last = data[len - 1];
    
    const firstId = first?.id || first?.uuid || first?.updated_at || '';
    const lastId = last?.id || last?.uuid || last?.updated_at || '';
    const maxUpdated = data.reduce((max, item) => {
      const ts = item?.updated_at || item?.synced_at || item?.created_at || '';
      return ts > max ? ts : max;
    }, '');
    
    return `${len}-${firstId}-${lastId}-${maxUpdated}`;
  }
  
  if (typeof data === 'object') {
    return `${data.version || data.updated_at || data.id || JSON.stringify(data).length}`;
  }
  
  return String(data);
}

/**
 * Compare deux datasets de manière efficace
 */
function hasDataChanged(oldData, newData) {
  const oldHash = generateSimpleHash(oldData);
  const newHash = generateSimpleHash(newData);
  return oldHash !== newHash;
}

/**
 * Trouve les éléments modifiés entre deux tableaux (par ID)
 */
function findChangedItems(oldItems = [], newItems = []) {
  const oldMap = new Map(oldItems.map(item => [item.id || item.uuid, item]));
  const newMap = new Map(newItems.map(item => [item.id || item.uuid, item]));
  
  const added = [];
  const updated = [];
  const removed = [];
  
  newItems.forEach(newItem => {
    const id = newItem.id || newItem.uuid;
    const oldItem = oldMap.get(id);
    
    if (!oldItem) {
      added.push(newItem);
    } else {
      const oldTs = oldItem.updated_at || oldItem.synced_at || '';
      const newTs = newItem.updated_at || newItem.synced_at || '';
      
      if (newTs > oldTs || generateSimpleHash(oldItem) !== generateSimpleHash(newItem)) {
        updated.push(newItem);
      }
    }
  });
  
  oldItems.forEach(oldItem => {
    const id = oldItem.id || oldItem.uuid;
    if (!newMap.has(id)) {
      removed.push(oldItem);
    }
  });
  
  return { added, updated, removed, hasChanges: added.length > 0 || updated.length > 0 || removed.length > 0 };
}

/**
 * Logger conditionnel
 */
function log(level, ...args) {
  if (!SMART_SYNC_CONFIG.LOG_ENABLED) return;
  
  const prefix = '🔄 [SmartSync]';
  const timestamp = new Date().toLocaleTimeString();
  
  switch (level) {
    case 'info':
      console.log(`${prefix} [${timestamp}]`, ...args);
      break;
    case 'warn':
      console.warn(`${prefix} [${timestamp}]`, ...args);
      break;
    case 'error':
      console.error(`${prefix} [${timestamp}]`, ...args);
      break;
    case 'debug':
      console.debug(`${prefix} [${timestamp}]`, ...args);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON SOCKET - Une seule connexion pour toute l'app
// ═══════════════════════════════════════════════════════════════════════════

let globalSocket = null;
let socketListeners = new Map();
let reconnectAttempt = 0;
let lastConnectedAt = null;

function getGlobalSocket() {
  if (globalSocket && globalSocket.connected) {
    return globalSocket;
  }
  
  if (globalSocket) {
    return globalSocket;
  }
  
  const socketUrl = getSocketUrl();
  log('info', `Connexion WebSocket à ${socketUrl}...`);
  
  globalSocket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: SMART_SYNC_CONFIG.RECONNECT_DELAY,
    reconnectionDelayMax: SMART_SYNC_CONFIG.MAX_RECONNECT_DELAY,
    reconnectionAttempts: Infinity,
    timeout: 5000,
    pingTimeout: 10000,
    pingInterval: 3000,
    autoConnect: true,
  });
  
  globalSocket.on('connect', () => {
    const wasReconnect = lastConnectedAt !== null;
    lastConnectedAt = Date.now();
    reconnectAttempt = 0;
    
    log('info', `✅ Connecté (socket: ${globalSocket.id})${wasReconnect ? ' [RECONNEXION]' : ''}`);
    
    socketListeners.forEach((callbacks, event) => {
      if (event === 'connect') {
        callbacks.forEach(cb => cb({ reconnected: wasReconnect }));
      }
    });
    
    if (wasReconnect && SMART_SYNC_CONFIG.CATCHUP_ON_RECONNECT) {
      log('info', '🔄 Rattrapage des données après reconnexion...');
      socketListeners.forEach((callbacks, event) => {
        if (event === 'catchup') {
          callbacks.forEach(cb => cb());
        }
      });
    }
  });
  
  globalSocket.on('disconnect', (reason) => {
    log('warn', `❌ Déconnecté: ${reason}`);
    
    socketListeners.forEach((callbacks, event) => {
      if (event === 'disconnect') {
        callbacks.forEach(cb => cb({ reason }));
      }
    });
  });
  
  globalSocket.on('reconnect_attempt', (attempt) => {
    reconnectAttempt = attempt;
    if (attempt % 5 === 0) {
      log('info', `🔄 Tentative de reconnexion ${attempt}...`);
    }
  });
  
  globalSocket.on('reconnect_error', (error) => {
    log('error', 'Erreur reconnexion:', error.message);
  });
  
  return globalSocket;
}

function addSocketListener(event, callback) {
  if (!socketListeners.has(event)) {
    socketListeners.set(event, new Set());
  }
  socketListeners.get(event).add(callback);
  
  if (!['connect', 'disconnect', 'catchup'].includes(event)) {
    const socket = getGlobalSocket();
    socket.on(event, callback);
  }
  
  return () => removeSocketListener(event, callback);
}

function removeSocketListener(event, callback) {
  if (socketListeners.has(event)) {
    socketListeners.get(event).delete(callback);
  }
  
  if (!['connect', 'disconnect', 'catchup'].includes(event)) {
    const socket = getGlobalSocket();
    socket.off(event, callback);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK PRINCIPAL: useSmartSync
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook d'auto-actualisation intelligente
 * 
 * ✅ PROTECTION SAISIE: Ne met JAMAIS à jour pendant que l'utilisateur tape
 * Les mises à jour sont différées jusqu'à ce que l'utilisateur soit inactif
 * 
 * @param {string} dataType - Type de données ('products', 'sales', 'debts', etc.)
 * @param {Function} fetchFn - Fonction pour récupérer les données
 * @param {Object} options - Options de configuration
 * @returns {Object} { data, loading, error, refresh, lastUpdate, isConnected, changes }
 */
export function useSmartSync(dataType, fetchFn, options = {}) {
  const {
    pollInterval = SMART_SYNC_CONFIG.POLL_INTERVAL,
    enabled = true,
    initialData = null,
    transform = (data) => data,
    onDataChange = null,
    socketEvents = [],
    debounceMs = 100,
    // ✅ Nouvelles options pour la protection des saisies
    respectUserTyping = true,      // Respecter la saisie utilisateur
    updateDuringTyping = false,    // Forcer update même pendant saisie (false par défaut)
  } = options;
  
  // États
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [changes, setChanges] = useState({ added: [], updated: [], removed: [], hasChanges: false });
  
  // ✅ Buffer pour les mises à jour différées (via ref pour éviter re-render)
  
  // Refs
  const dataRef = useRef(data);
  const mountedRef = useRef(true);
  const pollTimeoutRef = useRef(null);
  const lastFetchRef = useRef(0);
  const pendingUpdateRef = useRef(null);
  const deferredUpdateRef = useRef(null);
  const pendingDataRef = useRef(null); // ✅ Pour stockage sans re-render
  
  // Mettre à jour la ref quand data change
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  
  // ═══════════════════════════════════════════════════════════════════════
  // ✅ MISES À JOUR DIFFÉRÉES: Géré via pendingDataRef + setTimeout
  // (Ancien système basé sur state supprimé pour éviter re-renders)
  // ═══════════════════════════════════════════════════════════════════════
  
  // ═══════════════════════════════════════════════════════════════════════
  // FETCH INTELLIGENT AVEC PROTECTION SAISIE
  // ═══════════════════════════════════════════════════════════════════════
  
  const fetchData = useCallback(async (force = false) => {
    if (!enabled || !mountedRef.current) return;
    
    // Debounce
    const now = Date.now();
    if (!force && now - lastFetchRef.current < debounceMs) {
      return;
    }
    lastFetchRef.current = now;
    
    try {
      const result = await fetchFn();
      
      if (!mountedRef.current) return;
      
      const transformedData = transform(result);
      const dataChanged = hasDataChanged(dataRef.current, transformedData);
      
      if (dataChanged) {
        const detailedChanges = findChangedItems(dataRef.current || [], transformedData || []);
        
        log('info', `📊 ${dataType}: Données modifiées!`, {
          added: detailedChanges.added.length,
          updated: detailedChanges.updated.length,
          removed: detailedChanges.removed.length,
        });
        
        // ✅ PROTECTION SAISIE: Vérifier si l'utilisateur tape
        const typingNow = isUserCurrentlyTyping();
        // #region agent log
        debugLog('dataChanged', 'H3: Data changed - checking typing', {typingNow,respectUserTyping,updateDuringTyping,dataType,changesCount:detailedChanges.added.length+detailedChanges.updated.length});
        // #endregion
        if (respectUserTyping && typingNow && !updateDuringTyping) {
          // ✅ Mettre en buffer, appliquer plus tard
          log('info', `⏳ ${dataType}: Utilisateur actif, mise à jour différée`);
          // #region agent log
          debugLog('deferred', 'H3: Update DEFERRED (user typing)', {dataType});
          // #endregion
          // ✅ UTILISER REF au lieu de STATE pour éviter re-render
          pendingDataRef.current = transformedData;
          // Juste déclencher le check périodique si pas déjà actif
          if (!deferredUpdateRef.current) {
            deferredUpdateRef.current = setTimeout(() => {
              if (canSyncNow() && pendingDataRef.current) {
                const toApply = pendingDataRef.current;
                pendingDataRef.current = null;
                debugLog('deferred-apply', 'Applying deferred data', {dataType});
                const savedUIState = saveUIState();
                startTransition(() => {
                  setData(toApply);
                  setLastUpdate(new Date().toISOString());
                });
                setTimeout(() => restoreUIState(savedUIState), 50);
              }
              deferredUpdateRef.current = null;
            }, 3000);
          }
        } else {
          // #region agent log
          debugLog('immediate', 'H3: Update IMMEDIATE (not typing)', {dataType});
          // #endregion
          // ✅ SAUVEGARDER L'ÉTAT DE L'UI AVANT
          const savedUIState = saveUIState();
          
          // ✅ Appliquer immédiatement avec startTransition
          startTransition(() => {
            setData(transformedData);
            setChanges(detailedChanges);
            setLastUpdate(new Date().toISOString());
          });
          
          // ✅ RESTAURER L'ÉTAT DE L'UI APRÈS (avec délai pour React)
          setTimeout(() => {
            restoreUIState(savedUIState, {
              restoreFocus: true,
              restoreScroll: true,
              restoreCursor: true,
            });
          }, 50);
        }
        
        // Callback si fourni
        if (onDataChange) {
          onDataChange(transformedData, detailedChanges);
        }
      }
      
      setError(null);
      setLoading(false);
      
      return transformedData;
    } catch (err) {
      if (!mountedRef.current) return;
      
      log('error', `Erreur fetch ${dataType}:`, err.message);
      setError(err);
      setLoading(false);
      
      return dataRef.current;
    }
  }, [dataType, enabled, fetchFn, transform, onDataChange, debounceMs, respectUserTyping, updateDuringTyping]);
  
  // ═══════════════════════════════════════════════════════════════════════
  // POLLING INTELLIGENT
  // ═══════════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    if (!enabled) return;
    
    const poll = () => {
      // ✅ Ne pas faire de fetch si l'utilisateur tape (sauf si forcé)
      const userTyping = isUserCurrentlyTyping();
      // #region agent log
      debugLog('poll', 'H3: Polling check', {userTyping,respectUserTyping,globalIsUserTyping,timeSinceLastInput:Date.now()-globalLastInputAt,hasActiveInput:!!globalActiveInput,dataType});
      // #endregion
      if (respectUserTyping && userTyping) {
        // Reporter le polling
        if (mountedRef.current && enabled) {
          pollTimeoutRef.current = setTimeout(poll, 500); // Réessayer dans 500ms
        }
        return;
      }
      
      fetchData(false).finally(() => {
        if (mountedRef.current && enabled) {
          pollTimeoutRef.current = setTimeout(poll, pollInterval);
        }
      });
    };
    
    // Premier fetch immédiat
    fetchData(true);
    
    // Démarrer le polling
    pollTimeoutRef.current = setTimeout(poll, pollInterval);
    
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [enabled, pollInterval, fetchData, respectUserTyping]);
  
  // ═══════════════════════════════════════════════════════════════════════
  // WEBSOCKET EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    if (!enabled) return;
    
    const socket = getGlobalSocket();
    const cleanupFns = [];
    
    const handleConnect = ({ reconnected } = {}) => {
      setIsConnected(true);
      if (reconnected) {
        log('info', `${dataType}: Reconnecté, rafraîchissement...`);
        // ✅ Différer le fetch si l'utilisateur tape
        if (!isUserCurrentlyTyping()) {
          fetchData(true);
        } else {
          // Réessayer dans 2s
          setTimeout(() => fetchData(true), 2000);
        }
      }
    };
    
    const handleDisconnect = () => {
      setIsConnected(false);
    };
    
    const handleCatchup = () => {
      log('info', `${dataType}: Rattrapage déclenché`);
      // ✅ Différer si l'utilisateur tape
      if (!isUserCurrentlyTyping()) {
        fetchData(true);
      } else {
        setTimeout(() => fetchData(true), 2000);
      }
    };
    
    cleanupFns.push(addSocketListener('connect', handleConnect));
    cleanupFns.push(addSocketListener('disconnect', handleDisconnect));
    cleanupFns.push(addSocketListener('catchup', handleCatchup));
    
    // Écouter les événements personnalisés
    socketEvents.forEach(event => {
      const handler = (eventData) => {
        log('info', `${dataType}: Événement WebSocket reçu: ${event}`, eventData);
        
        if (pendingUpdateRef.current) {
          clearTimeout(pendingUpdateRef.current);
        }
        
        // ✅ Délai plus long si l'utilisateur tape
        const delay = isUserCurrentlyTyping() ? 2000 : 100;
        
        pendingUpdateRef.current = setTimeout(() => {
          fetchData(true);
          pendingUpdateRef.current = null;
        }, delay);
      };
      
      cleanupFns.push(addSocketListener(event, handler));
    });
    
    setIsConnected(socket.connected);
    
    return () => {
      cleanupFns.forEach(cleanup => cleanup());
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
    };
  }, [enabled, dataType, socketEvents, fetchData]);
  
  // ═══════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
      if (deferredUpdateRef.current) {
        clearTimeout(deferredUpdateRef.current);
      }
    };
  }, []);
  
  // ═══════════════════════════════════════════════════════════════════════
  // REFRESH MANUEL
  // ═══════════════════════════════════════════════════════════════════════
  
  const refresh = useCallback(() => {
    log('info', `${dataType}: Refresh manuel déclenché`);
    return fetchData(true);
  }, [dataType, fetchData]);
  
  // ═══════════════════════════════════════════════════════════════════════
  // EMIT EVENT
  // ═══════════════════════════════════════════════════════════════════════
  
  const emit = useCallback((event, payload) => {
    const socket = getGlobalSocket();
    if (socket && socket.connected) {
      socket.emit(event, payload);
      log('info', `${dataType}: Événement émis: ${event}`);
    } else {
      log('warn', `${dataType}: Socket non connecté, événement ${event} non émis`);
    }
  }, [dataType]);
  
  return {
    data,
    loading,
    error,
    refresh,
    lastUpdate,
    isConnected,
    changes,
    emit,
    hasPendingUpdate: pendingDataRef.current !== null,
    // Helpers
    isEmpty: !data || (Array.isArray(data) && data.length === 0),
    hasData: !!data && (!Array.isArray(data) || data.length > 0),
    isStale: lastUpdate && (Date.now() - new Date(lastUpdate).getTime() > pollInterval * 3),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS SPÉCIALISÉS
// ═══════════════════════════════════════════════════════════════════════════

const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

/**
 * Hook pour les produits avec sync temps réel
 * ✅ Protège automatiquement les saisies utilisateur
 */
export function useSmartProducts(options = {}) {
  const fetchProducts = useCallback(async () => {
    const response = await fetch(`${API_URL}/api/products`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Erreur chargement produits');
    return response.json();
  }, []);
  
  return useSmartSync('products', fetchProducts, {
    pollInterval: 2000,
    socketEvents: ['product:updated', 'product:created', 'product:deleted', 'stock:updated'],
    respectUserTyping: true,  // ✅ Protéger les saisies
    ...options,
  });
}

/**
 * Hook pour les ventes avec sync temps réel
 */
export function useSmartSales(filters = {}, options = {}) {
  const filtersStr = JSON.stringify(filters);
  
  const fetchSales = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.from) params.append('from', filters.from);
    if (filters.to) params.append('to', filters.to);
    if (filters.status) params.append('status', filters.status);
    if (filters.limit) params.append('limit', filters.limit);
    
    const response = await fetch(`${API_URL}/api/sales?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Erreur chargement ventes');
    return response.json();
  }, [filtersStr]);
  
  return useSmartSync('sales', fetchSales, {
    pollInterval: 2000,
    socketEvents: ['sale:created', 'sale:updated', 'sale:deleted'],
    respectUserTyping: true,
    ...options,
  });
}

/**
 * Hook pour les dettes avec sync temps réel
 */
export function useSmartDebts(options = {}) {
  const fetchDebts = useCallback(async () => {
    const response = await fetch(`${API_URL}/api/debts`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Erreur chargement dettes');
    return response.json();
  }, []);
  
  return useSmartSync('debts', fetchDebts, {
    pollInterval: 2000,
    socketEvents: ['debt:updated', 'debt:created', 'debt:paid'],
    respectUserTyping: true,
    ...options,
  });
}

/**
 * Hook pour le taux de change avec sync temps réel
 */
export function useSmartRate(options = {}) {
  const fetchRate = useCallback(async () => {
    const response = await fetch(`${API_URL}/api/rates/current`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('Erreur chargement taux');
    const data = await response.json();
    return data.rate || data;
  }, []);
  
  return useSmartSync('rate', fetchRate, {
    pollInterval: 10000,
    socketEvents: ['rate:updated'],
    respectUserTyping: false, // Le taux peut se mettre à jour sans problème
    ...options,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK DE CONNEXION WEBSOCKET POUR COMPOSANTS UI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook simple pour l'état de connexion WebSocket
 */
export function useWebSocketStatus() {
  const [isConnected, setIsConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastPing, setLastPing] = useState(null);
  
  useEffect(() => {
    const socket = getGlobalSocket();
    
    const handleConnect = () => {
      setIsConnected(true);
      setReconnecting(false);
      setLastPing(Date.now());
    };
    
    const handleDisconnect = () => {
      setIsConnected(false);
    };
    
    const handleReconnecting = () => {
      setReconnecting(true);
    };
    
    const handlePong = () => {
      setLastPing(Date.now());
    };
    
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('reconnecting', handleReconnecting);
    socket.on('pong', handlePong);
    
    setIsConnected(socket.connected);
    
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnecting', handleReconnecting);
      socket.off('pong', handlePong);
    };
  }, []);
  
  return { isConnected, reconnecting, lastPing };
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK POUR SAVOIR SI L'UTILISATEUR TAPE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ✅ Hook pour les composants qui veulent savoir si l'utilisateur tape
 */
export function useIsUserTyping() {
  const [isTyping, setIsTyping] = useState(false);
  
  useEffect(() => {
    const checkTyping = () => {
      setIsTyping(isUserCurrentlyTyping());
    };
    
    // Vérifier régulièrement
    const interval = setInterval(checkTyping, 200);
    checkTyping();
    
    return () => clearInterval(interval);
  }, []);
  
  return isTyping;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export {
  getGlobalSocket,
  addSocketListener,
  removeSocketListener,
  generateSimpleHash,
  hasDataChanged,
  findChangedItems,
  // Note: isUserCurrentlyTyping, canSyncNow, registerUserTyping, clearUserTyping,
  // saveUIState, restoreUIState, updateWithUIPreservation sont déjà exportés directement
};

export default useSmartSync;
