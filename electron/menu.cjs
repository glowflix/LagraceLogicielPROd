/**
 * Menu Electron - La Grâce Pro
 * Système de menu professionnel style Adobe
 */

const { Menu, BrowserWindow, shell, app } = require('electron');
const path = require('path');

/**
 * Créer le template du menu
 * @param {BrowserWindow} mainWindow - Fenêtre principale
 * @param {Object} options - Options de configuration
 */
function createMenuTemplate(mainWindow, options = {}) {
  const isMac = process.platform === 'darwin';
  const SERVER_URL = options.serverUrl || 'http://127.0.0.1:3030';

  const template = [
    // Menu Fichier
    {
      label: '📁 Fichier',
      submenu: [
        {
          label: '🖨️ Expo A4 - Tous les produits',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            openExportWindow(mainWindow, 'all', 'Tous les Produits');
          }
        },
        {
          label: '📦 Expo A4 - New Arrivage',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            openExportWindow(mainWindow, 'newarrivage', 'New Arrivage');
          }
        },
        { type: 'separator' },
        {
          label: '📦 Expo Carton A4',
          click: () => {
            openExportWindow(mainWindow, 'carton', 'Carton');
          }
        },
        {
          label: '📦 Expo A4 Produits Carton sans Stock',
          click: () => {
            openExportWindow(mainWindow, 'carton-no-stock', 'Carton Sans Stock');
          }
        },
        {
          label: '📦 Expo A4 Produits Carton avec Stock',
          click: () => {
            openExportWindow(mainWindow, 'carton-with-stock', 'Carton Avec Stock');
          }
        },
        { type: 'separator' },
        {
          label: '📊 Expo Milliers A4',
          click: () => {
            openExportWindow(mainWindow, 'millier', 'Milliers');
          }
        },
        {
          label: '🔢 Expo Pièce A4',
          click: () => {
            openExportWindow(mainWindow, 'piece', 'Pièce');
          }
        },
        { type: 'separator' },
        {
          label: '🧾 Exporter CSV',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu:export-csv');
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fermer' } : { role: 'quit', label: 'Quitter' }
      ]
    },

    // Menu Édition
    {
      label: '✏️ Édition',
      submenu: [
        { role: 'undo', label: 'Annuler', accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo', label: 'Rétablir', accelerator: 'CmdOrCtrl+Y' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper', accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', label: 'Copier', accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', label: 'Coller', accelerator: 'CmdOrCtrl+V' },
        { role: 'selectAll', label: 'Tout sélectionner', accelerator: 'CmdOrCtrl+A' }
      ]
    },

    // Menu Affichage
    {
      label: '👁️ Affichage',
      submenu: [
        { role: 'reload', label: 'Actualiser', accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload', label: 'Forcer actualiser', accelerator: 'CmdOrCtrl+Shift+R' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Zoom +' },
        { role: 'zoomOut', label: 'Zoom -' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran', accelerator: 'F11' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Outils développeur', accelerator: 'F12' }
      ]
    },

    // Menu Navigation
    {
      label: '🧭 Navigation',
      submenu: [
        {
          label: '🏠 Accueil',
          accelerator: 'CmdOrCtrl+1',
          click: () => navigateTo(mainWindow, '/')
        },
        {
          label: '💰 Ventes',
          accelerator: 'CmdOrCtrl+2',
          click: () => navigateTo(mainWindow, '/pos')
        },
        {
          label: '📦 Produits',
          accelerator: 'CmdOrCtrl+3',
          click: () => navigateTo(mainWindow, '/products')
        },
        {
          label: '💳 Dettes',
          accelerator: 'CmdOrCtrl+4',
          click: () => navigateTo(mainWindow, '/debts')
        },
        {
          label: '📊 Statistiques',
          accelerator: 'CmdOrCtrl+5',
          click: () => navigateTo(mainWindow, '/analytics')
        },
        {
          label: '📦 New Arrivage',
          accelerator: 'CmdOrCtrl+6',
          click: () => navigateTo(mainWindow, '/newarrivage')
        },
        { type: 'separator' },
        {
          label: '⚙️ Paramètres',
          accelerator: 'CmdOrCtrl+,',
          click: () => navigateTo(mainWindow, '/settings')
        }
      ]
    },

    // Menu Outils
    {
      label: '🔧 Outils',
      submenu: [
        {
          label: '🔄 Mise à jour',
          click: () => {
            shell.openExternal('https://glowflix.com/lagraceglow');
          }
        },
        {
          label: '🌐 Site Web',
          click: () => {
            shell.openExternal('https://glowflix.com/glo-eco');
          }
        },
        { type: 'separator' },
        {
          label: '☁️ Synchronisation',
          click: () => navigateTo(mainWindow, '/sync')
        },
        {
          label: '👥 Utilisateurs',
          click: () => navigateTo(mainWindow, '/users')
        }
      ]
    },

    // Menu Aide
    {
      label: '❓ Aide',
      submenu: [
        {
          label: '⌨️ Raccourcis clavier',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            openShortcutsWindow(mainWindow);
          }
        },
        { type: 'separator' },
        {
          label: 'ℹ️ À propos',
          click: () => {
            openAboutWindow(mainWindow);
          }
        }
      ]
    }
  ];

  return template;
}

/**
 * Ouvrir une fenêtre d'export A4
 */
function openExportWindow(mainWindow, type, title) {
  const exportWindow = new BrowserWindow({
    width: 900,
    height: 700,
    parent: mainWindow,
    modal: false,
    title: `Export A4 - ${title}`,
    icon: mainWindow?.icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f0f1a'
  });

  // Charger la page d'export avec le type en paramètre
  const SERVER_URL = 'http://127.0.0.1:3030';
  exportWindow.loadURL(`${SERVER_URL}/export-a4.html?type=${type}&title=${encodeURIComponent(title)}`);
  
  exportWindow.setMenuBarVisibility(false);
}

/**
 * Ouvrir la fenêtre des raccourcis
 */
function openShortcutsWindow(mainWindow) {
  const shortcutsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    parent: mainWindow,
    modal: true,
    title: 'Raccourcis Clavier - La Grâce Pro',
    icon: mainWindow?.icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f0f1a',
    resizable: false
  });

  shortcutsWindow.loadURL('http://127.0.0.1:3030/shortcuts.html');
  shortcutsWindow.setMenuBarVisibility(false);
}

/**
 * Ouvrir la fenêtre À propos
 */
function openAboutWindow(mainWindow) {
  const aboutWindow = new BrowserWindow({
    width: 500,
    height: 600,
    parent: mainWindow,
    modal: true,
    title: 'À propos - La Grâce Pro',
    icon: mainWindow?.icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f0f1a',
    resizable: false
  });

  aboutWindow.loadURL('http://127.0.0.1:3030/about.html');
  aboutWindow.setMenuBarVisibility(false);
}

/**
 * Naviguer vers une route de l'application
 */
function navigateTo(mainWindow, route) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('menu:navigate', route);
  }
}

/**
 * Configurer le menu de l'application
 * @param {BrowserWindow} mainWindow 
 */
function setupApplicationMenu(mainWindow) {
  const template = createMenuTemplate(mainWindow);
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = {
  setupApplicationMenu,
  createMenuTemplate,
  openExportWindow,
  openShortcutsWindow,
  openAboutWindow
};
