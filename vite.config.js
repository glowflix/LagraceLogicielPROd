import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Charge .env, .env.development, etc.
  const env = loadEnv(mode, process.cwd(), '');

  // Optionnel : permet de surcharger le backend sans modifier le code
  // Ex: VITE_PROXY_TARGET=http://localhost:3030
  const PROXY_TARGET = env.VITE_PROXY_TARGET || 'http://localhost:3030';

  const isProd = mode === 'production';

  return {
    plugins: [react()],

    // Important pour Electron / chemins relatifs d'assets
    base: './',

    root: '.',
    publicDir: 'public',

    server: {
      port: Number(env.VITE_PORT || 5173),
      host: true,            // écoute LAN (0.0.0.0)
      strictPort: true,      // si 5173 occupé -> erreur (évite confusion)
      open: false,

      // HMR stable en LAN : évite certains cas où le client tente de se connecter sur "localhost"
      // Si tu n'as pas besoin d'HMR sur des PCs clients, tu peux le désactiver.
      hmr: {
        // Si le client ouvre via http://IP_SERVEUR:5173
        // et que HMR tente localhost, ça peut glitch. Ce réglage stabilise.
        host: env.VITE_HMR_HOST || undefined,
        protocol: env.VITE_HMR_PROTOCOL || undefined,
        port: env.VITE_HMR_PORT ? Number(env.VITE_HMR_PORT) : undefined,
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
        // Proxy API -> backend (localhost côté serveur)
        '/api': {
          target: PROXY_TARGET,
          changeOrigin: true,
          secure: false,
          // logLevel: 'debug', // décommente si tu veux voir les proxys
          configure: (proxy) => {
            proxy.on('error', (err, req) => {
              console.error('[VITE PROXY] /api error:', err?.message);
            });
          },
        },

        // Proxy Socket.IO (WS)
        '/socket.io': {
          target: PROXY_TARGET,
          ws: true,
          changeOrigin: true,
          secure: false,
          // Timeout plus long pour les WebSockets
          timeout: 60000,
          configure: (proxy) => {
            proxy.on('error', (err, req, res) => {
              // Ne pas logger les erreurs ECONNRESET qui sont normales lors des déconnexions
              // Ces erreurs se produisent quand le client se déconnecte normalement
              if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE' && err.code !== 'ECONNREFUSED') {
                console.error('[VITE PROXY] /socket.io error:', err?.message);
              }
            });
            
            // Gérer les erreurs de proxy WebSocket
            proxy.on('proxyReqWs', (proxyReq, req, socket) => {
              socket.on('error', (err) => {
                // Ignorer les erreurs de connexion fermée
                if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
                  console.error('[VITE PROXY] WebSocket error:', err?.message);
                }
              });
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
