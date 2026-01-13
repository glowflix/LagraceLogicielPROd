import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import os from 'os';

export default defineConfig(({ mode }) => {
  // Charge .env, .env.development, etc.
  const env = loadEnv(mode, process.cwd(), '');

  // Optionnel : permet de surcharger le backend sans modifier le code
  // Ex: VITE_PROXY_TARGET=http://localhost:3030
  const PROXY_TARGET = env.VITE_PROXY_TARGET || 'http://localhost:3030';

  const isProd = mode === 'production';
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PLUGIN PRO: Supprime les erreurs proxy pendant le démarrage du backend
  // ═══════════════════════════════════════════════════════════════════════════
  const silentProxyPlugin = () => ({
    name: 'silent-proxy',
    configureServer(server) {
      // ✅ Intercepter les erreurs de proxy AVANT qu'elles n'arrivent à la console
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;
      let backendReady = false;
      
      // Filtrer les messages d'erreur proxy
      const filterProxyErrors = (fn) => (...args) => {
        const msg = args.join(' ');
        // Supprimer les erreurs de proxy pendant le démarrage
        if (!backendReady && (
          msg.includes('proxy error') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('ECONNRESET') ||
          msg.includes('ws proxy')
        )) {
          return; // Silencieux
        }
        return fn.apply(console, args);
      };
      
      console.error = filterProxyErrors(originalConsoleError);
      console.warn = filterProxyErrors(originalConsoleWarn);
      
      // Marquer le backend comme prêt après une connexion réussie
      server.middlewares.use((req, res, next) => {
        res.on('finish', () => {
          if (req.url?.startsWith('/api') && res.statusCode < 500) {
            if (!backendReady) {
              backendReady = true;
              console.log('[VITE] ✅ Backend connecté!');
            }
          }
        });
        next();
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PLUGIN PRO: Affiche les adresses réseau pour les deux ports
  // ═══════════════════════════════════════════════════════════════════════════
  const networkInfoPlugin = () => ({
    name: 'network-info',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        // Trouver les adresses IP du réseau local
        const interfaces = os.networkInterfaces();
        const addresses = [];
        
        Object.keys(interfaces).forEach((name) => {
          interfaces[name]?.forEach((iface) => {
            if (iface.family === 'IPv4' && !iface.internal) {
              addresses.push(iface.address);
            }
          });
        });
        
        // Afficher les informations PRO
        setTimeout(() => {
          console.log('');
          console.log('  ╔══════════════════════════════════════════════════════════════╗');
          console.log('  ║           🎨 LA GRACE POS - Interface UI Prête               ║');
          console.log('  ╠══════════════════════════════════════════════════════════════╣');
          console.log('  ║  🖥️  Accès depuis CE PC:                                      ║');
          console.log('  ║     ➜  http://localhost:5173/   (Vite + HMR)                 ║');
          console.log('  ║     ➜  http://localhost:3030/   (Backend + UI)               ║');
          console.log('  ╠══════════════════════════════════════════════════════════════╣');
          if (addresses.length > 0) {
            console.log('  ║  📱 Accès depuis le RÉSEAU LOCAL (autres PC/téléphones):     ║');
            addresses.forEach((ip) => {
              console.log(`  ║     ➜  http://${ip}:5173/`.padEnd(66) + '║');
              console.log(`  ║     ➜  http://${ip}:3030/`.padEnd(66) + '║');
            });
          }
          console.log('  ╠══════════════════════════════════════════════════════════════╣');
          console.log('  ║  ✅ Les deux ports sont IDENTIQUES et PRO!                   ║');
          console.log('  ║     Port 5173 = Vite direct (HMR natif)                      ║');
          console.log('  ║     Port 3030 = Backend + Vite (HMR + API intégrés)          ║');
          console.log('  ║                                                              ║');
          console.log('  ║  💡 Recommandé: Port 3030 (tout-en-un, plus simple!)         ║');
          console.log('  ╚══════════════════════════════════════════════════════════════╝');
          console.log('');
        }, 100);
      });
    }
  });

  return {
    plugins: [
      react(),
      silentProxyPlugin(),  // ✅ Doit être AVANT networkInfoPlugin
      networkInfoPlugin(),
    ],

    // Important pour Electron / chemins relatifs d'assets
    base: './',

    root: '.',
    publicDir: 'public',

    server: {
      port: Number(env.VITE_PORT || 5173),
      host: true,            // écoute LAN (0.0.0.0)
      strictPort: true,      // si 5173 occupé -> erreur (évite confusion)
      open: false,

      // ✅ HMR PRO: Fonctionne parfaitement sur TOUS les ports (3030 et 5173)
      // Le client détecte automatiquement le bon port de connexion
      hmr: {
        // Overlay d'erreur visible pour debug rapide
        overlay: true,
        // Timeout généreux pour éviter les déconnexions
        timeout: 30000,
      },

      watch: {
        usePolling: false,   // bon choix si pas de FS distant
        interval: 100,       // valeur safe si polling activé un jour
      },

      // Headers DEV utiles : évite certains caches agressifs
      headers: {
        'Cache-Control': 'no-store',
      },

      proxy: {
        // ═══════════════════════════════════════════════════════════════════
        // PROXY API PRO - Silencieux pendant le démarrage du backend
        // ═══════════════════════════════════════════════════════════════════
        '/api': {
          target: PROXY_TARGET,
          changeOrigin: true,
          secure: false,
          timeout: 30000,
          proxyTimeout: 30000,
          configure: (proxy) => {
            // Compteur pour limiter les logs d'erreur
            let errorCount = 0;
            let lastErrorTime = 0;
            let backendReady = false;
            
            // Liste des codes d'erreur à ignorer (normaux pendant le démarrage)
            const ignoredErrors = ['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'EADDRINUSE', 'ECONNABORTED', 'ETIMEDOUT'];
            
            proxy.on('error', (err, req, res) => {
              const now = Date.now();
              
              // Limiter les logs: 1 par 5 secondes max
              if (!ignoredErrors.includes(err.code)) {
                if (now - lastErrorTime > 5000) {
                  console.warn('[VITE] ⏳ Backend pas encore prêt...');
                  lastErrorTime = now;
                }
              }
              
              // Éviter de planter si la réponse est déjà envoyée
              if (res && !res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  error: 'Backend en cours de démarrage...', 
                  retry: true,
                  message: 'Réessayez dans quelques secondes'
                }));
              }
            });
            
            // Log quand le backend devient disponible
            proxy.on('proxyRes', () => {
              if (!backendReady) {
                backendReady = true;
                console.log('[VITE] ✅ Backend connecté!');
              }
            });
          },
        },

        // ═══════════════════════════════════════════════════════════════════
        // PROXY SOCKET.IO PRO - 100% SILENCIEUX (pas de spam console)
        // ═══════════════════════════════════════════════════════════════════
        '/socket.io': {
          target: PROXY_TARGET,
          ws: true,
          changeOrigin: true,
          secure: false,
          timeout: 120000,
          proxyTimeout: 120000,
          // ✅ PRO: Désactiver les logs d'erreur internes de http-proxy
          logLevel: 'silent',
          configure: (proxy) => {
            let wsConnected = false;
            
            // ✅ 100% SILENCIEUX - Intercepter TOUTES les erreurs sans rien logger
            proxy.on('error', () => {
              // Silencieux complet - le backend démarre lentement, c'est normal
            });
            
            // Gérer les erreurs de proxy WebSocket silencieusement
            proxy.on('proxyReqWs', (proxyReq, req, socket) => {
              socket.on('error', () => {});
              socket.on('close', () => {
                socket.removeAllListeners();
              });
            });
            
            // Log UNIQUE quand le WebSocket se connecte (succès seulement)
            proxy.on('open', (proxySocket) => {
              if (!wsConnected) {
                wsConnected = true;
                console.log('[VITE] 🔌 WebSocket connecté!');
              }
              proxySocket.on('error', () => {});
            });
            
            proxy.on('close', (res, socket, head) => {
              if (socket && !socket.destroyed) {
                socket.removeAllListeners();
              }
            });
          },
        },
      },
    },

    // Préview (quand tu fais vite preview) : utile si tu testes build sur LAN
    preview: {
      port: Number(env.VITE_PREVIEW_PORT || 4173),
      host: true,
      strictPort: true,
    },

    build: {
      outDir: 'dist/ui',
      assetsDir: 'assets',
      copyPublicDir: true,
      emptyOutDir: true,

      // Electron : sourcemap souvent OFF en prod
      sourcemap: !isProd ? true : false,

      // Réduit taille et améliore perf
      cssCodeSplit: true,
      reportCompressedSize: false,

      // chunking plus stable si projet grossit
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
          },
        },
      },

      // Conseil : si tu as des warnings "chunk too large", augmente ça
      chunkSizeWarningLimit: 1200,
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src/ui'),
      },
    },

    // Assets statiques (ok)
    assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.ico'],

    // Define optionnel pour éviter certains crash "process is not defined" (selon libs)
    define: {
      __DEV__: JSON.stringify(!isProd),
    },
  };
});
