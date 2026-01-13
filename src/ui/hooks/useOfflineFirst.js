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
  
  // ✅ PRO ULTRA-RAPIDE: Fetch en background, jamais de blocage
  const fetchData = useCallback(async (force = false) => {
    if (!enabled) return;
    
    // Éviter les fetches simultanés
    if (fetchingRef.current) return;
    
    // ✅ RÈGLE PRO: Si on a un cache valide et pas forcé, retourner immédiatement
    if (!force && isCacheValid(key, ttl)) {
      const cached = getCache(key);
      if (cached) {
        setData(cached);
        setLoading(false);
        setIsStale(false);
        return cached;
      }
    }
    
    fetchingRef.current = true;
    
    // ✅ PRO: Afficher loading SEULEMENT si on n'a AUCUNE donnée (première fois)
    const cachedData = getCache(key);
    const hasCache = cachedData && (!Array.isArray(cachedData) || cachedData.length > 0);
    
    if (!hasCache && !data) {
      setLoading(true);
    }
    // Si on a un cache, l'afficher immédiatement
    if (hasCache && !data) {
      setData(cachedData);
    }
    
    setError(null);
    
    // ✅ PRO: Timeout court de 3s max - pas de blocage
    const timeoutId = setTimeout(() => {
      if (mountedRef.current && fetchingRef.current) {
        setLoading(false);
        fetchingRef.current = false;
      }
    }, 3000);
    
    try {
      let result;
      
      if (electronAPI && typeof fetchFn === 'function') {
        result = await fetchFn(electronAPI);
      } else if (typeof fetchFn === 'function') {
        result = await fetchFn();
      } else {
        throw new Error('fetchFn doit être une fonction');
      }
      
      result = transform(result);
      
      // ✅ PRO: Toujours mettre en cache le résultat (même vide = pas de données)
      // Sauf si on avait des données avant et le résultat est vide (erreur probable)
      const isEmptyResult = Array.isArray(result) && result.length === 0;
      const hadData = hasCache;
      
      if (!isEmptyResult || !hadData) {
        setCache(key, result);
      }
      
      if (mountedRef.current) {
        // ✅ PRO: Ne pas écraser les données existantes avec un tableau vide
        if (!isEmptyResult || !hadData) {
          setData(result);
        }
        setError(null);
        setIsStale(false);
      }
      
      return result;
    } catch (err) {
      // ✅ PRO: Silencieux - garder le cache, pas d'erreur bloquante
      if (mountedRef.current && hasCache) {
        setIsStale(true);
      }
    } finally {
      clearTimeout(timeoutId);
      if (mountedRef.current) {
        setLoading(false);
      }
      fetchingRef.current = false;
    }
  }, [key, ttl, enabled, transform, electronAPI, fetchFn, data]);
  
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
 * ✅ PRO ULTRA-RAPIDE: Affiche cache immédiatement, refresh en background
 * 
 * Principe:
 * 1. Afficher les données en cache IMMÉDIATEMENT (pas de spinner)
 * 2. Fetch API avec timeout COURT (2s) en background
 * 3. PAS de retry - un seul appel
 * 4. Si échec, garder le cache
 */
export function useOfflineSales(filters = {}, options = {}) {
  const filtersKey = JSON.stringify(filters);
  const cacheKey = `sales_${filtersKey}`;
  
  return useOfflineFirst(cacheKey, async (electronAPI) => {
    // PRIORITÉ 1: Charger depuis SQL local via Electron API (ultra-rapide)
    if (electronAPI?.db?.query) {
      try {
        let query = `SELECT s.* FROM sales s`;
        const params = [];
        
        if (filters.hideDeleted === true) {
          query += ` LEFT JOIN deleted_sales ds ON s.invoice_number = ds.invoice_number`;
        }
        
        query += ` WHERE 1=1`;
        
        if (filters.hideDeleted === true) {
          query += ` AND ds.id IS NULL`;
        }
        
        if (filters.from) {
          query += ' AND s.sold_at >= ?';
          params.push(filters.from);
        }
        if (filters.to) {
          query += ' AND s.sold_at <= ?';
          params.push(filters.to);
        }
        if (filters.status) {
          query += ' AND s.status = ?';
          params.push(filters.status);
        }
        if (filters.exclude_status) {
          query += ' AND s.status != ?';
          params.push(filters.exclude_status);
        }
        
        query += ' ORDER BY s.sold_at DESC LIMIT 1000';
        
        const sales = await electronAPI.db.query(query, params);
        if (sales && sales.length > 0) {
          return sales;
        }
      } catch (e) {
        console.warn('[useOfflineSales] SQL local error:', e.message);
      }
    }
    
    // PRIORITÉ 2: API HTTP locale - TIMEOUT COURT, PAS DE RETRY
    const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');
    
    try {
      const urlParams = new URLSearchParams();
      if (filters.from) urlParams.append('from', filters.from);
      if (filters.to) urlParams.append('to', filters.to);
      if (filters.status) urlParams.append('status', filters.status);
      if (filters.exclude_status) urlParams.append('exclude_status', filters.exclude_status);
      
      // ✅ TIMEOUT COURT: 2 secondes max - pas d'attente
      const response = await fetch(`${API_URL}/api/sales?${urlParams}`, {
        signal: AbortSignal.timeout(2000),
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      // Silencieux - on garde le cache
    }
    
    // Retourner tableau vide si pas de cache
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

/**
 * ✅ Invalider TOUS les caches de ventes (pour forcer rechargement dans SalesHistory)
 * Utile après création d'une vente pour que la nouvelle vente apparaisse immédiatement
 */
export function invalidateAllSalesCache() {
  // Invalider tous les caches commençant par "sales_"
  const keysToDelete = [];
  
  // Vérifier tous les éléments du cache mémoire
  for (const key of memoryCache.keys()) {
    if (key.startsWith('sales_')) {
      keysToDelete.push(key);
    }
  }
  
  // Vérifier localStorage aussi
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (storageKey && storageKey.startsWith('offline_cache_sales_')) {
      const cacheKey = storageKey.replace('offline_cache_', '');
      keysToDelete.push(cacheKey);
    }
  }
  
  // Supprimer tous les caches de ventes trouvés
  keysToDelete.forEach(key => {
    memoryCache.delete(key);
    cacheTimestamps.delete(key);
    try {
      localStorage.removeItem(`offline_cache_${key}`);
    } catch (e) {}
  });
  
  console.log(`✅ [useOfflineFirst] ${keysToDelete.length} cache(s) de ventes invalidé(s)`);
}

export default useOfflineFirst;

