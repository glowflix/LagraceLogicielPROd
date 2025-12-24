const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

let serverProcess = null;
let mainWindow = null;
const PORT = process.env.PORT || 3030;
const SERVER_URL = `http://localhost:${PORT}`;

/**
 * Démarrer le serveur Node.js
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '../src/api/server.js');
    
    // Vérifier si le fichier existe
    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Serveur non trouvé: ${serverPath}`));
      return;
    }

    // Lancer le serveur Node.js
    serverProcess = spawn('node', [serverPath], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: PORT.toString(),
      },
    });

    let serverReady = false;

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[SERVER]', output);
      
      // Détecter quand le serveur est prêt
      if (!serverReady && (output.includes('Serveur démarré') || output.includes('listening'))) {
        serverReady = true;
        setTimeout(() => resolve(), 500); // Attendre un peu pour être sûr
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[SERVER ERROR]', data.toString());
    });

    serverProcess.on('error', (error) => {
      console.error('Erreur démarrage serveur:', error);
      reject(error);
    });

    serverProcess.on('exit', (code) => {
      console.log(`Serveur arrêté avec le code ${code}`);
      if (code !== null && code !== 0 && code !== 130) {
        // Relancer après 2 secondes si crash
        setTimeout(() => {
          console.log('Relance du serveur...');
          startServer().catch(console.error);
        }, 2000);
      }
    });

    // Timeout de sécurité
    setTimeout(() => {
      if (!serverReady) {
        console.warn('Timeout attente serveur, on continue quand même...');
        resolve();
      }
    }, 5000);
  });
}

/**
 * Vérifier si le serveur répond
 */
async function waitForServer(maxAttempts = 60) {
  const checkDevServer = process.env.NODE_ENV === 'development';
  const devServerUrl = 'http://localhost:5173';
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Vérifier le serveur backend
      await new Promise((resolve, reject) => {
        const req = http.get(`${SERVER_URL}/api/health`, (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            reject(new Error(`Status: ${res.statusCode}`));
          }
        });
        
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      
      // En mode dev, vérifier aussi Vite
      if (checkDevServer) {
        try {
          await new Promise((resolve, reject) => {
            const req = http.get(devServerUrl, (res) => {
              resolve(true);
            });
            req.on('error', reject);
            req.setTimeout(1000, () => {
              req.destroy();
              reject(new Error('Timeout'));
            });
          });
        } catch (error) {
          // Vite pas encore prêt, continuer à attendre
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
      }
      
      return true;
    } catch (error) {
      // Serveur pas encore prêt, continuer
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Créer la fenêtre principale
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    icon: path.join(__dirname, '../asset/image/icon/photo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
    },
    titleBarStyle: 'default',
    show: false, // Ne pas montrer avant que le serveur soit prêt
    backgroundColor: '#1a1a2e',
  });

  // Afficher la fenêtre quand elle est prête
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Focus sur la fenêtre
    if (process.platform === 'darwin') {
      app.dock.show();
    }
  });

  // Charger l'application une fois le serveur prêt
  waitForServer().then((serverReady) => {
    if (serverReady) {
      // En mode développement, utiliser Vite dev server
      if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
      } else {
        mainWindow.loadURL(SERVER_URL);
      }
    } else {
      const indexPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(indexPath)) {
        mainWindow.loadFile(indexPath);
      } else if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
      } else {
        mainWindow.loadURL(SERVER_URL);
      }
    }
  });

  // Ouvrir DevTools en mode développement
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Gestion des erreurs de chargement
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Erreur chargement:', errorCode, errorDescription);
    if (errorCode === -106 || errorCode === -105) {
      // ERR_INTERNET_DISCONNECTED ou ERR_ADDRESS_UNREACHABLE
      setTimeout(() => {
        mainWindow.reload();
      }, 2000);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Quand l'application est prête
 */
app.whenReady().then(async () => {
  try {
    // En mode développement, ne pas démarrer le serveur (déjà lancé par npm run dev)
    if (process.env.NODE_ENV === 'development') {
      console.log('Mode développement : utilisation du serveur externe');
      // Attendre que le serveur externe soit prêt
      await waitForServer();
      createWindow();
    } else {
      // En mode production, démarrer le serveur
      console.log('Démarrage du serveur...');
      await startServer();
      console.log('Serveur démarré, création de la fenêtre...');
      createWindow();
    }
  } catch (error) {
    console.error('Erreur lors du démarrage:', error);
    app.quit();
  }
});

// Quitter quand toutes les fenêtres sont fermées (sauf macOS)
app.on('window-all-closed', () => {
  // Arrêter le serveur seulement en mode production
  if (serverProcess && process.env.NODE_ENV !== 'development') {
    serverProcess.kill();
    serverProcess = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Réactiver la fenêtre sur macOS
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Arrêt propre de l'application
app.on('before-quit', () => {
  // Arrêter le serveur seulement en mode production
  if (serverProcess && process.env.NODE_ENV !== 'development') {
    console.log('Arrêt du serveur...');
    serverProcess.kill('SIGTERM');
    
    // Attendre un peu pour que le serveur se ferme proprement
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
      }
    }, 2000);
  }
});

// Gestion des erreurs non gérées
process.on('uncaughtException', (error) => {
  console.error('Erreur non gérée:', error);
});

