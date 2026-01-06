/**
 * ✅ WRAPPER CommonJS → ESM (server-entry.cjs)
 * 
 * Lanceur pour démarrer le serveur ESM (server.js) en PRODUCTION (EXE)
 * Élimine les erreurs "Cannot use import statement outside a module"
 * 
 * Flux:
 * 1. Electron (main.cjs) lance server-entry.cjs via spawn() + ELECTRON_RUN_AS_NODE
 * 2. Ce fichier CJS importe dynamiquement server.js (ESM) via import()
 * 3. Expose startBackend() pour être utilisé en in-process aussi
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

/**
 * Wrapper robuste pour démarrer le backend
 * Importe dynamiquement server.js en ESM et expose startBackend
 */
async function startBackendWrapper(config) {
  try {
    const appRoot = config?.appRoot || process.env.APP_ROOT || path.dirname(__dirname);
    const serverJs = path.join(appRoot, 'src', 'api', 'server.js');

    if (!fs.existsSync(serverJs)) {
      throw new Error(`server.js introuvable: ${serverJs}`);
    }

    const serverUrl = pathToFileURL(serverJs).href;
    const serverModule = await import(serverUrl);

    if (!serverModule.startBackend || typeof serverModule.startBackend !== 'function') {
      throw new Error(`server.js n'exporte pas startBackend()`);
    }

    const result = await serverModule.startBackend(config);
    return result;
  } catch (error) {
    console.error('[BACKEND] ❌ Erreur:', error.message);
    throw error;
  }
}

/**
 * Mode SPAWN: lancé directement via spawn() + ELECTRON_RUN_AS_NODE
 * Démarrer le backend en tant que processus indépendant
 */
if (require.main === module) {
  const config = {
    port: parseInt(process.env.PORT || '3030', 10),
    host: process.env.HOST || '127.0.0.1',
    staticDir: process.env.STATIC_DIR || path.join(__dirname, '..', '..', 'ui'),
    isElectron: true,
    appRoot: process.env.APP_ROOT,
    resourcesPath: process.env.RESOURCES_ROOT,
  };

  startBackendWrapper(config)
    .then(() => {})
    .catch((error) => {
      console.error('[BACKEND] ❌', error.message);
      process.exit(1);
    });
}

/**
 * Mode IN-PROCESS: require() par main.cjs via startBackendInProcess()
 * Exporter startBackend pour utilisation directe
 */
module.exports = {
  startBackend: startBackendWrapper,
};
