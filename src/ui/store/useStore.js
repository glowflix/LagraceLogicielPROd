import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import axios from 'axios';
import { io } from 'socket.io-client';
import { getApiUrl, getSocketUrl } from '../utils/apiConfig.js';
import { generateLocalToken, decodeLocalToken, isValidToken } from '../utils/token';
import AudioHandler from '../utils/audioHandler.js';
import { throttle, debounce } from '../utils/socketOptimized.js';

// URL API dynamique (détectée automatiquement ou configurée)
// En mode proxy Vite, API_URL sera '' (chemins relatifs)
let API_URL = getApiUrl();

// Fonction pour mettre à jour l'URL API (exportée pour utilisation dans SettingsPage)
export function updateApiUrl(newUrl) {
  API_URL = newUrl;
  // Reconnecter le socket si nécessaire
  const store = useStore.getState();
  if (store.socket) {
    store.socket.disconnect();
    store.initSocket();
  }
}

// Fonction pour obtenir l'URL API actuelle
export function getCurrentApiUrl() {
  return API_URL;
}

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
      audioHandler: null,

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
            // Accepter soit "987654321" (depuis le fichier) soit "0987654321" (démonstration)
            if ((license.key === '987654321' || license.key === '0987654321') && license.isLicensed) {
              // Vérifier si un token existe déjà
              const currentState = get();
              let token = currentState.token;
              
              // Si pas de token ou token invalide, générer un token local
              if (!token || !isValidToken(token)) {
                const tokenData = generateLocalToken({
                  licenseKey: license.key,
                  isOffline: true,
                });
                token = tokenData.token;
              }
              
              set({ 
                isLicensed: true, 
                licenseKey: license.key,
                token,
                isLoading: false 
              });
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
        // Accepter soit "987654321" (depuis le fichier) soit "0987654321" (démonstration)
        const trimmedKey = key.trim();
        if (trimmedKey === '987654321' || trimmedKey === '0987654321') {
          const license = {
            key: trimmedKey,
            isLicensed: true,
            activatedAt: new Date().toISOString(),
          };
          localStorage.setItem('glowflix-license', JSON.stringify(license));
          
          // Générer automatiquement un token local
          const tokenData = generateLocalToken({
            licenseKey: trimmedKey,
            isOffline: true,
          });
          
          set({ 
            isLicensed: true, 
            licenseKey: trimmedKey,
            token: tokenData.token,
            isAuthenticated: false, // Pas encore connecté, juste licence activée
            user: null,
          });
          return true;
        }
        return false;
      },

      // Actions Authentification
      login: async (identifier, password) => {
        try {
          // Détecter si l'identifiant est un numéro (que des chiffres) ou un username
          const isPhoneNumber = /^\d+$/.test(identifier.trim());
          
          // Préparer le body selon le type d'identifiant
          const loginBody = isPhoneNumber 
            ? { numero: identifier.trim(), password }
            : { username: identifier.trim(), password };
          
          console.log('🔐 [LOGIN] Tentative de connexion:', { 
            identifier, 
            type: isPhoneNumber ? 'numero' : 'username',
            hasPassword: !!password 
          });
          
          const response = await axios.post(`${API_URL}/api/auth/login`, loginBody);

          if (response.data.success) {
            const { user, token: serverToken } = response.data;
            
            // Générer un token local avec les flags de rôle pour compatibilité offline
            // Le token serveur JWT sera utilisé pour les appels API, mais on garde aussi un token local
            const licenseKey = get().licenseKey || '0987654321';
            const localTokenData = generateLocalToken({
              licenseKey,
              userId: user.id,
              user,
              isOffline: false, // Online car connecté au serveur
            });
            
            // Utiliser le token serveur pour les appels API, mais stocker aussi le token local
            set({
              isAuthenticated: true,
              user,
              token: serverToken, // Token JWT du serveur pour les appels API
            });
            
            // Stocker aussi le token local dans localStorage pour compatibilité
            localStorage.setItem('glowflix-local-token', localTokenData.token);
            
            // Initialiser le socket après connexion
            get().initSocket();
            // Charger les données automatiquement après connexion
            setTimeout(() => {
              get().loadProducts().catch(err => console.error('Erreur chargement produits:', err));
              get().loadCurrentRate().catch(err => console.error('Erreur chargement taux:', err));
            }, 500);
            return { success: true };
          }
          
          // Si la réponse n'est pas success, retourner l'erreur
          return { 
            success: false, 
            error: response.data?.error || 'Identifiants invalides',
            debugInfo: response.data 
          };
        } catch (error) {
          console.error('❌ [LOGIN] Erreur lors de la connexion:', error);
          console.error('   Code:', error.code);
          console.error('   Status:', error.response?.status);
          console.error('   Message:', error.message);
          
          // Mode offline: chercher l'utilisateur localement ou créer un token offline
          // Gérer aussi les erreurs 401 si c'est un problème de mot de passe mais que l'utilisateur existe localement
          const isNetworkError = !navigator.onLine || 
                                 error.code === 'ERR_NETWORK' || 
                                 error.code === 'ECONNREFUSED' ||
                                 error.code === 'ETIMEDOUT' ||
                                 (error.response?.status >= 500 && error.response?.status < 600);
          
          const isAuthError = error.response?.status === 401;
          
          // Si erreur réseau OU erreur 401 (on peut essayer localement), essayer le mode offline
          if (isNetworkError || isAuthError) {
            if (isAuthError) {
              console.log('🔍 [LOGIN] Erreur 401 détectée, tentative connexion locale...');
            } else {
              console.log('🌐 [LOGIN] Mode offline détecté, tentative connexion locale...');
            }
            // Essayer de charger l'utilisateur depuis la base locale via l'API
            try {
              // Détecter si l'identifiant est un numéro ou un username
              const isPhoneNumber = /^\d+$/.test(identifier.trim());
              const loginBody = isPhoneNumber 
                ? { numero: identifier.trim(), password }
                : { username: identifier.trim(), password };
              
              // Appel API local pour vérifier l'utilisateur même en offline
              const localResponse = await axios.post(`${API_URL}/api/auth/login`, loginBody, { timeout: 2000 });
              
              if (localResponse.data.success) {
                const { user } = localResponse.data;
                // Générer un token local avec les infos utilisateur
                const licenseKey = get().licenseKey || '0987654321';
                const tokenData = generateLocalToken({
                  licenseKey,
                  userId: user.id,
                  user,
                  isOffline: true,
                });
                
                set({
                  isAuthenticated: true,
                  user,
                  token: tokenData.token,
                });
                get().initSocket();
                setTimeout(() => {
                  get().loadProducts().catch(() => {
                    console.warn('Impossible de charger les produits (mode offline)');
                  });
                  get().loadCurrentRate().catch(() => {
                    console.warn('Impossible de charger le taux (mode offline)');
                  });
                }, 500);
                return { success: true, offline: true };
              }
            } catch (localError) {
              // Si même l'API locale échoue, créer un token offline basique
              console.warn('API locale inaccessible, création token offline basique');
            }
            
            // Fallback: token offline basique (pour compatibilité)
            console.warn('⚠️ [LOGIN] API locale inaccessible, création token offline basique');
            const licenseKey = get().licenseKey || '0987654321';
            const tokenData = generateLocalToken({
              licenseKey,
              user: { username: identifier, is_admin: false, is_vendeur: true },
              isOffline: true,
            });
            
            set({
              isAuthenticated: true,
              user: { username: identifier, is_admin: false, is_vendeur: true },
              token: tokenData.token,
            });
            get().initSocket();
            setTimeout(() => {
              get().loadProducts().catch(() => {
                console.warn('Impossible de charger les produits (mode offline)');
              });
              get().loadCurrentRate().catch(() => {
                console.warn('Impossible de charger le taux (mode offline)');
              });
            }, 500);
            return { success: true, offline: true };
          }
          
          // Si erreur 401 mais pas de mode offline disponible, retourner l'erreur avec détails
          if (isAuthError && !isNetworkError) {
            const errorMsg = error.response?.data?.error || 'Numéro ou mot de passe invalide';
            const debugInfo = error.response?.data;
            console.error('❌ [LOGIN] Erreur 401:', errorMsg, debugInfo);
            return {
              success: false,
              error: errorMsg,
              debugInfo: debugInfo
            };
          }
          
          // Autres erreurs réseau
          return {
            success: false,
            error: error.response?.data?.error || error.message || 'Erreur de connexion',
            debugInfo: error.response?.data
          };
        }
      },

      logout: () => {
        // Déconnecter le socket
        if (get().socket) {
          get().socket.disconnect();
        }
        
        // Supprimer complètement la licence et tout nettoyer
        localStorage.removeItem('glowflix-license');
        
        // Nettoyer complètement l'état
        set({
          isLicensed: false,
          licenseKey: null,
          isAuthenticated: false,
          user: null,
          token: null,
          socket: null,
          socketConnected: false,
          cart: [],
        });
      },
      
      // Helper pour obtenir le rôle actuel
      getCurrentRole: () => {
        const state = get();
        const tokenData = decodeLocalToken(state.token);
        return tokenData?.role || 'LICENSE_ONLY';
      },

      // Actions Socket
      initSocket: () => {
        if (get().socket) {
          get().socket.disconnect();
          get().socket.removeAllListeners();
        }

        // Utiliser getSocketUrl() pour la compatibilité LAN
        // En mode proxy Vite, socketUrl sera undefined (utilise l'origine actuelle)
        const socketUrl = getSocketUrl();
        const socket = io(socketUrl, {
          transports: ['websocket', 'polling'],
          // Reconnexion automatique avec backoff exponentiel
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: Infinity, // Reconnexion infinie
          // Timeout pour les connexions
          timeout: 20000,
          // Ping/pong pour maintenir la connexion active
          pingTimeout: 60000,
          pingInterval: 25000,
          // Forcer le polling si WebSocket échoue
          forceNew: false,
          // Améliorer la gestion des erreurs réseau
          autoConnect: true,
        });

        socket.on('connect', () => {
          console.log('✅ Socket connecté:', socket.id);
          
          // Initialiser l'AudioHandler pour recevoir l'audio de l'IA
          if (!get().audioHandler) {
            console.log('🎵 Initialisation AudioHandler...');
            const audioHandler = new AudioHandler(socket);
            set({ audioHandler });
            console.log('🎵 ✅ AudioHandler initialisé');
          }
          
          set({ socketConnected: true, isOnline: true });
        });

        socket.on('disconnect', (reason) => {
          console.log('❌ Socket déconnecté:', reason);
          set({ socketConnected: false });
          
          // Si la déconnexion est due à une erreur réseau, essayer de reconnecter
          if (reason === 'io server disconnect') {
            // Le serveur a forcé la déconnexion, ne pas reconnecter automatiquement
            console.warn('⚠️ Serveur a fermé la connexion');
          } else if (reason === 'io client disconnect') {
            // Le client a fermé la connexion volontairement
            console.log('ℹ️ Connexion fermée par le client');
          } else {
            // Erreur réseau ou autre, laisser Socket.IO reconnecter automatiquement
            console.log('🔄 Tentative de reconnexion en cours...');
          }
          
          // Vérifier si c'est vraiment offline ou juste une déconnexion temporaire
          get().checkConnection();
        });

        socket.on('connect_error', (error) => {
          console.error('❌ Erreur connexion socket:', error.message);
          set({ socketConnected: false });
          
          // Ne pas appeler checkConnection() trop souvent pour éviter les boucles
          // Socket.IO gère déjà la reconnexion automatique
        });

        socket.on('reconnect', (attemptNumber) => {
          console.log(`✅ Socket reconnecté après ${attemptNumber} tentative(s)`);
          set({ socketConnected: true, isOnline: true });
        });

        socket.on('reconnect_attempt', (attemptNumber) => {
          console.log(`🔄 Tentative de reconnexion ${attemptNumber}...`);
        });

        socket.on('reconnect_error', (error) => {
          console.error('❌ Erreur lors de la reconnexion:', error.message);
        });

        socket.on('reconnect_failed', () => {
          console.error('❌ Échec de la reconnexion après toutes les tentatives');
          set({ socketConnected: false });
          get().checkConnection();
        });

        // Throttlers pour éviter trop de re-renders
        const throttledUpdateSales = throttle((sale) => {
          set((state) => ({
            sales: [sale, ...state.sales].slice(0, 100), // Limiter à 100 dernières
          }));
        }, 300);

        const throttledUpdateStock = throttle((stock) => {
          set((state) => ({
            stock: state.stock.map((s) =>
              s.id === stock.id ? stock : s
            ),
          }));
        }, 500);

        const throttledUpdateProduct = throttle((product) => {
          set((state) => ({
            products: state.products.map((p) =>
              p.id === product.id ? product : p
            ),
          }));
        }, 500);

        const debouncedReloadProducts = debounce(() => {
          get().loadProducts();
        }, 1000);

        const throttledUpdateRate = throttle((rate) => {
          set({ currentRate: rate.rate });
        }, 2000);

        socket.on('sale:created', throttledUpdateSales);

        socket.on('stock:updated', throttledUpdateStock);

        socket.on('product:updated', (product) => {
          throttledUpdateProduct(product);
          // Recharger les produits en arrière-plan avec debounce
          debouncedReloadProducts();
        });

        // ✅ Écouter les mises à jour batch de produits depuis Google Sheets
        socket.on('products:updated', (data) => {
          // Recharger les produits avec debounce pour éviter trop de requêtes
          debouncedReloadProducts();
        });

        socket.on('sale:updated', throttledUpdateSales);

        socket.on('rate:updated', throttledUpdateRate);

        socket.on('debt:updated', (debt) => {
          // Dettes: pas de throttle (critique)
          console.log('Dette mise à jour:', debt);
        });

        // Écouter la déconnexion automatique si le compte devient invalide
        socket.on('user:deactivated', (data) => {
          console.warn('⚠️ Compte désactivé:', data);
          const currentUser = get().user;
          
          // Vérifier si c'est l'utilisateur actuellement connecté
          if (currentUser && (
            currentUser.id === data.user_id ||
            currentUser.phone === data.phone ||
            currentUser.username === data.username
          )) {
            console.warn('🚫 Déconnexion automatique: compte désactivé lors de la synchronisation');
            // Déconnecter l'utilisateur
            get().logout();
            
            // Afficher une notification (si disponible)
            if (window.alert) {
              alert('Votre compte a été désactivé. Vous avez été déconnecté automatiquement.');
            }
          }
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
          const response = await axios.get(`${API_URL}/api/products`, {
            timeout: 10000, // Timeout de 10 secondes
          });
          if (response.data && Array.isArray(response.data)) {
            set({ products: response.data });
            console.log(`✅ ${response.data.length} produit(s) chargé(s)`);
          } else {
            console.warn('Réponse API invalide pour les produits:', response.data);
          }
        } catch (error) {
          console.error('❌ Erreur chargement produits:', error.message);
          if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK') {
            console.warn('Serveur inaccessible, mode offline activé');
          }
          // Mode offline: utiliser cache local ou garder les produits existants
        }
      },

      loadCurrentRate: async () => {
        try {
          const response = await axios.get(`${API_URL}/api/rates/current`, {
            timeout: 5000, // Timeout de 5 secondes
          });
          if (response.data && response.data.success) {
            set({ currentRate: response.data.rate });
            console.log(`✅ Taux de change chargé: ${response.data.rate} FC/USD`);
            return response.data.rate;
          }
        } catch (error) {
          console.error('❌ Erreur chargement taux:', error.message);
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
          
          // IMPORTANT: Exclure les ventes avec status='pending' par défaut
          // Ces ventes sont en attente de synchronisation et ne doivent pas apparaître dans l'historique
          if (!filters.status) {
            params.append('exclude_status', 'pending');
          }
          
          const queryString = params.toString();
          const url = queryString 
            ? `${API_URL}/api/sales?${queryString}`
            : `${API_URL}/api/sales?exclude_status=pending`;
          
          const response = await axios.get(url, {
            timeout: 10000, // Timeout de 10 secondes
          });
          if (response.data && Array.isArray(response.data)) {
            // Filtrer également côté client pour sécurité (double vérification)
            const filteredSales = response.data.filter(sale => sale.status !== 'pending');
            set({ sales: filteredSales });
            console.log(`✅ ${filteredSales.length} vente(s) chargée(s) (${response.data.length - filteredSales.length} pending exclue(s))`);
          } else {
            set({ sales: [] });
            console.warn('Réponse API invalide pour les ventes:', response.data);
          }
        } catch (error) {
          console.error('❌ Erreur chargement ventes:', error.message);
          if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK') {
            console.warn('Serveur inaccessible, mode offline activé');
          }
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

      // Vérifier la connexion réelle au serveur
      /**
       * Vérifie la connexion au backend pour la synchronisation automatique en arrière-plan
       * IMPORTANT: Cette fonction est uniquement pour la synchronisation automatique.
       * Le logiciel de ventes fonctionne toujours en mode offline-first et ne dépend pas de cette connexion.
       */
      checkConnection: async () => {
        try {
          // Vérifier d'abord navigator.onLine
          if (!navigator.onLine) {
            set({ isOnline: false, socketConnected: false });
            return false;
          }

          // Tester la connexion réelle au serveur avec un timeout court
          // Ceci est uniquement pour permettre la synchronisation automatique en arrière-plan
          try {
            const response = await axios.get(`${API_URL}/api/health`, {
              timeout: 3000,
              headers: {
                'Cache-Control': 'no-cache',
              },
            });

            if (response.status === 200) {
              set({ isOnline: true });
              // Si le socket n'est pas connecté, essayer de le reconnecter
              // Le socket est utilisé pour les notifications en temps réel, pas pour les ventes
              if (!get().socketConnected && !get().socket) {
                get().initSocket();
              }
              return true;
            } else {
              set({ isOnline: false });
              return false;
            }
          } catch (error) {
            if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED') {
              console.warn('⚠️ [CONNECTION] Serveur backend inaccessible - Synchronisation automatique en pause');
            }
            set({ isOnline: false });
            return false;
          }
        } catch (error) {
          console.error('❌ [CONNECTION] Erreur vérification connexion backend:', error);
          set({ isOnline: false });
          return false;
        }
      },

      // Écouter les changements de connexion
      updateOnlineStatus: () => {
        const wasOnline = get().isOnline;
        const nowOnline = navigator.onLine;
        
        set({ isOnline: nowOnline });
        
        // Si la connexion vient de revenir, vérifier la connexion réelle
        if (!wasOnline && nowOnline) {
          console.log('🌐 [CONNECTION] Connexion détectée, vérification du serveur...');
          setTimeout(() => {
            get().checkConnection();
          }, 500);
        } else if (wasOnline && !nowOnline) {
          console.log('❌ [CONNECTION] Connexion perdue');
          set({ isOnline: false, socketConnected: false });
        }
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
        // Toujours persister le token pour éviter les erreurs "token missing"
      }),
    }
  )
);

// Écouter les changements de connexion réseau
if (typeof window !== 'undefined') {
  // Vérifier la connexion au démarrage
  setTimeout(() => {
    useStore.getState().checkConnection();
  }, 2000); // Attendre 2 secondes après le chargement pour laisser le serveur démarrer
  
  // Vérifier périodiquement la connexion (toutes les 30 secondes)
  setInterval(() => {
    if (navigator.onLine) {
      useStore.getState().checkConnection();
    }
  }, 30000);
  
  window.addEventListener('online', () => {
    console.log('🌐 [CONNECTION] Événement "online" détecté');
    useStore.getState().updateOnlineStatus();
  });
  
  window.addEventListener('offline', () => {
    console.log('❌ [CONNECTION] Événement "offline" détecté');
    useStore.getState().updateOnlineStatus();
  });
}

