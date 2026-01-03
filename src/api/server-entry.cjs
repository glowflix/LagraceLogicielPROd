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
    // ✅ Déterminer le chemin de server.js
    // APP_ROOT = répertoire du code (app.asar en prod, project root en dev)
    const appRoot = config?.appRoot || process.env.APP_ROOT || path.dirname(__dirname);
    const serverJs = path.join(appRoot, 'src', 'api', 'server.js');

    console.log('[SERVER-ENTRY] 🚀 Wrapper ESM → CommonJS activé');
    console.log(`[SERVER-ENTRY] APP_ROOT: ${appRoot}`);
    console.log(`[SERVER-ENTRY] Server JS: ${serverJs}`);

    // ✅ Vérifier que le fichier existe
    if (!fs.existsSync(serverJs)) {
      throw new Error(`server.js introuvable: ${serverJs}`);
    }

    // ✅ Convertir le chemin en URL pour l'import ESM
    const serverUrl = pathToFileURL(serverJs).href;
    console.log(`[SERVER-ENTRY] 📥 Import URL: ${serverUrl}`);

    // ✅ Import dynamique du module ESM
    console.log('[SERVER-ENTRY] ⏳ Import dynamique de server.js...');
    const serverModule = await import(serverUrl);

    // ✅ Vérifier que startBackend est exporté
    if (!serverModule.startBackend || typeof serverModule.startBackend !== 'function') {
      throw new Error(`server.js n'exporte pas startBackend() en tant que fonction. Exports: ${Object.keys(serverModule).join(', ')}`);
    }

    console.log('[SERVER-ENTRY] ✅ server.js importé avec succès');

    // ✅ Appeler startBackend avec la config
    console.log('[SERVER-ENTRY] 🔧 Démarrage du backend...');
    const result = await serverModule.startBackend(config);

    console.log('[SERVER-ENTRY] ✅ Backend démarré avec succès');
    return result;
  } catch (error) {
    console.error('[SERVER-ENTRY] ❌ Erreur:', error.message);
    if (error.stack) {
      console.error('[SERVER-ENTRY] ❌ Stack:\n', error.stack);
    }
    throw error;
  }
}

/**
 * Mode SPAWN: lancé directement via spawn() + ELECTRON_RUN_AS_NODE
 * Démarrer le backend en tant que processus indépendant
 */
if (require.main === module) {
  console.log('[SERVER-ENTRY] ════════════════════════════════════════');
  console.log('[SERVER-ENTRY] 🔴 MODE SPAWN: Démarrage en processus séparé');
  console.log('[SERVER-ENTRY] ════════════════════════════════════════');

  const config = {
    port: parseInt(process.env.PORT || '3030', 10),
    host: process.env.HOST || '127.0.0.1',
    staticDir: process.env.STATIC_DIR || path.join(__dirname, '..', '..', 'ui'),
    isElectron: true,
    appRoot: process.env.APP_ROOT,
    resourcesPath: process.env.RESOURCES_ROOT,
  };

  console.log('[SERVER-ENTRY] Configuration:');
  console.log(`[SERVER-ENTRY]   PORT: ${config.port}`);
  console.log(`[SERVER-ENTRY]   HOST: ${config.host}`);
  console.log(`[SERVER-ENTRY]   staticDir: ${config.staticDir}`);
  console.log(`[SERVER-ENTRY]   appRoot: ${config.appRoot}`);
  console.log('[SERVER-ENTRY] ════════════════════════════════════════\n');

  startBackendWrapper(config)
    .then(() => {
      console.log('[SERVER-ENTRY] ✅ Backend est prêt et en écoute');
    })
    .catch((error) => {
      console.error('[SERVER-ENTRY] ❌ Erreur critique au démarrage:');
      console.error('[SERVER-ENTRY]', error.message);
      if (error.stack) {
        console.error('[SERVER-ENTRY] Stack:', error.stack);
      }
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
