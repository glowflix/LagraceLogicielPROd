/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SÉLECTEURS ATOMIQUES ZUSTAND - Éviter les re-renders inutiles
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Principe:
 * - Au lieu de `useStore()` qui cause un re-render à chaque changement d'état
 * - Utiliser des sélecteurs atomiques qui ne déclenchent un re-render que si
 *   la valeur sélectionnée change réellement
 * 
 * Usage:
 * // ❌ Mauvais - re-render à chaque changement du store
 * const { products, currentRate } = useStore();
 * 
 * // ✅ Bon - re-render seulement si products OU currentRate change
 * const products = useProducts();
 * const currentRate = useCurrentRate();
 */

import { useStore } from './useStore';
import { shallow } from 'zustand/shallow';
import { useMemo, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// SÉLECTEURS ATOMIQUES DE BASE
// ═══════════════════════════════════════════════════════════════════════════

// État d'authentification
export const useIsAuthenticated = () => useStore((state) => state.isAuthenticated);
export const useIsLicensed = () => useStore((state) => state.isLicensed);
export const useUser = () => useStore((state) => state.user);
export const useToken = () => useStore((state) => state.token);
export const useIsLoading = () => useStore((state) => state.isLoading);

// État de connexion
export const useIsOnline = () => useStore((state) => state.isOnline);
export const useSocketConnected = () => useStore((state) => state.socketConnected);
export const useLastSync = () => useStore((state) => state.lastSync);

// Données principales
export const useProducts = () => useStore((state) => state.products);
export const useSales = () => useStore((state) => state.sales);
export const useDebts = () => useStore((state) => state.debts);
export const useStock = () => useStore((state) => state.stock);
export const useCurrentRate = () => useStore((state) => state.currentRate);

// Panier
export const useCart = () => useStore((state) => state.cart);
export const useSaleCurrency = () => useStore((state) => state.saleCurrency);

// Socket
export const useSocket = () => useStore((state) => state.socket);

// ═══════════════════════════════════════════════════════════════════════════
// SÉLECTEURS COMPOSÉS (avec shallow comparison)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sélecteur pour l'état d'authentification complet
 */
export const useAuthState = () => useStore(
  (state) => ({
    isAuthenticated: state.isAuthenticated,
    isLicensed: state.isLicensed,
    user: state.user,
    isLoading: state.isLoading,
  }),
  shallow
);

/**
 * Sélecteur pour l'état de connexion
 */
export const useConnectionState = () => useStore(
  (state) => ({
    isOnline: state.isOnline,
    socketConnected: state.socketConnected,
    lastSync: state.lastSync,
  }),
  shallow
);

/**
 * Sélecteur pour le panier avec calculs
 */
export const useCartWithTotals = () => {
  const cart = useCart();
  const currentRate = useCurrentRate();
  
  return useMemo(() => {
    const totalFC = cart.reduce((sum, item) => sum + (item.subtotal_fc || 0), 0);
    const totalUSD = cart.reduce((sum, item) => sum + (item.subtotal_usd || 0), 0);
    const itemCount = cart.reduce((sum, item) => sum + (item.qty || 0), 0);
    
    return {
      cart,
      totalFC,
      totalUSD,
      itemCount,
      isEmpty: cart.length === 0,
      currentRate,
    };
  }, [cart, currentRate]);
};

// ═══════════════════════════════════════════════════════════════════════════
// SÉLECTEURS FILTRÉS (avec memoization)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Produits filtrés par recherche
 */
export const useFilteredProducts = (searchQuery) => {
  const products = useProducts();
  
  return useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) {
      return products;
    }
    
    const query = searchQuery.toLowerCase().trim();
    
    return products.filter((product) => {
      const code = (product.code || '').toLowerCase();
      const name = (product.name || product.label || '').toLowerCase();
      const brand = (product.brand || product.mark || '').toLowerCase();
      
      return (
        code.includes(query) ||
        name.includes(query) ||
        brand.includes(query)
      );
    });
  }, [products, searchQuery]);
};

/**
 * Produit par ID
 */
export const useProductById = (productId) => {
  const products = useProducts();
  
  return useMemo(() => {
    return products.find((p) => p.id === productId) || null;
  }, [products, productId]);
};

/**
 * Produit par code
 */
export const useProductByCode = (productCode) => {
  const products = useProducts();
  
  return useMemo(() => {
    return products.find((p) => p.code === productCode) || null;
  }, [products, productCode]);
};

/**
 * Ventes filtrées par date
 */
export const useFilteredSales = (filters = {}) => {
  const sales = useSales();
  
  return useMemo(() => {
    let filtered = [...sales];
    
    if (filters.from) {
      const fromDate = new Date(filters.from);
      filtered = filtered.filter((s) => new Date(s.created_at) >= fromDate);
    }
    
    if (filters.to) {
      const toDate = new Date(filters.to);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter((s) => new Date(s.created_at) <= toDate);
    }
    
    if (filters.status) {
      filtered = filtered.filter((s) => s.status === filters.status);
    }
    
    return filtered;
  }, [sales, filters.from, filters.to, filters.status]);
};

/**
 * Dettes filtrées par statut
 */
export const useFilteredDebts = (status = 'all') => {
  const debts = useDebts();
  
  return useMemo(() => {
    if (status === 'all') {
      return debts;
    }
    return debts.filter((d) => d.status === status);
  }, [debts, status]);
};

// ═══════════════════════════════════════════════════════════════════════════
// SÉLECTEURS D'ACTIONS (ne causent pas de re-render)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Actions d'authentification
 */
export const useAuthActions = () => useStore(
  (state) => ({
    login: state.login,
    logout: state.logout,
    checkLicense: state.checkLicense,
    activateLicense: state.activateLicense,
  }),
  shallow
);

/**
 * Actions du panier
 */
export const useCartActions = () => useStore(
  (state) => ({
    addToCart: state.addToCart,
    removeFromCart: state.removeFromCart,
    updateCartItem: state.updateCartItem,
    clearCart: state.clearCart,
  }),
  shallow
);

/**
 * Actions de données
 */
export const useDataActions = () => useStore(
  (state) => ({
    loadProducts: state.loadProducts,
    loadCurrentRate: state.loadCurrentRate,
    loadSales: state.loadSales,
    createSale: state.createSale,
    updateCurrentRate: state.updateCurrentRate,
  }),
  shallow
);

/**
 * Actions de connexion
 */
export const useConnectionActions = () => useStore(
  (state) => ({
    initSocket: state.initSocket,
    checkConnection: state.checkConnection,
    updateOnlineStatus: state.updateOnlineStatus,
  }),
  shallow
);

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook pour obtenir un produit avec son stock
 */
export const useProductWithStock = (productId) => {
  const product = useProductById(productId);
  const stock = useStock();
  
  return useMemo(() => {
    if (!product) return null;
    
    const productStock = stock.find((s) => s.product_id === productId);
    
    return {
      ...product,
      stockQuantity: productStock?.quantity || 0,
      stockValue: productStock?.value || 0,
    };
  }, [product, stock, productId]);
};

/**
 * Hook pour les statistiques rapides
 */
export const useQuickStats = () => {
  const products = useProducts();
  const sales = useSales();
  const debts = useDebts();
  
  return useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todaySales = sales.filter((s) => 
      s.created_at && s.created_at.startsWith(today)
    );
    
    const totalSalesFC = todaySales.reduce((sum, s) => sum + (s.total_cdf || 0), 0);
    const totalSalesUSD = todaySales.reduce((sum, s) => sum + (s.total_usd || 0), 0);
    const openDebts = debts.filter((d) => d.status === 'open').length;
    const totalDebtsUSD = debts
      .filter((d) => d.status === 'open')
      .reduce((sum, d) => sum + (d.remaining_usd || 0), 0);
    
    return {
      totalProducts: products.length,
      todaySalesCount: todaySales.length,
      todaySalesFC: totalSalesFC,
      todaySalesUSD: totalSalesUSD,
      openDebtsCount: openDebts,
      totalDebtsUSD,
    };
  }, [products, sales, debts]);
};

/**
 * Hook pour vérifier les permissions utilisateur
 */
export const useUserPermissions = () => {
  const user = useUser();
  
  return useMemo(() => {
    if (!user) {
      return {
        isAdmin: false,
        isVendeur: false,
        canManageProducts: false,
        canManageUsers: false,
        canViewAnalytics: false,
        canManageDebts: false,
      };
    }
    
    const isAdmin = user.is_admin === 1 || user.is_admin === true;
    const isVendeur = user.is_vendeur === 1 || user.is_vendeur === true;
    
    return {
      isAdmin,
      isVendeur,
      canManageProducts: isAdmin,
      canManageUsers: isAdmin,
      canViewAnalytics: isAdmin,
      canManageDebts: isAdmin || isVendeur,
    };
  }, [user]);
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT LEGACY (compatibilité avec le code existant)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pour migrer progressivement sans casser le code existant
 * Usage: const state = useLegacyStore(['products', 'currentRate']);
 */
export const useLegacyStore = (keys = []) => {
  return useStore((state) => {
    const selected = {};
    for (const key of keys) {
      selected[key] = state[key];
    }
    return selected;
  }, shallow);
};

export default {
  // Atomiques
  useIsAuthenticated,
  useIsLicensed,
  useUser,
  useToken,
  useIsLoading,
  useIsOnline,
  useSocketConnected,
  useProducts,
  useSales,
  useDebts,
  useStock,
  useCurrentRate,
  useCart,
  
  // Composés
  useAuthState,
  useConnectionState,
  useCartWithTotals,
  
  // Filtrés
  useFilteredProducts,
  useProductById,
  useProductByCode,
  useFilteredSales,
  useFilteredDebts,
  
  // Actions
  useAuthActions,
  useCartActions,
  useDataActions,
  useConnectionActions,
  
  // Utilitaires
  useProductWithStock,
  useQuickStats,
  useUserPermissions,
  useLegacyStore,
};

