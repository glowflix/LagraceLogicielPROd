/**
 * electron/init-bridge.cjs
 * Bridge CommonJS pour Electron main.cjs → modules ESM src/main/
 */

// Détection du chemin des ressources embarquées
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

// En production: les ressources sont dans le bundle Electron
// En dev: les ressources sont dans le dossier print/
// ✅ CORRECTIF: Utiliser process.env.RESOURCES_ROOT qui est défini dans main.cjs
// et a une fallback correcte pour NSIS
const embeddedResourcesPath = isDev
  ? path.join(__dirname, '..', 'print')
  : path.join(process.env.RESOURCES_ROOT || process.resourcesPath || path.dirname(__dirname), 'print');


/**
 * Wrapper pour importer les modules ESM depuis CommonJS
 * Utilise import() dynamique (supporté en Node.js 12.20+)
 */
async function initializeApp() {
  try {
    console.log('[INIT] Début initialisation app...');
    
    const initModule = await import('../src/main/init.js');
    console.log('[INIT] Module init.js importé');
    
    const { initializeApp: initApp } = initModule;
    console.log('[INIT] Appel initializeApp()...');
    
    const context = await initApp(embeddedResourcesPath);
    console.log('[INIT] ✓ App contexte initialisé:', {
      root: context.paths.root,
      dbFile: context.paths.dbFile,
      printerDir: context.paths.printerDir,
    });
    
    return context;
  } catch (error) {
    console.error('[INIT] ❌ ERREUR CRITIQUE initialisation app bridge:', error);
    console.error('[INIT] Stack:', error.stack);
    throw error;
  }
}

/**
 * Wrapper pour le shutdown
 */
async function shutdownApp() {
  try {
    const initModule = await import('../src/main/init.js');
    const { shutdownApp: shutdownFn } = initModule;
    await shutdownFn();
  } catch (error) {
    console.error('Erreur shutdown app bridge:', error);
  }
}

module.exports = {
  initializeApp,
  shutdownApp,
};
