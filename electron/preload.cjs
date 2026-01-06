const { contextBridge, ipcRenderer } = require('electron');

// Exposer une API sécurisée au processus de rendu
contextBridge.exposeInMainWorld('electronAPI', {
  // ============ APP INFO ============
  getPaths: () => ipcRenderer.invoke('app:getPaths'),
  getAppInfo: () => ipcRenderer.invoke('app:getAppInfo'),

  // ============ IA ============
  // Écouter les mises à jour de statut de l'IA
  onAIStatusUpdate: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('ai-status-update', handler);
    
    // Retourner une fonction pour se désabonner de l'événement
    return () => {
      ipcRenderer.removeListener('ai-status-update', handler);
    };
  },
  
  // Contrôler l'IA
  startAI: () => ipcRenderer.invoke('ai-start'),
  stopAI: () => ipcRenderer.invoke('ai-stop'),
  getAIStatus: () => ipcRenderer.invoke('ai-status'),

  // ============ IMPRESSION ============
  printer: {
    enqueueJob: (payload) => ipcRenderer.invoke('printer:enqueueJob', payload),
    getPendingJobs: () => ipcRenderer.invoke('printer:getPendingJobs'),
    markJobOk: (id, result) => ipcRenderer.invoke('printer:markJobOk', { id, result }),
    markJobErr: (id, error) => ipcRenderer.invoke('printer:markJobErr', { id, error }),
  },

  // ============ TEMPLATES ============
  template: {
    list: () => ipcRenderer.invoke('template:list'),
    load: (name) => ipcRenderer.invoke('template:load', name),
    save: (name, content) => ipcRenderer.invoke('template:save', { name, content }),
    delete: (name) => ipcRenderer.invoke('template:delete', name),
    resetToDefaults: () => ipcRenderer.invoke('template:resetToDefaults'),
  },

  // ============ LOGS ============
  logs: {
    getPaths: () => ipcRenderer.invoke('logs:getPaths'),
  },
  
  // ============ MENU NAVIGATION ============
  menu: {
    // Écouter les événements de navigation depuis le menu
    onNavigate: (callback) => {
      const handler = (event, route) => callback(route);
      ipcRenderer.on('menu:navigate', handler);
      return () => ipcRenderer.removeListener('menu:navigate', handler);
    },
    // Écouter la demande d'export CSV
    onExportCSV: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('menu:export-csv', handler);
      return () => ipcRenderer.removeListener('menu:export-csv', handler);
    },
  },
  
  // ============ RACCOURCIS CLAVIER ============
  shortcuts: {
    // Écouter les raccourcis globaux
    onShortcut: (callback) => {
      const handler = (event, shortcut) => callback(shortcut);
      ipcRenderer.on('shortcut:triggered', handler);
      return () => ipcRenderer.removeListener('shortcut:triggered', handler);
    },
  },
});
