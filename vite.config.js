import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './', // Important pour Electron (évite les problèmes d'assets)
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    host: true,
    watch: {
      usePolling: false, // Désactiver le polling pour éviter les rafraîchissements intempestifs
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3030',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3030',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    copyPublicDir: true,
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui'),
    },
  },
  // Servir les assets statiques
  assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.ico'],
});

