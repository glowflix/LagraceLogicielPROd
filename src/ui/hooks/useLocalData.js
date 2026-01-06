/**
 * ═══════════════════════════════════════════════════════════════════════════
 * USE LOCAL DATA - Hooks de données local-first ultra-rapides
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Principe LOCAL-FIRST:
 * 1. Afficher immédiatement les données du cache local
 * 2. Charger en arrière-plan depuis l'API
 * 3. Mettre à jour silencieusement si nouvelles données
 * 
 * Résultat: UI instantanée, jamais de loading visible pour l'utilisateur
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';

// API URL dynamique
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

// ═══════════════════════════════════════════════════════════════════════════
// CACHE LOCAL EN MÉMOIRE (plus rapide que localStorage)
// ═══════════════════════════════════════════════════════════════════════════

const memoryCache = new Map();
const cacheTimestamps = new Map();
const pendingRequests = new Map();

// Durée de validité du cache (en ms)
const CACHE_TTL = {
  products: 60000,      // 1 minute
  sales: 30000,         // 30 secondes
  debts: 30000,         // 30 secondes
  analytics: 60000,     // 1 minute
  users: 300000,        // 5 minutes
  rates: 120000,        // 2 minutes
  default: 30000,       // 30 secondes
};

/**
 * Vérifier si le cache est encore valide
 */
function isCacheValid(key, ttl) {
  const timestamp = cacheTimestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < ttl;
}

/**
 * Sauvegarder dans le cache
 */
function setCache(key, data) {
  memoryCache.set(key, data);
  cacheTimestamps.set(key, Date.now());
  
  // Aussi sauvegarder dans localStorage pour persistence
  try {
    localStorage.setItem(`cache_${key}`, JSON.stringify({
      data,
      timestamp: Date.now(),
    }));
  } catch (e) {
    // localStorage plein, pas grave
  }
}

/**
 * Récupérer du cache
 */
function getCache(key) {
  // D'abord la mémoire (plus rapide)
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }
  
  // Ensuite localStorage
  try {
    const stored = localStorage.getItem(`cache_${key}`);
    if (stored) {
      const { data, timestamp } = JSON.parse(stored);
      memoryCache.set(key, data);
      cacheTimestamps.set(key, timestamp);
      return data;
    }
  } catch (e) {
    // Erreur de parsing, pas grave
  }
  
  return null;
}

/**
 * Invalider le cache
 */
export function invalidateCache(key) {
  if (key) {
    memoryCache.delete(key);
    cacheTimestamps.delete(key);
    try {
      localStorage.removeItem(`cache_${key}`);
    } catch (e) {}
  } else {
    // Invalider tout le cache
    memoryCache.clear();
    cacheTimestamps.clear();
    // Ne pas vider localStorage pour garder les données offline
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK PRINCIPAL: useLocalData
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook pour charger des données avec stratégie local-first
 * 
 * @param {string} key - Clé de cache unique
 * @param {string} endpoint - Endpoint API (ex: '/api/products')
 * @param {object} options - Options de configuration
 * @returns {object} { data, loading, error, refresh, isStale }
 */
export function useLocalData(key, endpoint, options = {}) {
  const {
    ttl = CACHE_TTL[key] || CACHE_TTL.default,
    initialData = null,
    transform = (data) => data,
    enabled = true,
    refetchOnMount = true,
    refetchOnFocus = false,
    dedupe = true,
  } = options;
  
  // États
  const [data, setData] = useState(() => getCache(key) || initialData);
  const [loading, setLoading] = useState(!getCache(key));
  const [error, setError] = useState(null);
  const [isStale, setIsStale] = useState(!isCacheValid(key, ttl));
  
  // Refs pour éviter les re-renders
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);
  
  // Fonction de fetch
  const fetchData = useCallback(async (force = false) => {
    if (!enabled) return;
    
    // Si déjà en cours de fetch et dedupe activé, attendre le résultat
    if (dedupe && pendingRequests.has(key)) {
      try {
        const result = await pendingRequests.get(key);
        if (mountedRef.current) {
          setData(result);
          setLoading(false);
        }
        return result;
      } catch (e) {
        // La requête précédente a échoué, on continue
      }
    }
    
    // Vérifier le cache si pas forcé
    if (!force && isCacheValid(key, ttl)) {
      const cached = getCache(key);
      if (cached) {
        setData(cached);
        setLoading(false);
        setIsStale(false);
        return cached;
      }
    }
    
    // Marquer comme en cours
    fetchingRef.current = true;
    
    // Créer la promesse de fetch
    const fetchPromise = (async () => {
      try {
        const response = await axios.get(`${API_URL}${endpoint}`, {
          timeout: 10000,
        });
        
        let result = response.data;
        
        // Si la réponse contient { success, data }, extraire data
        if (result && typeof result === 'object' && 'data' in result) {
          result = result.data;
        }
        
        // Appliquer la transformation
        result = transform(result);
        
        // Sauvegarder dans le cache
        setCache(key, result);
        
        if (mountedRef.current) {
          setData(result);
          setError(null);
          setIsStale(false);
        }
        
        return result;
      } catch (err) {
        console.warn(`[useLocalData] Erreur ${key}:`, err.message);
        
        if (mountedRef.current) {
          setError(err);
          // Garder les données en cache même en cas d'erreur
          const cached = getCache(key);
          if (cached) {
            setData(cached);
            setIsStale(true);
          }
        }
        
        throw err;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
        fetchingRef.current = false;
        pendingRequests.delete(key);
      }
    })();
    
    // Stocker la promesse pour le dedupe
    if (dedupe) {
      pendingRequests.set(key, fetchPromise);
    }
    
    return fetchPromise;
  }, [key, endpoint, ttl, enabled, transform, dedupe]);
  
  // Fonction de refresh (force le fetch)
  const refresh = useCallback(() => {
    return fetchData(true);
  }, [fetchData]);
  
  // Effet initial
  useEffect(() => {
    mountedRef.current = true;
    
    if (refetchOnMount && enabled) {
      // Si on a des données en cache, ne pas afficher loading
      const cached = getCache(key);
      if (cached) {
        setData(cached);
        setLoading(false);
        // Fetch en arrière-plan
        fetchData(false).catch(() => {});
      } else {
        fetchData(false).catch(() => {});
      }
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [key, enabled]);
  
  // Refetch on focus
  useEffect(() => {
    if (!refetchOnFocus) return;
    
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchData(false).catch(() => {});
      }
    };
    
    document.addEventListener('visibilitychange', handleFocus);
    return () => document.removeEventListener('visibilitychange', handleFocus);
  }, [refetchOnFocus, fetchData]);
  
  return {
    data,
    loading,
    error,
    refresh,
    isStale,
    // Helpers
    isEmpty: !data || (Array.isArray(data) && data.length === 0),
    hasData: !!data && (!Array.isArray(data) || data.length > 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS SPÉCIALISÉS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook pour les produits (local-first)
 */
export function useLocalProducts(options = {}) {
  return useLocalData('products', '/api/products', {
    ttl: CACHE_TTL.products,
    initialData: [],
    ...options,
  });
}

/**
 * Hook pour les ventes du jour (local-first)
 */
export function useLocalTodaySales(options = {}) {
  const today = new Date().toISOString().split('T')[0];
  return useLocalData(`sales_${today}`, `/api/sales?from=${today}&to=${today}`, {
    ttl: CACHE_TTL.sales,
    initialData: [],
    ...options,
  });
}

/**
 * Hook pour les dettes (local-first)
 */
export function useLocalDebts(options = {}) {
  return useLocalData('debts', '/api/debts', {
    ttl: CACHE_TTL.debts,
    initialData: [],
    ...options,
  });
}

/**
 * Hook pour les analytics du jour (local-first)
 */
export function useLocalAnalytics(options = {}) {
  return useLocalData('analytics_today', '/api/analytics/today', {
    ttl: CACHE_TTL.analytics,
    initialData: {
      todaySalesFC: 0,
      todaySalesUSD: 0,
      todayInvoices: 0,
      todayCollected: 0,
      openDebts: 0,
      openDebtsCount: 0,
      lowStock: [],
    },
    ...options,
  });
}

/**
 * Hook pour le taux de change (local-first)
 */
export function useLocalRate(options = {}) {
  return useLocalData('current_rate', '/api/rates/current', {
    ttl: CACHE_TTL.rates,
    initialData: { rate: 2800 },
    transform: (data) => data?.rate || data,
    ...options,
  });
}

/**
 * Hook pour les utilisateurs (local-first)
 */
export function useLocalUsers(options = {}) {
  return useLocalData('users', '/api/users', {
    ttl: CACHE_TTL.users,
    initialData: [],
    ...options,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK: useMutation (pour les actions qui modifient les données)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook pour les mutations avec invalidation de cache automatique
 */
export function useMutation(mutationFn, options = {}) {
  const {
    onSuccess,
    onError,
    invalidateKeys = [],
  } = options;
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const mutate = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await mutationFn(...args);
      
      // Invalider les caches concernés
      for (const key of invalidateKeys) {
        invalidateCache(key);
      }
      
      if (onSuccess) {
        onSuccess(result);
      }
      
      return result;
    } catch (err) {
      setError(err);
      if (onError) {
        onError(err);
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, [mutationFn, invalidateKeys, onSuccess, onError]);
  
  return {
    mutate,
    loading,
    error,
    reset: () => setError(null),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK: useOptimisticUpdate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook pour les mises à jour optimistes (UI instantanée)
 */
export function useOptimisticUpdate(key) {
  const update = useCallback((updater) => {
    const current = getCache(key);
    if (!current) return;
    
    const updated = typeof updater === 'function' ? updater(current) : updater;
    setCache(key, updated);
    
    // Déclencher un re-render des composants qui utilisent ce cache
    window.dispatchEvent(new CustomEvent('cache-update', { detail: { key, data: updated } }));
  }, [key]);
  
  return update;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRELOAD: Précharger les données critiques
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Précharger les données critiques au démarrage
 */
export async function preloadCriticalData() {
  console.log('⚡ [Preload] Préchargement des données critiques...');
  
  const promises = [
    axios.get(`${API_URL}/api/products`).then(r => {
      setCache('products', r.data);
      console.log('✅ [Preload] Produits chargés');
    }).catch(() => {}),
    
    axios.get(`${API_URL}/api/rates/current`).then(r => {
      setCache('current_rate', r.data);
      console.log('✅ [Preload] Taux chargé');
    }).catch(() => {}),
    
    axios.get(`${API_URL}/api/analytics/today`).then(r => {
      setCache('analytics_today', r.data);
      console.log('✅ [Preload] Analytics chargés');
    }).catch(() => {}),
  ];
  
  await Promise.allSettled(promises);
  console.log('⚡ [Preload] Terminé');
}

export default useLocalData;

