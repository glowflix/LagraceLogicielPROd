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

      // État de connexion PRO LOCAL-FIRST
      isOnline: true,               // Optimiste au démarrage (local-first)
      backendConnected: false,      // Connexion au backend SQLite local
      backendLatency: null,         // Latence en ms vers le backend
      sheetsConnected: null,        // Connexion Google Sheets (null = pas testé)
      lastSync: null,
      lastHealthCheck: null,        // Dernière vérification du backend

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
        
        // ✅ CONFIGURATION SOCKET.IO ULTRA-OPTIMISÉE
        // Objectif: Connexion rapide, stable, sans coupures ni retards
        const socket = io(socketUrl, {
          // ═══════════════════════════════════════════════════════════════
          // TRANSPORT - WebSocket prioritaire pour vitesse maximale
          // ═══════════════════════════════════════════════════════════════
          transports: ['websocket', 'polling'], // WebSocket d'abord, polling en backup
          upgrade: true,                         // Essayer d'upgrader polling → websocket
          rememberUpgrade: true,                 // Se souvenir du transport fonctionnel
          
          // ═══════════════════════════════════════════════════════════════
          // RECONNEXION AGRESSIVE - Jamais perdre la connexion longtemps
          // ═══════════════════════════════════════════════════════════════
          reconnection: true,
          reconnectionDelay: 300,               // ⚡ Retry après 300ms (très rapide)
          reconnectionDelayMax: 2000,           // ⚡ Max 2s entre tentatives (pas 5s)
          reconnectionAttempts: Infinity,        // Ne jamais abandonner
          randomizationFactor: 0.3,              // Petite variation pour éviter les collisions
          
          // ═══════════════════════════════════════════════════════════════
          // TIMEOUTS OPTIMISÉS - Réponse rapide
          // ═══════════════════════════════════════════════════════════════
          timeout: 8000,                        // ⚡ 8s max pour connexion (pas 20s)
          
          // ═══════════════════════════════════════════════════════════════
          // HEARTBEAT FRÉQUENT - Détecter les déconnexions rapidement
          // ═══════════════════════════════════════════════════════════════
          pingTimeout: 15000,                   // ⚡ 15s avant de considérer mort (pas 60s)
          pingInterval: 5000,                   // ⚡ Ping toutes les 5s (pas 25s)
          
          // ═══════════════════════════════════════════════════════════════
          // CONNEXION
          // ═══════════════════════════════════════════════════════════════
          forceNew: false,                      // Réutiliser la connexion existante
          autoConnect: true,                    // Connecter immédiatement
          multiplex: true,                      // Partager la connexion entre namespaces
          
          // ═══════════════════════════════════════════════════════════════
          // PERFORMANCE - Buffer et compression
          // ═══════════════════════════════════════════════════════════════
          perMessageDeflate: {
            threshold: 512,                     // Compresser si > 512 bytes
          },
        });

        // ═══════════════════════════════════════════════════════════════
        // ÉVÉNEMENTS SOCKET - Gestion optimisée sans logs excessifs
        // ═══════════════════════════════════════════════════════════════
        
        let lastConnectLog = 0;
        let lastDisconnectLog = 0;
        let reconnectAttempts = 0;
        
        socket.on('connect', () => {
          const now = Date.now();
          // ⚡ Limiter les logs à 1 par seconde max
          if (now - lastConnectLog > 1000) {
            console.log('✅ Socket connecté:', socket.id);
            lastConnectLog = now;
          }
          
          // Réinitialiser le compteur de tentatives
          reconnectAttempts = 0;
          
          // Initialiser l'AudioHandler pour recevoir l'audio de l'IA
          if (!get().audioHandler) {
            const audioHandler = new AudioHandler(socket);
            set({ audioHandler });
          }
          
          set({ socketConnected: true, isOnline: true });
        });

        socket.on('disconnect', (reason) => {
          const now = Date.now();
          // ⚡ Limiter les logs de déconnexion
          if (now - lastDisconnectLog > 2000) {
            console.log('❌ Socket déconnecté:', reason);
            lastDisconnectLog = now;
          }
          
          set({ socketConnected: false });
          
          // ⚡ Ne vérifier la connexion que pour les vraies erreurs réseau
          if (reason !== 'io client disconnect' && reason !== 'io server disconnect') {
            // Erreur réseau, Socket.IO reconnecte automatiquement
            // Pas besoin de checkConnection() ici
          }
        });

        socket.on('connect_error', (error) => {
          // ⚡ Log limité pour éviter le spam en cas de problème réseau
          if (reconnectAttempts === 0 || reconnectAttempts % 10 === 0) {
            console.warn('⚠️ Erreur connexion socket:', error.message);
          }
          set({ socketConnected: false });
        });

        socket.on('reconnect', (attemptNumber) => {
          console.log(`✅ Socket reconnecté après ${attemptNumber} tentative(s)`);
          reconnectAttempts = 0;
          set({ socketConnected: true, isOnline: true });
        });

        socket.on('reconnect_attempt', (attemptNumber) => {
          reconnectAttempts = attemptNumber;
          // ⚡ Log uniquement toutes les 5 tentatives pour éviter le spam
          if (attemptNumber <= 3 || attemptNumber % 5 === 0) {
            console.log(`🔄 Reconnexion socket... tentative ${attemptNumber}`);
          }
        });

        socket.on('reconnect_error', (error) => {
          // ⚡ Log limité
          if (reconnectAttempts % 10 === 0) {
            console.warn('⚠️ Erreur reconnexion:', error.message);
          }
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

      // ═══════════════════════════════════════════════════════════════════════════
      // CONNEXION PRO LOCAL-FIRST
      // ═══════════════════════════════════════════════════════════════════════════
      
      // État de connexion détaillé (ajouté au state initial via set)
      backendConnected: false,      // Connexion au backend SQLite local
      backendLatency: null,         // Latence en ms du backend
      sheetsConnected: null,        // Connexion à Google Sheets (null = pas testé)
      lastHealthCheck: null,        // Dernière vérification du backend
      
      /**
       * Vérifie la connexion au BACKEND LOCAL (SQLite) - pas à Internet
       * IMPORTANT: Pour une app local-first, on détecte le backend SQL local, pas l'internet.
       * 
       * Priorité: Backend Local > Socket > navigator.onLine
       * 
       * Cette architecture permet:
       * - Fonctionnement 100% hors-ligne avec SQLite local
       * - Sync en temps réel via WebSocket sur LAN
       * - Sync externe vers Google Sheets (optionnel)
       */
      checkConnection: async () => {
        const startTime = performance.now();
        
        try {
          // 1. Vérifier la connexion au backend local (la plus importante!)
          const response = await axios.get(`${API_URL}/api/health`, {
            timeout: 5000, // 5 secondes pour le LAN
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
            },
          });

          const latency = Math.round(performance.now() - startTime);

          if (response.status === 200) {
            // ✅ Backend local connecté = application fonctionnelle
            set({ 
              isOnline: true, 
              backendConnected: true,
              backendLatency: latency,
              lastHealthCheck: new Date().toISOString(),
            });
            
            // Log uniquement si la latence est élevée
            if (latency > 500) {
              console.warn(`⚠️ [LAN] Latence élevée: ${latency}ms`);
            }
            
            // Si le socket n'est pas connecté, essayer de le reconnecter
            if (!get().socketConnected && !get().socket) {
              get().initSocket();
            }
            return true;
          } else {
            set({ 
              isOnline: false, 
              backendConnected: false,
              backendLatency: null,
            });
            return false;
          }
        } catch (error) {
          // ❌ Backend local inaccessible
          const isNetworkError = ['ECONNABORTED', 'ERR_NETWORK', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code);
          
          if (isNetworkError) {
            // Erreur réseau locale = backend pas démarré ou inaccessible
            console.warn('⚠️ [LOCAL] Backend SQL local inaccessible - vérifier que le serveur est démarré');
          }
          
          set({ 
            isOnline: false, 
            backendConnected: false,
            backendLatency: null,
          });
          return false;
        }
      },
      
      /**
       * Vérifie la connexion à Google Sheets (sync externe)
       * Retourne true si Sheets est accessible, false sinon
       * Ne bloque jamais l'application locale
       */
      checkSheetsConnection: async () => {
        try {
          const response = await axios.get(`${API_URL}/api/sync/status`, {
            timeout: 10000, // Plus de temps pour Sheets (réseau externe)
          });
          
          if (response.data) {
            set({ 
              sheetsConnected: response.data.connected ?? true,
              lastSync: response.data.lastSync || response.data.last_sync || null,
            });
            return true;
          }
          set({ sheetsConnected: false });
          return false;
        } catch (error) {
          // Sheets inaccessible = pas grave, on continue en local
          set({ sheetsConnected: false });
          return false;
        }
      },

      /**
       * Écouter les changements de connexion - PRO LOCAL-FIRST
       * IMPORTANT: navigator.onLine détecte Internet, pas le backend local.
       * On l'utilise comme indicateur secondaire, le backend local prime.
       */
      updateOnlineStatus: () => {
        const wasOnline = get().isOnline;
        const wasBackendConnected = get().backendConnected;
        const nowNavigatorOnline = navigator.onLine;
        
        // Si navigator dit offline, vérifier quand même le backend local
        // Car le LAN peut fonctionner sans Internet
        if (!nowNavigatorOnline) {
          console.log('⚠️ [CONNECTION] Navigator.onLine = false, vérification du backend local...');
          // Vérifier le backend local (peut fonctionner sur LAN sans Internet)
          get().checkConnection();
        } else if (!wasOnline && nowNavigatorOnline) {
          // Connexion Internet revenue, vérifier le backend
          console.log('🌐 [CONNECTION] Connexion détectée, vérification du backend local...');
          setTimeout(() => {
            get().checkConnection();
          }, 300);
        }
        
        // Si on était connecté au backend et on ne l'est plus
        if (wasBackendConnected && !get().backendConnected) {
          console.log('❌ [LOCAL] Connexion au backend local perdue');
          set({ socketConnected: false });
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

// ═══════════════════════════════════════════════════════════════════════════════
// GESTION CONNEXION PRO LOCAL-FIRST
// ═══════════════════════════════════════════════════════════════════════════════
// 
// Architecture de connexion:
// 1. Backend Local (SQLite) - Toujours prioritaire, vérifié via /api/health
// 2. WebSocket LAN - Pour sync temps réel entre PC/téléphones
// 3. Google Sheets - Sync externe optionnelle (ne bloque jamais)
//
// L'application fonctionne TOUJOURS tant que le backend local est accessible,
// même sans connexion Internet. C'est le principe LOCAL-FIRST.
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  // Vérifier la connexion au démarrage (plus rapide: 1s)
  setTimeout(() => {
    console.log('🚀 [LOCAL-FIRST] Vérification du backend local...');
    useStore.getState().checkConnection();
  }, 1000);
  
  // Vérifier périodiquement le backend local (toutes les 10 secondes)
  // IMPORTANT: On vérifie le BACKEND LOCAL, pas Internet
  const healthCheckInterval = setInterval(() => {
    // Toujours vérifier le backend local, même si navigator.onLine est false
    // Car le LAN peut fonctionner sans connexion Internet
    useStore.getState().checkConnection();
  }, 10000);
  
  // Vérifier périodiquement Google Sheets (toutes les 60 secondes)
  // C'est secondaire et ne doit jamais bloquer l'application
  setInterval(() => {
    const state = useStore.getState();
    // Seulement si le backend local est connecté
    if (state.backendConnected) {
      state.checkSheetsConnection?.();
    }
  }, 60000);
  
  // Écouter les événements navigator (indicateur secondaire)
  window.addEventListener('online', () => {
    console.log('🌐 [NETWORK] Navigator "online" - vérification du backend local...');
    useStore.getState().updateOnlineStatus();
  });
  
  window.addEventListener('offline', () => {
    console.log('⚠️ [NETWORK] Navigator "offline" - vérification du backend local...');
    // NOTE: Le LAN peut fonctionner sans Internet, on vérifie quand même le backend
    useStore.getState().updateOnlineStatus();
  });
  
  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    clearInterval(healthCheckInterval);
  });
}

