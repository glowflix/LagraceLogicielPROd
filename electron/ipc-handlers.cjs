/**
 * electron/ipc-handlers.cjs
 * Expose les chemins et fonctionnalités aux processus renderer via IPC
 */

const { ipcMain } = require('electron');

/**
 * Initialise les handlers IPC pour accès aux chemins et fonctionnalités
 * @param {Object} appContext - contexte app (paths, db, etc.) depuis init-bridge.cjs
 */
function initializeIpcHandlers(appContext) {
  if (!appContext) {
    console.warn('⚠️  appContext non disponible, IPC handlers non initialisés');
    return;
  }

  const { paths } = appContext;

  // ============ CHEMINS (READ-ONLY) ============
  ipcMain.handle('app:getPaths', () => {
    return {
      root: paths.root,
      dbFile: paths.dbFile,
      dbDir: paths.dbDir,
      logsDir: paths.logsDir,
      cacheDir: paths.cacheDir,
      printerDir: paths.printerDir,
      printerTmp: paths.printerTmp,
      printerOk: paths.printerOk,
      printerErr: paths.printerErr,
      printerTemplates: paths.printerTemplates,
      cacheAi: paths.cacheAi,
    };
  });

  ipcMain.handle('app:getAppInfo', () => {
    return {
      version: '1.0.0',
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      dataRoot: paths.root,
    };
  });

  // ============ IMPRESSION (Job Queue) ============
  ipcMain.handle('printer:enqueueJob', async (event, payload) => {
    try {
      const { enqueuePrintJob } = await import('../src/main/printJobQueue.js');
      const result = enqueuePrintJob(payload);
      return { success: true, ...result };
    } catch (err) {
      console.error('Erreur enqueue job:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:getPendingJobs', async () => {
    try {
      const { getPendingJobs } = await import('../src/main/printJobQueue.js');
      return { success: true, jobs: getPendingJobs() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:markJobOk', async (event, { id, result }) => {
    try {
      const { markJobOk } = await import('../src/main/printJobQueue.js');
      markJobOk(id, result);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:markJobErr', async (event, { id, error }) => {
    try {
      const { markJobErr } = await import('../src/main/printJobQueue.js');
      markJobErr(id, error);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ============ TEMPLATES ============
  ipcMain.handle('template:list', async () => {
    try {
      const { templateManager } = await import('../src/main/templateManager.js');
      if (!templateManager) {
        return { success: false, error: 'Template manager not initialized' };
      }
      return { success: true, templates: templateManager.listTemplates() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('template:load', async (event, templateName) => {
    try {
      const { templateManager } = await import('../src/main/templateManager.js');
      const content = templateManager.loadTemplate(templateName);
      return { success: true, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('template:save', async (event, { name, content }) => {
    try {
      const { templateManager } = await import('../src/main/templateManager.js');
      templateManager.saveTemplate(name, content);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('template:delete', async (event, templateName) => {
    try {
      const { templateManager } = await import('../src/main/templateManager.js');
      templateManager.deleteTemplate(templateName);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('template:resetToDefaults', async () => {
    try {
      const { templateManager } = await import('../src/main/templateManager.js');
      templateManager.resetToDefaults();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ============ LOGS ============
  ipcMain.handle('logs:getPaths', () => {
    return {
      mainLog: `${paths.logsDir}/main.log`,
      backendLog: `${paths.logsDir}/backend.log`,
      printLog: `${paths.logsDir}/print.log`,
      aiLog: `${paths.logsDir}/ai.log`,
    };
  });

  console.log('✓ IPC handlers initialisés');
}

module.exports = { initializeIpcHandlers };
