const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

let serverProcess = null;
let aiProcess = null;
let mainWindow = null;
const PORT = process.env.PORT || 3030;
const SERVER_URL = `http://localhost:${PORT}`;

// Configuration AI LaGrace
const AI_ENABLED = process.env.AI_LAGRACE_ENABLED !== 'false'; // Activé par défaut
const AI_DIR = path.join(__dirname, '..', 'ai-lagrace');
const AI_MAIN = path.join(AI_DIR, 'main.py');

/**
 * Vérifier si Python est disponible
 */
function checkPython() {
  return new Promise((resolve) => {
    const check = spawn('python', ['--version'], { shell: true });
    check.on('close', (code) => {
      resolve(code === 0);
    });
    check.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Démarrer AI LaGrace (Python)
 * L'AI reste active en permanence et ne se déconnecte pas automatiquement
 */
async function startAI() {
  if (!AI_ENABLED) {
    console.log('[AI] AI LaGrace désactivée par configuration');
    return;
  }

  if (!fs.existsSync(AI_MAIN)) {
    console.log('[AI] AI LaGrace non installée (main.py non trouvé)');
    console.log('[AI] Chemin attendu:', AI_MAIN);
    return;
  }

  const hasPython = await checkPython();
  if (!hasPython) {
    console.log('[AI] Python non disponible, AI LaGrace désactivée');
    console.log('[AI] Installez Python et ajoutez-le au PATH');
    return;
  }

  console.log('[AI] ========================================');
  console.log('[AI] DÉMARRAGE DE AI LaGrace...');
  console.log('[AI] Répertoire:', AI_DIR);
  console.log('[AI] Script:', AI_MAIN);
  console.log('[AI] ========================================');

  aiProcess = spawn('python', ['main.py', '--quiet'], {
    cwd: AI_DIR,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1', // Force Python à ne pas bufferer la sortie
      PYTHONIOENCODING: 'utf-8', // Encodage UTF-8 pour Windows
    },
  });

  aiProcess.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        // Afficher avec timestamp pour le debug
        const ts = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[${ts}] [AI] ${line}`);
      }
    });
  });

  aiProcess.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        const ts = new Date().toISOString().split('T')[1].split('.')[0];
        console.error(`[${ts}] [AI ERROR] ${line}`);
      }
    });
  });

  aiProcess.on('close', (code) => {
    console.log(`[AI] AI LaGrace arrêtée (code: ${code})`);
    
    // Si l'AI s'arrête de façon inattendue, la redémarrer (sauf si code 0 ou arrêt volontaire)
    if (code !== 0 && code !== null && aiProcess !== null) {
      console.log('[AI] Redémarrage automatique dans 5 secondes...');
      aiProcess = null;
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          startAI().catch((err) => {
            console.error('[AI] Erreur au redémarrage:', err);
          });
        }
      }, 5000);
    } else {
      aiProcess = null;
    }
  });

  aiProcess.on('error', (err) => {
    console.error('[AI] Erreur process:', err);
    aiProcess = null;
  });

  console.log('[AI] AI LaGrace démarrée avec PID:', aiProcess.pid);
  console.log('[AI] L\'AI va maintenant écouter et parler...');
}

/**
 * Arrêter AI LaGrace
 */
function stopAI() {
  if (aiProcess) {
    console.log('[AI] Arrêt de AI LaGrace...');
    
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', aiProcess.pid.toString(), '/f', '/t'], { shell: true });
    } else {
      aiProcess.kill('SIGTERM');
    }
    
    aiProcess = null;
  }
}

/**
 * Vérifier si le serveur est déjà en cours d'exécution
 */
function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/api/health`, { timeout: 1000 }, (res) => {
      resolve(true);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Démarrer le serveur Node.js
 */
function startServer() {
  return new Promise(async (resolve, reject) => {
    // Vérifier d'abord si le serveur est déjà en cours d'exécution
    const isRunning = await checkServerRunning();
    if (isRunning) {
      console.log('[SERVER] Serveur déjà en cours d\'exécution, réutilisation...');
      resolve();
      return;
    }

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
      
      // Détecter si le port est déjà utilisé
      if (output.includes('EADDRINUSE') || output.includes('port') && output.includes('déjà utilisé')) {
        console.log('[SERVER] Port déjà utilisé, attente que le serveur existant soit prêt...');
        // Attendre et réessayer de se connecter
        setTimeout(async () => {
          const running = await checkServerRunning();
          if (running) {
            resolve();
          } else {
            reject(new Error('Port déjà utilisé et serveur non accessible'));
          }
        }, 2000);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error('[SERVER ERROR]', output);
      
      // Si erreur de port déjà utilisé, attendre et vérifier
      if (output.includes('EADDRINUSE') || output.includes('port') && output.includes('déjà utilisé')) {
        console.log('[SERVER] Port déjà utilisé, attente que le serveur existant soit prêt...');
        setTimeout(async () => {
          const running = await checkServerRunning();
          if (running) {
            resolve();
          } else {
            reject(new Error('Port déjà utilisé et serveur non accessible'));
          }
        }, 2000);
      }
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
    show: true, // Afficher immédiatement (le serveur est déjà vérifié)
    backgroundColor: '#1a1a2e',
  });

  // Afficher la fenêtre immédiatement (le serveur est déjà prêt)
  mainWindow.show();
  
  // Focus sur la fenêtre
  if (process.platform === 'darwin') {
    app.dock.show();
  }

  // Charger l'application directement (le serveur est déjà vérifié avant createWindow)
  // En mode développement, utiliser Vite dev server
  if (process.env.NODE_ENV === 'development') {
    console.log('Chargement de http://localhost:5173...');
    mainWindow.loadURL('http://localhost:5173').catch((error) => {
      console.error('Erreur chargement Vite:', error);
      // Fallback vers le serveur backend
      mainWindow.loadURL(SERVER_URL);
    });
  } else {
    console.log(`Chargement de ${SERVER_URL}...`);
    mainWindow.loadURL(SERVER_URL).catch((error) => {
      console.error('Erreur chargement serveur:', error);
      // Fallback vers dist/index.html si disponible
      const indexPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(indexPath)) {
        mainWindow.loadFile(indexPath);
      }
    });
  }

  // Ouvrir DevTools en mode développement
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Gestion des erreurs de chargement
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`Erreur chargement (${errorCode}): ${errorDescription}`);
    console.error(`URL: ${validatedURL}`);
    
    if (errorCode === -106 || errorCode === -105 || errorCode === -102) {
      // ERR_INTERNET_DISCONNECTED, ERR_ADDRESS_UNREACHABLE, ERR_CONNECTION_REFUSED
      console.log('Tentative de rechargement dans 2 secondes...');
      setTimeout(() => {
        mainWindow.reload();
      }, 2000);
    } else {
      // Pour d'autres erreurs, réessayer avec l'autre URL
      console.log('Tentative avec URL alternative...');
      if (process.env.NODE_ENV === 'development' && validatedURL && validatedURL.includes('5173')) {
        setTimeout(() => {
          console.log('Chargement de l\'URL alternative:', SERVER_URL);
          mainWindow.loadURL(SERVER_URL);
        }, 2000);
      } else if (validatedURL && validatedURL.includes('3030')) {
        setTimeout(() => {
          console.log('Chargement de l\'URL alternative: http://localhost:5173');
          mainWindow.loadURL('http://localhost:5173');
        }, 2000);
      }
    }
  });
  
  // Log quand la page est chargée avec succès
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('✅ Page chargée avec succès');
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
      // Le script wait-and-launch-electron.js a déjà vérifié que les serveurs sont prêts
      // On peut créer la fenêtre immédiatement, mais on vérifie rapidement en arrière-plan
      createWindow();
      
      // Vérification rapide en arrière-plan (non bloquante)
      waitForServer(5).then((ready) => {
        if (!ready) {
          console.warn('⚠️ Les serveurs ne répondent pas encore, mais la fenêtre est créée');
        }
      }).catch(() => {
        // Ignorer les erreurs, la fenêtre est déjà créée
      });
    } else {
      // En mode production, démarrer le serveur
      console.log('Démarrage du serveur...');
      await startServer();
      console.log('Serveur démarré, création de la fenêtre...');
      createWindow();
    }
    
    // Démarrer AI LaGrace (après le serveur pour que Socket.IO soit prêt)
    setTimeout(() => {
      startAI().catch((err) => {
        console.error('[AI] Erreur démarrage:', err);
      });
    }, 2000);
    
  } catch (error) {
    console.error('Erreur lors du démarrage:', error);
    app.quit();
  }
});

// Quitter quand toutes les fenêtres sont fermées (sauf macOS)
app.on('window-all-closed', () => {
  // Arrêter AI LaGrace
  stopAI();
  
  // Arrêter le serveur quand toutes les fenêtres sont fermées
  if (serverProcess) {
    console.log('Fermeture de toutes les fenêtres, arrêt du serveur...');
    serverProcess.kill('SIGTERM');
    
    // Attendre un peu pour que le serveur se ferme proprement
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
        serverProcess = null;
      }
    }, 1000);
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

// Fonction pour arrêter proprement le serveur et l'AI
function stopServer() {
  // Arrêter AI LaGrace d'abord
  stopAI();
  
  if (serverProcess) {
    console.log('Arrêt du serveur...');
    serverProcess.kill('SIGTERM');
    
    // Attendre un peu pour que le serveur se ferme proprement
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
        serverProcess = null;
      }
    }, 2000);
  }
}

// Arrêt propre de l'application
app.on('before-quit', (event) => {
  // Arrêter le serveur quand l'application se ferme
  if (serverProcess) {
    event.preventDefault(); // Empêcher la fermeture immédiate
    stopServer();
    
    setTimeout(() => {
      app.exit(0); // Fermer l'application après l'arrêt du serveur
    }, 2000);
  }
});

// Gestion des signaux système pour arrêter proprement
process.on('SIGINT', () => {
  console.log('\nSignal SIGINT reçu, arrêt...');
  stopServer();
  setTimeout(() => {
    app.quit();
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', () => {
  console.log('\nSignal SIGTERM reçu, arrêt...');
  stopServer();
  setTimeout(() => {
    app.quit();
    process.exit(0);
  }, 2000);
});

// Arrêt propre à la fermeture du processus
process.on('exit', () => {
  stopAI();
  if (serverProcess) {
    serverProcess.kill('SIGKILL');
  }
});

// Gestion des erreurs non gérées
process.on('uncaughtException', (error) => {
  console.error('Erreur non gérée:', error);
});

