import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

export const useStore = create(
  persist(
    (set, get) => ({
      // État de chargement initial
      isLoading: true,

      // État de licence
      isLicensed: false,
      licenseKey: null,

      // État d'authentification
      isAuthenticated: false,
      user: null,
      token: null,

      // État de connexion
      isOnline: navigator.onLine,
      lastSync: null,

      // Socket
      socket: null,
      socketConnected: false,

      // Données
      products: [],
      sales: [],
      debts: [],
      stock: [],
      currentRate: 2800,

      // Panier de vente
      cart: [],
      saleCurrency: 'FC', // FC ou USD

      // Actions Licence
      checkLicense: async () => {
        try {
          set({ isLoading: true });
          // Simuler un petit délai pour le splash screen
          await new Promise((resolve) => setTimeout(resolve, 500));
          
          const stored = localStorage.getItem('glowflix-license');
          if (stored) {
            const license = JSON.parse(stored);
            if (license.key === '0987654321' && license.isLicensed) {
              set({ isLicensed: true, licenseKey: license.key, isLoading: false });
              return true;
            }
          }
          set({ isLicensed: false, isLoading: false });
          return false;
        } catch (error) {
          console.error('Erreur vérification licence:', error);
          set({ isLicensed: false, isLoading: false });
          return false;
        }
      },

      activateLicense: (key) => {
        if (key === '0987654321') {
          const license = {
            key,
            isLicensed: true,
            activatedAt: new Date().toISOString(),
          };
          localStorage.setItem('glowflix-license', JSON.stringify(license));
          set({ isLicensed: true, licenseKey: key });
          return true;
        }
        return false;
      },

      // Actions Authentification
      login: async (username, password) => {
        try {
          const response = await axios.post(`${API_URL}/api/auth/login`, {
            username,
            password,
          });

          if (response.data.success) {
            const { user, token } = response.data;
            set({
              isAuthenticated: true,
              user,
              token,
            });
            // Initialiser le socket après connexion
            get().initSocket();
            return { success: true };
          }
          return { success: false, error: 'Identifiants invalides' };
        } catch (error) {
          // Mode offline: accepter n'importe quel login si pas de serveur
          if (!navigator.onLine || error.code === 'ERR_NETWORK') {
            set({
              isAuthenticated: true,
              user: { username, is_admin: true },
              token: 'offline-token',
            });
            get().initSocket();
            return { success: true, offline: true };
          }
          return {
            success: false,
            error: error.response?.data?.error || 'Erreur de connexion',
          };
        }
      },

      logout: () => {
        if (get().socket) {
          get().socket.disconnect();
        }
        set({
          isAuthenticated: false,
          user: null,
          token: null,
          socket: null,
          socketConnected: false,
          cart: [],
        });
      },

      // Actions Socket
      initSocket: () => {
        if (get().socket) {
          get().socket.disconnect();
        }

        const socket = io(API_URL, {
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
        });

        socket.on('connect', () => {
          console.log('Socket connecté');
          set({ socketConnected: true });
        });

        socket.on('disconnect', () => {
          console.log('Socket déconnecté');
          set({ socketConnected: false });
        });

        socket.on('sale:created', (sale) => {
          set((state) => ({
            sales: [sale, ...state.sales],
          }));
        });

        socket.on('stock:updated', (stock) => {
          set((state) => ({
            stock: state.stock.map((s) =>
              s.id === stock.id ? stock : s
            ),
          }));
        });

        socket.on('product:updated', (product) => {
          set((state) => ({
            products: state.products.map((p) =>
              p.id === product.id ? product : p
            ),
          }));
        });

        set({ socket });
      },

      // Actions Panier
      addToCart: (product, unit, qty, customPriceFC = null, customPriceUSD = null) => {
        const cart = get().cart;
        const priceFC = customPriceFC !== null ? customPriceFC : unit.sale_price_fc;
        const priceUSD = customPriceUSD !== null ? customPriceUSD : unit.sale_price_usd;
        
        const existing = cart.find(
          (item) =>
            item.product_id === product.id &&
            item.unit_level === unit.unit_level &&
            item.unit_mark === unit.unit_mark &&
            Math.abs(item.unit_price_fc - priceFC) < 0.01 // Même prix = même item
        );

        if (existing) {
          existing.qty += qty;
          existing.subtotal_fc = existing.unit_price_fc * existing.qty;
          existing.subtotal_usd = existing.unit_price_usd * existing.qty;
          set({ cart: [...cart] });
        } else {
          set({
            cart: [
              ...cart,
              {
                product_id: product.id,
                product_code: product.code,
                product_name: product.name,
                unit_level: unit.unit_level,
                unit_mark: unit.unit_mark || '',
                qty,
                qty_label: qty.toString(),
                unit_price_fc: priceFC,
                unit_price_usd: priceUSD,
                subtotal_fc: priceFC * qty,
                subtotal_usd: priceUSD * qty,
                qty_step: unit.qty_step || 1,
              },
            ],
          });
        }
      },

      removeFromCart: (index) => {
        const cart = get().cart;
        cart.splice(index, 1);
        set({ cart: [...cart] });
      },

      updateCartItem: (index, updates) => {
        const cart = get().cart;
        cart[index] = { ...cart[index], ...updates };
        if (updates.qty !== undefined) {
          cart[index].subtotal_fc =
            cart[index].unit_price_fc * cart[index].qty;
          cart[index].subtotal_usd =
            cart[index].unit_price_usd * cart[index].qty;
        }
        set({ cart: [...cart] });
      },

      clearCart: () => {
        set({ cart: [] });
      },

      // Actions Données
      loadProducts: async () => {
        try {
          const response = await axios.get(`${API_URL}/api/products`);
          set({ products: response.data });
        } catch (error) {
          console.error('Erreur chargement produits:', error);
          // Mode offline: utiliser cache local
        }
      },

      loadCurrentRate: async () => {
        try {
          const response = await axios.get(`${API_URL}/api/rates/current`);
          if (response.data.success) {
            set({ currentRate: response.data.rate });
            return response.data.rate;
          }
        } catch (error) {
          console.error('Erreur chargement taux:', error);
          // Mode offline: garder le taux par défaut ou celui en cache
        }
        return get().currentRate;
      },

      updateCurrentRate: (rate) => {
        set({ currentRate: rate });
      },

      loadSales: async (filters = {}) => {
        try {
          // Construire les paramètres de requête manuellement pour gérer correctement les dates
          const params = new URLSearchParams();
          if (filters.from) params.append('from', filters.from);
          if (filters.to) params.append('to', filters.to);
          if (filters.status) params.append('status', filters.status);
          
          const queryString = params.toString();
          const url = queryString 
            ? `${API_URL}/api/sales?${queryString}`
            : `${API_URL}/api/sales`;
          
          const response = await axios.get(url);
          set({ sales: response.data || [] });
        } catch (error) {
          console.error('Erreur chargement ventes:', error);
          set({ sales: [] }); // En cas d'erreur, vider la liste
        }
      },

      createSale: async (saleData) => {
        try {
          const response = await axios.post(`${API_URL}/api/sales`, saleData);
          if (response.data.success) {
            get().clearCart();
            // Émettre via socket si connecté
            if (get().socketConnected) {
              get().socket.emit('sale:created', response.data.sale);
            }
            return { success: true, sale: response.data.sale };
          }
          return { success: false, error: 'Erreur création vente' };
        } catch (error) {
          // Mode offline: stocker localement
          if (!navigator.onLine || error.code === 'ERR_NETWORK') {
            const offlineSales = JSON.parse(
              localStorage.getItem('glowflix-offline-sales') || '[]'
            );
            const sale = {
              ...saleData,
              id: Date.now(),
              invoice_number: `OFF-${Date.now()}`,
              status: 'pending',
            };
            offlineSales.push(sale);
            localStorage.setItem(
              'glowflix-offline-sales',
              JSON.stringify(offlineSales)
            );
            get().clearCart();
            return { success: true, sale, offline: true };
          }
          return {
            success: false,
            error: error.response?.data?.error || 'Erreur création vente',
          };
        }
      },

      // Écouter les changements de connexion
      updateOnlineStatus: () => {
        set({ isOnline: navigator.onLine });
      },
    }),
    {
      name: 'glowflix-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        isLicensed: state.isLicensed,
        licenseKey: state.licenseKey,
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        token: state.token,
      }),
    }
  )
);

// Écouter les changements de connexion réseau
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useStore.getState().updateOnlineStatus();
  });
  window.addEventListener('offline', () => {
    useStore.getState().updateOnlineStatus();
  });
}

