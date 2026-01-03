const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { pathToFileURL } = require('url');

let backendHandle = null;
let aiProcess = null;
let mainWindow = null;

const PORT = Number(process.env.PORT || 3030);
const SERVER_URL = `http://localhost:${PORT}`;

// Configuration AI LaGrace
const AI_ENABLED = process.env.AI_LAGRACE_ENABLED !== 'false';
const AI_AUTOSTART = AI_ENABLED && process.env.AI_LAGRACE_AUTOSTART !== 'false';
const AI_DIR = path.join(__dirname, '..', 'ai-lagrace');
const AI_MAIN = path.join(AI_DIR, 'main.py');

/**
 * ✅ NOUVEAU: Démarrer le serveur Express IN-PROCESS (pas de spawn)
 */
async function startBackendInProcess() {
  if (backendHandle) return backendHandle;

  try {
    console.log('[BACKEND] Démarrage du serveur Express en in-process...');

    // Importer dynamiquement le serveur ESM
    const serverJs = path.join(app.getAppPath(), 'src', 'api', 'server.js');
    const staticDir = path.join(app.getAppPath(), 'dist', 'ui'); // ✅ dist/ui

    console.log(`[BACKEND] Server JS: ${serverJs}`);
    console.log(`[BACKEND] Static Dir: ${staticDir}`);

    const mod = await import(pathToFileURL(serverJs).href);

    // Appeler startBackend()
    backendHandle = await mod.startBackend({
      port: PORT,
      host: '0.0.0.0',        // ✅ Écouter sur LAN
      staticDir,              // ✅ Servir dist/ui
      isElectron: true,       // ✅ Coupe l'IA côté serveur
    });

    console.log('[BACKEND] ✅ Serveur Express prêt');
    return backendHandle;
  } catch (error) {
    console.error('[BACKEND] ❌ Erreur démarrage:', error);
    throw error;
  }
}

/**
 * Vérifier si Python (venv) est disponible
 */
function checkPython() {
  return new Promise((resolve) => {
    const pythonExe = process.platform === 'win32' 
      ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
      : path.join(__dirname, '..', '.venv', 'bin', 'python');
    
    // 1️⃣ Vérifier si le fichier existe
    if (!fs.existsSync(pythonExe)) {
      console.log(`[AI] Python non trouvé au chemin: ${pythonExe}`);
      resolve(false);
      return;
    }
    
    // 2️⃣ Le fichier existe, vérifier si c'est un fichier valide
    try {
      const stats = fs.statSync(pythonExe);
      if (stats.isFile()) {
        console.log(`[AI] Python trouvé: ${pythonExe} (${stats.size} bytes)`);
        // 3️⃣ Essayer de lancer Python pour une confirmation finale
        const check = spawn(pythonExe, ['--version'], { 
          shell: false,  // ❌ Changer à false pour éviter les problèmes avec les chemins avec espaces
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let output = '';
        check.stdout.on('data', (data) => {
          output += data.toString();
        });
        check.stderr.on('data', (data) => {
          output += data.toString();
        });
        
        const timeout = setTimeout(() => {
          check.kill();
          console.log(`[AI] Timeout lors de la vérification Python`);
          resolve(false);
        }, 5000);
        
        check.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            console.log(`[AI] Python fonctionne: ${output.trim()}`);
            resolve(true);
          } else {
            console.log(`[AI] Python existe mais sortie d'erreur: ${output}`);
            // Malgré l'erreur, le fichier existe, donc on considère que Python est disponible
            resolve(true);
          }
        });
        
        check.on('error', (err) => {
          clearTimeout(timeout);
          console.log(`[AI] Erreur spawn Python: ${err.message}`);
          // Le fichier existe, donc considérer que Python est disponible
          resolve(true);
        });
      } else {
        console.log(`[AI] ${pythonExe} n'est pas un fichier`);
        resolve(false);
      }
    } catch (e) {
      console.log(`[AI] Erreur vérification Python: ${e.message}`);
      resolve(false);
    }
  });
}

/**
 * Démarrer AI LaGrace (Python)
 * ⚠️ NE PAS relancer l'IA si elle est déjà lancée par npm run dev (concurrently)
 * L'IA reste active en permanence et ne se déconnecte pas automatiquement
 */
async function startAI() {
  if (!AI_ENABLED) {
    console.log('[AI] AI LaGrace désactivée par configuration');
    return;
  }
  
  // ✅ CORRECTION: NE PAS relancer l'IA si elle est déjà en cours d'exécution
  // En développement (npm run dev), concurrently lance DÉJÀ l'IA
  // Relancer ici causait deux instances parlant en même temps (doublons audio)
  
  if (!AI_AUTOSTART) {
    console.log('[AI] AI LaGrace gérée par le serveur (autostart désactivé)');
    return;
  }
  
  // ✅ CONTRÔLE: Vérifier si l'IA est DÉJÀ en cours d'exécution sur le port/socket
  const checkAIRunning = new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/api/ai/status`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.running === true);
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });

  try {
    const aiIsRunning = await checkAIRunning;
    if (aiIsRunning) {
      console.log('[AI] ========================================');
      console.log('[AI] ℹ️  AI LAGRACE DÉJÀ EN COURS D\'EXÉCUTION');
      console.log('[AI] ========================================');
      console.log('[AI] Une instance de l\'IA est déjà active (lancée par concurrently)');
      console.log('[AI] Pas besoin de la relancer via Electron');
      sendAIStatus('connected', 'IA en cours d\'exécution (serveur)');
      return;
    }
  } catch (e) {
    // Pas de réponse du serveur - continuer avec le démarrage local
    console.log('[AI] Vérification du statut AI impossible, tentative de démarrage...');
  }

  console.log('[AI] ========================================');
  console.log('[AI] DÉMARRAGE DE AI LaGrace...');
  console.log('[AI] Mode:', app.isPackaged ? 'PRODUCTION (exe)' : 'DÉVELOPPEMENT (python)');
  console.log('[AI] ========================================');

  sendAIStatus('reconnecting', 'Démarrage de l\'IA...');

  // ✅ PRODUCTION vs DÉVELOPPEMENT: Déterminer quel exécutable utiliser
  const isProd = app.isPackaged;
  let aiCmd, aiArgs, aiCwd;

  if (isProd) {
    // ✅ PRODUCTION: Utiliser l'exe compilé PyInstaller embarqué dans les ressources
    aiCmd = path.join(process.resourcesPath, 'ai', 'ai-lagrace.exe');
    aiArgs = ['--quiet'];
    aiCwd = path.dirname(aiCmd);
    
    console.log('[AI] 🔨 Mode PRODUCTION - AI exe embarquée');
    console.log('[AI] Chemin exe:', aiCmd);
    
    if (!fs.existsSync(aiCmd)) {
      console.log('[AI] ❌ ERREUR: ai-lagrace.exe non trouvée!');
      console.log('[AI] Chemin attendu:', aiCmd);
      sendAIStatus('disconnected', 'AI exe manquante');
      return;
    }
  } else {
    // ✅ DÉVELOPPEMENT: Utiliser Python + main.py depuis le répertoire ai-lagrace
    const pythonExe = process.platform === 'win32' 
      ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
      : path.join(__dirname, '..', '.venv', 'bin', 'python');
    
    aiCmd = pythonExe;
    aiArgs = ['main.py', '--quiet'];
    aiCwd = AI_DIR;
    
    console.log('[AI] 🐍 Mode DÉVELOPPEMENT - Python + main.py');
    console.log('[AI] Python exe:', pythonExe);
    console.log('[AI] Répertoire:', AI_DIR);
    
    const hasPython = await checkPython();
    if (!hasPython) {
      console.log('[AI] ❌ ERREUR: Python non disponible');
      console.log('[AI] Installez Python et activez le venv');
      sendAIStatus('disconnected', 'Python non disponible');
      return;
    }

    if (!fs.existsSync(AI_MAIN)) {
      console.log('[AI] ❌ ERREUR: main.py non trouvée');
      console.log('[AI] Chemin attendu:', AI_MAIN);
      sendAIStatus('disconnected', 'AI main.py non trouvée');
      return;
    }
  }

  console.log('[AI] Commande:', aiCmd);
  console.log('[AI] Arguments:', aiArgs);
  console.log('[AI] Répertoire travail:', aiCwd);

  aiProcess = spawn(aiCmd, aiArgs, {
    cwd: aiCwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });

  aiProcess.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        // Afficher avec timestamp pour le debug
        const ts = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[${ts}] [AI] ${line}`);
        // Si l'IA est prête, envoyer le statut
        if (line.includes('AI LaGrace PRÊTE')) {
          sendAIStatus('connected', 'IA connectée et prête.');
        }
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
    sendAIStatus('disconnected', `IA déconnectée (code: ${code})`);
    
    // Si l'AI s'arrête de façon inattendue, la redémarrer (sauf si code 0 ou arrêt volontaire)
    if (code !== 0 && code !== null && aiProcess !== null) {
      console.log('[AI] Redémarrage automatique dans 5 secondes...');
      sendAIStatus('reconnecting', 'Tentative de redémarrage de l\'IA...');
      aiProcess = null;
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          startAI().catch((err) => {
            console.error('[AI] Erreur au redémarrage:', err);
            sendAIStatus('disconnected', 'Échec du redémarrage de l\'IA.');
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
      console.log('[SERVER] ✅ Serveur déjà en cours d\'exécution, réutilisation...');
      return resolve();
    }

    // Mode développement: serveur lancé par npm run dev (concurrently)
    if (process.env.SKIP_BACKEND_WAIT === 'true') {
      console.log('[SERVER] Mode dev: serveur Node.js lancé par npm, attente 2s...');
      setTimeout(() => resolve(), 2000);
      return;
    }

    // ✅ CORRECTION PROD: Chemins valides pour app.asar + process.resourcesPath
    // En production packée: 
    //   process.resourcesPath = base du bundle (contient app.asar)
    //   process.execPath = electron.exe
    // ✅ Spawn server-entry.cjs (CJS) qui boot server.js (ESM) proprement
    const serverPath = path.join(process.resourcesPath, 'app.asar', 'src', 'api', 'server-entry.cjs');
    const realCwd = process.resourcesPath; // ✅ cwd réel (pas app.asar qui n'est pas un dossier)
    const isWin = process.platform === 'win32';

    console.log('[SERVER] Chemin serveur entry:', serverPath);
    console.log('[SERVER] CWD:', realCwd);

    if (!fs.existsSync(serverPath)) {
      console.warn(`[SERVER] ⚠️ Serveur entry non trouvé: ${serverPath}`);
      console.warn('[SERVER] Continuant sans serveur...');
      return resolve(); // Continue quand même - l'UI peut marcher en offline
    }

    console.log('[SERVER] 🚀 Démarrage du serveur...');
    let serverReady = false; // ✅ UNE SEULE DÉCLARATION

    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: realCwd,
      shell: isWin, // ✅ Sur Windows, ça évite les soucis de spawn avec chemins espaces
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: String(PORT),
        AI_LAGRACE_AUTOSTART: 'false',
        // ✅ CRITIQUE: Dire au serveur où est dist/ (dans app.asar)
        APP_ROOT: app.getAppPath(), // ex: ...\resources\app.asar
        // ✅ CRITIQUE: racine data/db stable
        GLOWFLIX_ROOT_DIR: process.env.GLOWFLIX_ROOT_DIR || '',
        LAGRACE_DATA_DIR: process.env.LAGRACE_DATA_DIR || '',
      },
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[SERVER]', output);

      if (!serverReady && (output.includes('Serveur démarré') || output.includes('listening'))) {
        serverReady = true;
        console.log('[SERVER] ✅ Serveur prêt');
        setTimeout(resolve, 300);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error('[SERVER ERROR]', output);
    });

    serverProcess.on('error', (err) => {
      console.error('[SERVER] ❌ Erreur spawn:', err.message);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`[SERVER] Processus fermé code=${code}`);
    });

    // Timeout de sécurité
    setTimeout(() => {
      if (!serverReady) {
        console.warn('[SERVER] ⏱️ Timeout attente serveur (8s), continuant quand même...');
        resolve();
      }
    }, 8000);
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
  try {
    console.log('[WINDOW] Création de la fenêtre BrowserWindow...');
    
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      icon: path.join(__dirname, '../asset/image/icon/photo.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        webSecurity: true,
      },
      titleBarStyle: 'default',
      show: false, // ✅ Ne pas montrer immédiatement pour éviter les problèmes
      backgroundColor: '#1a1a2e',
    });

    console.log('[WINDOW] BrowserWindow créée avec succès, ID:', mainWindow.id);
    
    // Afficher la fenêtre après un court délai (évite les crashes au démarrage)
    mainWindow.once('ready-to-show', () => {
      console.log('[WINDOW] Fenêtre ready-to-show');
      mainWindow.show();
    });
    
    // Fallback: afficher après 1 seconde si ready-to-show ne se déclenche pas
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[WINDOW] Affichage forcé de la fenêtre (fallback)');
        mainWindow.show();
      }
    }, 1000);
    
    // Focus sur la fenêtre
    if (process.platform === 'darwin') {
      app.dock.show();
    }

    // Charger l'application directement (le serveur est déjà vérifié avant createWindow)
    // En mode développement, utiliser Vite dev server
    if (process.env.NODE_ENV === 'development') {
      console.log('[WINDOW] Mode dev: Chargement de http://localhost:5173...');
      mainWindow.loadURL('http://localhost:5173').catch((error) => {
        console.error('[WINDOW] ❌ Erreur chargement Vite:', error);
        // Fallback vers le serveur backend
        console.log('[WINDOW] Fallback: Chargement de ' + SERVER_URL);
        mainWindow.loadURL(SERVER_URL);
      });
    } else {
      // ✅ PROD: Charger le build Vite local (plus robuste que le serveur HTTP)
      const indexPath = path.join(app.getAppPath(), 'dist', 'ui', 'index.html'); // ✅ dist/ui/ au lieu de dist/

      console.log('[WINDOW] Mode prod: Chargement du fichier:', indexPath);

      if (fs.existsSync(indexPath)) {
        mainWindow.loadFile(indexPath).catch((error) => {
          console.error('[WINDOW] ❌ Erreur loadFile:', error);
          // Fallback vers le serveur si loadFile échoue
          console.log('[WINDOW] Fallback: Chargement de ' + SERVER_URL);
          mainWindow.loadURL(SERVER_URL).catch(console.error);
        });
      } else {
        console.error('[WINDOW] ❌ dist/index.html introuvable en prod');
        console.log('[WINDOW] Fallback: Chargement de ' + SERVER_URL);
        mainWindow.loadURL(SERVER_URL).catch(console.error);
      }
    }

    // Ouvrir DevTools en mode développement
    if (process.env.NODE_ENV === 'development') {
      console.log('[WINDOW] Ouverture des DevTools');
      mainWindow.webContents.openDevTools();
    }

    // Gestion des erreurs de chargement
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[WINDOW] ❌ Erreur chargement (${errorCode}): ${errorDescription}`);
      console.error(`[WINDOW] URL: ${validatedURL}`);
      
      if (errorCode === -106 || errorCode === -105 || errorCode === -102) {
        // ERR_INTERNET_DISCONNECTED, ERR_ADDRESS_UNREACHABLE, ERR_CONNECTION_REFUSED
        console.log('[WINDOW] Tentative de rechargement dans 2 secondes...');
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
          }
        }, 2000);
      } else {
        // Pour d'autres erreurs, réessayer avec l'autre URL
        console.log('[WINDOW] Tentative avec URL alternative...');
        if (process.env.NODE_ENV === 'development' && validatedURL && validatedURL.includes('5173')) {
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('[WINDOW] Chargement de l\'URL alternative:', SERVER_URL);
              mainWindow.loadURL(SERVER_URL);
            }
          }, 2000);
        } else if (validatedURL && validatedURL.includes('3030')) {
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('[WINDOW] Chargement de l\'URL alternative: http://localhost:5173');
              mainWindow.loadURL('http://localhost:5173');
            }
          }, 2000);
        }
      }
    });
    
    // Log quand la page est chargée avec succès
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[WINDOW] ✅ Page chargée avec succès');
    });

    mainWindow.on('closed', () => {
      console.log('[WINDOW] Fenêtre fermée');
      mainWindow = null;
    });
    
    console.log('[WINDOW] ✅ Création de fenêtre complétée');
    
  } catch (error) {
    console.error('[WINDOW] ❌ ERREUR CRITIQUE création fenêtre:', error);
    console.error('[WINDOW] Stack:', error.stack);
    throw error;
  }
}

/**
 * Quand l'application est prête
 */
app.whenReady().then(async () => {
  try {
    // ✅ IMPORTANT: Initialiser global.__ELECTRON_APP__ pour que paths.js puisse accéder à userData
    global.__ELECTRON_APP__ = app;
    
    // ✅ IMPORTANT: Définir la racine data AVANT initializeApp()
    // En PROD: AppData\Roaming (permissions OK sur tous les PC)
    // En DEV: C:\Glowflixprojet (pour dev/test)
    const defaultDevRoot = 'C:\\Glowflixprojet';
    const defaultProdRoot = path.join(app.getPath('appData'), 'Glowflixprojet');
    // exemple prod: C:\Users\<User>\AppData\Roaming\Glowflixprojet
    
    const dataRoot = process.env.GLOWFLIX_ROOT_DIR
      ? path.resolve(process.env.GLOWFLIX_ROOT_DIR)
      : (app.isPackaged ? defaultProdRoot : defaultDevRoot);
    
    process.env.GLOWFLIX_ROOT_DIR = dataRoot;
    process.env.LAGRACE_DATA_DIR = dataRoot;
    
    console.log('📁 DataRoot:', dataRoot);
    
    // Initialiser l'app (chemins, db, loggers, etc.)
    console.log('🚀 Initialisation Glowflixprojet...');
    const initBridge = require('./init-bridge.cjs');
    appContext = await initBridge.initializeApp();
    console.log('✓ Glowflixprojet contexte prêt');
    
    // Initialiser les handlers IPC
    const { initializeIpcHandlers } = require('./ipc-handlers.cjs');
    initializeIpcHandlers(appContext);
    
    // En mode développement, ne pas démarrer le serveur (déjà lancé par npm run dev)
    if (process.env.NODE_ENV === 'development') {
      console.log('Mode développement : utilisation du serveur externe');
      // Le script wait-and-launch-electron.js a déjà vérifié que les serveurs sont prêts
      // On peut créer la fenêtre immédiatement, mais on vérifie rapidement en arrière-plan
      
      // ✅ IMPORTANT: Créer la fenêtre SYNCHRONE (très rapide) pour éviter que Electron ne quitte
      try {
        createWindow();
        console.log('✅ Fenêtre créée avec succès');
      } catch (windowError) {
        console.error('❌ Erreur création fenêtre:', windowError);
        mainWindow = null;
      }
      
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
      
      try {
        createWindow();
        console.log('✅ Fenêtre créée avec succès');
      } catch (windowError) {
        console.error('❌ Erreur création fenêtre:', windowError);
        mainWindow = null;
      }
    }
    
    // ✅ IMPORTANT: Garder Electron ouvert même si la création de fenêtre échoue
    if (!mainWindow) {
      console.warn('⚠️  Avertissement: pas de fenêtre principale, l\'app resta active');
    }
    
    // Démarrer AI LaGrace dès que le serveur est prêt (pas de délai fixe)
    startAI().catch((err) => {
      console.error('[AI] Erreur démarrage:', err);
    });
    
  } catch (error) {
    console.error('❌ ERREUR CRITIQUE lors du démarrage:', error);
    console.error('Stack:', error.stack);
    
    // ✅ IMPORTANT: NE PAS quitter immédiatement si possible
    // Essayer de créer une fenêtre vide pour montrer l'erreur
    try {
      createWindow();
      if (mainWindow) {
        mainWindow.webContents.on('did-finish-load', () => {
          mainWindow.webContents.executeJavaScript(`
            document.body.innerHTML = '<h1 style="color:red; font-family:monospace;">❌ ERREUR DE DÉMARRAGE</h1>' +
            '<pre style="color:#ccc; font-family:monospace; margin:20px; white-space:pre-wrap; word-wrap:break-word;">${error.message}</pre>';
          `);
        });
        mainWindow.loadURL('data:text/html,<h1>❌ Erreur de démarrage</h1>');
      }
    } catch (e) {
      console.error('Impossible de créer une fenêtre d\'erreur:', e);
      // Seulement quitter si vraiment impossible de continuer
      process.exit(1);
    }
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

// Gestion des contrôles IA depuis l'interface
ipcMain.handle('ai-start', async () => {
  try {
    await startAI();
    return { success: true };
  } catch (error) {
    console.error('[IPC] Erreur démarrage IA:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ai-stop', () => {
  try {
    stopAI();
    return { success: true };
  } catch (error) {
    console.error('[IPC] Erreur arrêt IA:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ai-status', () => {
  return {
    running: aiProcess !== null,
    pid: aiProcess ? aiProcess.pid : null
  };
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
app.on('before-quit', async (event) => {
  // Arrêter le serveur quand l'application se ferme
  if (serverProcess) {
    event.preventDefault(); // Empêcher la fermeture immédiate
    stopServer();
    
    // Shutdown app (DB, loggers, etc.)
    if (appContext) {
      const initBridge = require('./init-bridge.cjs');
      await initBridge.shutdownApp();
    }
    
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
