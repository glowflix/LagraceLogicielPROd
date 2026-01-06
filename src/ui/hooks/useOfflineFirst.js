/**
 * ═══════════════════════════════════════════════════════════════════════════
 * USE OFFLINE FIRST - Hook ultra-rapide pour données locales uniquement
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Principe: 100% LOCAL, jamais d'attente réseau
 * - Charge immédiatement depuis IndexedDB/localStorage
 * - Synchronisation en arrière-plan uniquement
 * - UI toujours fluide, même sans internet
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import useElectronAPI from './useElectronAPI';

// Cache mémoire ultra-rapide
const memoryCache = new Map();
const cacheTimestamps = new Map();

// Durée de validité du cache (en ms)
const CACHE_TTL = {
  products: 300000,      // 5 minutes
  sales: 180000,        // 3 minutes
  debts: 180000,        // 3 minutes
  analytics: 300000,    // 5 minutes
  users: 600000,        // 10 minutes
  rates: 600000,        // 10 minutes
  default: 180000,      // 3 minutes
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
  
  // Sauvegarder dans localStorage pour persistence
  try {
    const storageKey = `offline_cache_${key}`;
    localStorage.setItem(storageKey, JSON.stringify({
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
    const storageKey = `offline_cache_${key}`;
    const stored = localStorage.getItem(storageKey);
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
 * Hook principal useOfflineFirst
 * 
 * @param {string} key - Clé de cache unique
 * @param {Function} fetchFn - Fonction pour charger depuis Electron/API locale
 * @param {object} options - Options de configuration
 * @returns {object} { data, loading, error, refresh, isStale }
 */
export function useOfflineFirst(key, fetchFn, options = {}) {
  const {
    ttl = CACHE_TTL[key] || CACHE_TTL.default,
    initialData = null,
    transform = (data) => data,
    enabled = true,
    refetchOnMount = false, // Par défaut, ne pas refetch si cache valide
  } = options;
  
  const electronAPI = useElectronAPI();
  
  // États
  const [data, setData] = useState(() => getCache(key) || initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isStale, setIsStale] = useState(!isCacheValid(key, ttl));
  
  // Refs pour éviter les re-renders
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);
  
  // Fonction de fetch depuis Electron/API locale
  const fetchData = useCallback(async (force = false) => {
    if (!enabled) return;
    
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
    setLoading(true);
    setError(null);
    
    try {
      // Charger depuis Electron/API locale (toujours disponible)
      let result;
      
      if (electronAPI && typeof fetchFn === 'function') {
        // Utiliser Electron API si disponible
        result = await fetchFn(electronAPI);
      } else if (typeof fetchFn === 'function') {
        // Fallback: fonction directe
        result = await fetchFn();
      } else {
        throw new Error('fetchFn doit être une fonction');
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
      console.warn(`[useOfflineFirst] Erreur ${key}:`, err.message);
      
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
    }
  }, [key, ttl, enabled, transform, electronAPI, fetchFn]);
  
  // Fonction de refresh (force le fetch)
  const refresh = useCallback(() => {
    return fetchData(true);
  }, [fetchData]);
  
  // Effet initial
  useEffect(() => {
    mountedRef.current = true;
    
    // Toujours charger depuis le cache d'abord (instantané)
    const cached = getCache(key);
    if (cached) {
      setData(cached);
      setLoading(false);
      setIsStale(!isCacheValid(key, ttl));
      
      // Si cache valide et refetchOnMount désactivé, ne pas refetch
      if (!refetchOnMount && isCacheValid(key, ttl)) {
        return;
      }
    }
    
    // Fetch en arrière-plan si nécessaire
    if (refetchOnMount || !cached) {
      fetchData(false).catch(() => {});
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [key, enabled, refetchOnMount, ttl, fetchData]);
  
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

/**
 * Hook spécialisé pour les produits (offline-first)
 * Utilise SQL local en priorité, jamais d'attente réseau
 */
export function useOfflineProducts(options = {}) {
  return useOfflineFirst('products', async (electronAPI) => {
    // PRIORITÉ 1: Charger depuis SQL local via Electron API (ultra-rapide)
    if (electronAPI?.db?.query) {
      try {
        const products = await electronAPI.db.query('SELECT * FROM products ORDER BY name');
        if (products && products.length > 0) {
          return products;
        }
      } catch (e) {
        console.warn('[useOfflineProducts] Erreur SQL local:', e);
      }
    }
    
    // PRIORITÉ 2: API HTTP locale (toujours disponible même offline)
    const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');
    try {
      const response = await fetch(`${API_URL}/api/products`, {
        signal: AbortSignal.timeout(2000), // Timeout court
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.warn('[useOfflineProducts] Erreur API locale:', e);
    }
    
    // Fallback: retourner tableau vide plutôt que d'attendre
    return [];
  }, {
    ttl: CACHE_TTL.products,
    initialData: [],
    ...options,
  });
}

/**
 * Hook spécialisé pour les ventes (offline-first)
 * Utilise SQL local en priorité, jamais d'attente réseau
 */
export function useOfflineSales(filters = {}, options = {}) {
  const filtersKey = JSON.stringify(filters);
  const cacheKey = `sales_${filtersKey}`;
  
  return useOfflineFirst(cacheKey, async (electronAPI) => {
    // PRIORITÉ 1: Charger depuis SQL local via Electron API (ultra-rapide)
    if (electronAPI?.db?.query) {
      try {
        let query = 'SELECT * FROM sales WHERE 1=1';
        const params = [];
        
        if (filters.from) {
          query += ' AND sold_at >= ?';
          params.push(filters.from);
        }
        if (filters.to) {
          query += ' AND sold_at <= ?';
          params.push(filters.to);
        }
        if (filters.status) {
          query += ' AND status = ?';
          params.push(filters.status);
        }
        if (filters.exclude_status) {
          query += ' AND status != ?';
          params.push(filters.exclude_status);
        }
        
        query += ' ORDER BY sold_at DESC LIMIT 1000';
        
        const sales = await electronAPI.db.query(query, params);
        if (sales && sales.length > 0) {
          return sales;
        }
      } catch (e) {
        console.warn('[useOfflineSales] Erreur SQL local:', e);
      }
    }
    
    // PRIORITÉ 2: API HTTP locale (toujours disponible même offline)
    const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');
    try {
      const params = new URLSearchParams();
      if (filters.from) params.append('from', filters.from);
      if (filters.to) params.append('to', filters.to);
      if (filters.status) params.append('status', filters.status);
      if (filters.exclude_status) params.append('exclude_status', filters.exclude_status);
      
      const response = await fetch(`${API_URL}/api/sales?${params}`, {
        signal: AbortSignal.timeout(2000), // Timeout court
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.warn('[useOfflineSales] Erreur API locale:', e);
    }
    
    // Fallback: retourner tableau vide plutôt que d'attendre
    return [];
  }, {
    ttl: CACHE_TTL.sales,
    initialData: [],
    ...options,
  });
}

/**
 * Hook spécialisé pour les dettes (offline-first)
 * Utilise SQL local en priorité, jamais d'attente réseau
 */
export function useOfflineDebts(options = {}) {
  return useOfflineFirst('debts', async (electronAPI) => {
    // PRIORITÉ 1: Charger depuis SQL local via Electron API (ultra-rapide)
    if (electronAPI?.db?.query) {
      try {
        const debts = await electronAPI.db.query('SELECT * FROM debts ORDER BY created_at DESC');
        if (debts && debts.length > 0) {
          return debts;
        }
      } catch (e) {
        console.warn('[useOfflineDebts] Erreur SQL local:', e);
      }
    }
    
    // PRIORITÉ 2: API HTTP locale (toujours disponible même offline)
    const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');
    try {
      const response = await fetch(`${API_URL}/api/debts`, {
        signal: AbortSignal.timeout(2000), // Timeout court
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.warn('[useOfflineDebts] Erreur API locale:', e);
    }
    
    // Fallback: retourner tableau vide plutôt que d'attendre
    return [];
  }, {
    ttl: CACHE_TTL.debts,
    initialData: [],
    ...options,
  });
}

/**
 * Invalider le cache
 */
export function invalidateOfflineCache(key) {
  if (key) {
    memoryCache.delete(key);
    cacheTimestamps.delete(key);
    try {
      localStorage.removeItem(`offline_cache_${key}`);
    } catch (e) {}
  } else {
    // Invalider tout le cache
    memoryCache.clear();
    cacheTimestamps.clear();
    // Ne pas vider localStorage pour garder les données offline
  }
}

export default useOfflineFirst;

