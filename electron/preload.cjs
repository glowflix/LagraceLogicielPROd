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
});
