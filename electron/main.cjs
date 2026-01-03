const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');

/**
 * ✅ LOGGING FICHIER CRITIQUE
 * Écrit les logs IMPORTANTS dans un fichier pour diagnostic EXE
 * (ne pas se fier aux DevTools fermées en production)
 */
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const MAIN_LOG = path.join(LOG_DIR, 'main.log');

function logToFile(...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack}`;
    if (typeof a === 'object') return JSON.stringify(a);
    return String(a);
  }).join(' ');
  fs.appendFileSync(MAIN_LOG, `[${ts}] ${msg}\n`);
}

// Double log: console + fichier pour les events critiques
function logCritical(...args) {
  console.log('[CRITICAL]', ...args);
  logToFile('[CRITICAL]', ...args);
}

// Gérer les erreurs non capturées - TRÈS IMPORTANT en EXE
process.on('uncaughtException', (error) => {
  logCritical('🔴 UNCAUGHT EXCEPTION:', error.message);
  if (error.stack) logToFile(error.stack);
  console.error('🔴 UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logCritical('🔴 UNHANDLED REJECTION:', reason?.message || reason);
  if (reason?.stack) logToFile(reason.stack);
  console.error('🔴 UNHANDLED REJECTION:', reason);
});

/**
 * ✅ HELPERS DE RÉSOLUTION DE CHEMINS ROBUSTES
 * Évite les erreurs "resources/app.asar/resources" en prod
 */
function resolveResourcesRoot() {
  const env = (process.env.RESOURCES_ROOT || '').trim();
  if (env) return env;

  // En prod, c'est la valeur la plus fiable
  if (process.resourcesPath && String(process.resourcesPath).trim()) {
    return process.resourcesPath;
  }

  // Fallback sûr: parent de app.asar
  return path.dirname(app.getAppPath());
}

function resolveAppRoot() {
  // APP_ROOT = app.asar (ou project root en dev)
  const env = (process.env.APP_ROOT || '').trim();
  if (env) return env;
  return app.getAppPath();
}

let serverProcess = null;
let aiProcess = null;
let mainWindow = null;
let appContext = null; // Contexte app (paths, db, etc.)

/**
 * Envoyer un statut de l'IA à la fenêtre principale
 */
function sendAIStatus(status, message = '') {
  if (mainWindow && mainWindow.webContents) {
    console.log(`[IPC] Envoi du statut AI: ${status}`);
    mainWindow.webContents.send('ai-status-update', { status, message });
  }
}
const PORT = process.env.PORT || 3030;
const HOST = '127.0.0.1';  // ✅ Utiliser IPv4 explicite pour éviter les problèmes IPv6
const SERVER_URL = `http://${HOST}:${PORT}`;

// Configuration AI LaGrace
const AI_ENABLED = process.env.AI_LAGRACE_ENABLED !== 'false'; // Activé par défaut
// ✅ AI_AUTOSTART désactivé en production: l'IA est gérée par le serveur Node.js
// En dev (npm run dev), le serveur AI est lancé par concurrently
// En production (EXE), Python n'existe pas, donc on laisse le serveur Node.js faire
const AI_AUTOSTART = !app.isPackaged && AI_ENABLED && process.env.AI_LAGRACE_AUTOSTART !== 'false';

// ✅ CHEMIN AI: En prod, l'AI est dans resources/ai (extraResources). En dev, elle est en racine.
const AI_DIR = app.isPackaged 
  ? path.join(process.resourcesPath, 'ai')      // Production: resources/ai
  : path.join(__dirname, '..', 'ai-lagrace');    // Dev: racine/ai-lagrace

const AI_MAIN = path.join(AI_DIR, 'main.py');

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
    const req = http.get('http://localhost:3030/api/ai/status', { timeout: 2000 }, (res) => {
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

  if (!fs.existsSync(AI_MAIN)) {
    console.log('[AI] AI LaGrace non installée (main.py non trouvé)');
    console.log('[AI] Chemin attendu:', AI_MAIN);
    return;
  }

  const hasPython = await checkPython();
  if (!hasPython) {
    console.log('[AI] Python non disponible, AI LaGrace désactivée');
    const pythonExe = process.platform === 'win32' 
      ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
      : path.join(__dirname, '..', '.venv', 'bin', 'python');
    console.log('[AI] Chemin attendu:', pythonExe);
    console.log('[AI] Existe?:', fs.existsSync(pythonExe));
    console.log('[AI] Installez Python et ajoutez-le au PATH');
    return;
  }

  // ⚠️ DERNIÈRE TENTATIVE: Vérifier s'il y a déjà une instance Python de main.py
  try {
    const { exec } = require('child_process');
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'tasklist /FI "IMAGENAME eq python.exe"' : 'pgrep python';
    
    // Pour Windows, on ne peut pas vérifier facilement, donc on continue
    console.log('[AI] ⚠️  Vérification de l\'unicité de l\'instance...');
  } catch (e) {
    // Continue
  }

  console.log('[AI] ========================================');
  console.log('[AI] DÉMARRAGE DE AI LaGrace (Electron)...');
  console.log('[AI] Répertoire:', AI_DIR);
  console.log('[AI] Script:', AI_MAIN);
  console.log('[AI] ========================================');

  sendAIStatus('reconnecting', 'Démarrage de l\'IA...');

  // ✅ CORRECTION: Utiliser le venv Python au lieu du Python système
  // Cela garantit que les bonnes dépendances sont utilisées (Socket.IO, TTS, etc.)
  const pythonExe = process.platform === 'win32' 
    ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', '.venv', 'bin', 'python');
  
  console.log('[AI] Python exécutable:', pythonExe);

  // ⚠️ FIX: Quoter le répertoire si elle contient des espaces
  const quotedAIDir = AI_DIR.includes(' ') ? `"${AI_DIR}"` : AI_DIR;

  aiProcess = spawn(pythonExe, ['main.py', '--quiet'], {
    cwd: AI_DIR,  // Non quoté pour Node.js
    shell: false,  // ❌ shell: true cause le problème avec les espaces
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
 * ✅ ROBUSTE: Démarrer le backend IN-PROCESS (importation directe du module ESM)
 * Zéro spawn, zéro chemins virtuels app.asar
 */
let backendHandle = null;

async function startBackendInProcess() {
  if (backendHandle) {
    console.log('[BACKEND-IN-PROCESS] Backend déjà en mémoire, réutilisation');
    return backendHandle;
  }

  try {
    console.log('[BACKEND-IN-PROCESS] Démarrage du backend IN-PROCESS...');

    const appRoot = resolveAppRoot();
    const resourcesRoot = resolveResourcesRoot();

    // ✅ CRITIQUE: Code backend (server.js) = APP_ROOT (app.asar en prod, project root en dev)
    // ✅ CRITIQUE: Assets (UI, config) = RESOURCES_ROOT (resources en prod)
    // ⚠️ NE PAS chercher server.js dans resourcesRoot!
    const serverJs = path.join(appRoot, 'src', 'api', 'server.js');
    const staticDir = path.join(resourcesRoot, 'ui');
    const srcPkg = path.join(appRoot, 'src', 'package.json');
    
    console.log(`[BACKEND-IN-PROCESS] APP_ROOT = ${appRoot}`);
    console.log(`[BACKEND-IN-PROCESS] RESOURCES_ROOT = ${resourcesRoot}`);

    console.log(`[BACKEND-IN-PROCESS] Mode: ${app.isPackaged ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`[BACKEND-IN-PROCESS] RESOURCES_ROOT: ${resourcesRoot}`);
    console.log(`[BACKEND-IN-PROCESS] Server JS: ${serverJs}`);
    console.log(`[BACKEND-IN-PROCESS] Static Dir: ${staticDir}`);

    if (!fs.existsSync(serverJs)) throw new Error(`server.js introuvable: ${serverJs}`);
    if (!fs.existsSync(staticDir)) console.warn(`[BACKEND-IN-PROCESS] ⚠️ UI introuvable: ${staticDir}`);
    if (!fs.existsSync(srcPkg)) {
      console.warn(`[BACKEND-IN-PROCESS] ⚠️ src/package.json manquant -> risque ESM: ${srcPkg}`);
      console.warn(`[BACKEND-IN-PROCESS] 💡 Recommandation: ajouter src/package.json { "type":"module" } ou renommer server.js en server.mjs`);
    }

    // ✅ CRITIQUE: Définir le flag Electron AVANT l'import pour que server.js
    // détecte isElectronRuntime() correctement au niveau module
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.env.LAGRACE_IS_ELECTRON = '1';
    process.env.AI_LAGRACE_AUTOSTART = 'false'; // Electron gère l'IA via concurrently en dev, ou pas du tout en prod

    const mod = await import(pathToFileURL(serverJs).href);
    if (!mod.startBackend) throw new Error(`server.js n'exporte pas startBackend()`);

    backendHandle = await mod.startBackend({
      port: Number(PORT),
      host: HOST,
      staticDir,
      isElectron: true,
      appRoot,
      resourcesPath: resourcesRoot,
    });

    console.log('[BACKEND-IN-PROCESS] ✅ Backend démarré avec succès');
    return backendHandle;
  } catch (error) {
    console.error('[BACKEND-IN-PROCESS] ❌ Erreur:', error.message);
    if (error.stack) {
      console.error('[BACKEND-IN-PROCESS] ❌ Stack:\n', error.stack);
    }
    backendHandle = null;
    throw error;
  }
}

/**
 * Obtenir le chemin du serveur backend en fonction du mode (dev ou production)
 * ✅ En production EXE: utilise server-entry.cjs (wrapper ESM)
 * ✅ En dev: utilise server.js directement
 */
function getBackendEntry() {
  if (!app.isPackaged) {
    // Mode DEV: server.js directement
    return path.join(__dirname, '../src/api/server.js');
  }

  // Mode PROD (EXE): chercher server-entry.cjs d'abord (wrapper robuste)
  const resourcesRoot = resolveResourcesRoot();
  const appRoot = resolveAppRoot();

  const wrapperPath = path.join(appRoot, 'src', 'api', 'server-entry.cjs');
  const serverPath = path.join(appRoot, 'src', 'api', 'server.js');

  if (fs.existsSync(wrapperPath)) {
    console.log('[BACKEND] ✅ Utilisation server-entry.cjs (wrapper ESM → CommonJS)');
    return wrapperPath;
  }
  
  if (fs.existsSync(serverPath)) {
    console.log('[BACKEND] ⚠️  server-entry.cjs manquant, fallback sur server.js');
    return serverPath;
  }

  // Aucun fichier trouvé
  console.log('[BACKEND] ❌ Recherche des fichiers:');
  console.log(`[BACKEND]   - Wrapper: ${wrapperPath} (existe: ${fs.existsSync(wrapperPath)})`);
  console.log(`[BACKEND]   - Server: ${serverPath} (existe: ${fs.existsSync(serverPath)})`);
  return wrapperPath; // pour message d'erreur clair après
}

/**
 * Démarrer le serveur Node.js avec Electron en mode Node
 */
function startServer() {
  return new Promise(async (resolve, reject) => {
    // Mode développement: serveur lancé par npm run dev (concurrently)
    if (process.env.SKIP_BACKEND_WAIT === 'true') {
      console.log('[SERVER] Mode dev: serveur Node.js lancé par npm, attente 2s...');
      setTimeout(() => resolve(), 2000);
      return;
    }

    // Vérifier d'abord si le serveur est déjà en cours d'exécution
    const isRunning = await checkServerRunning();
    if (isRunning) {
      console.log('[SERVER] Serveur déjà en cours d\'exécution, réutilisation...');
      resolve();
      return;
    }

    const serverPath = getBackendEntry();
    
    // Vérifier si le fichier existe
    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Serveur introuvable: ${serverPath}`));
      return;
    }

    console.log('[SERVER] Lancement du serveur via Electron (ELECTRON_RUN_AS_NODE)...');
    console.log('[SERVER] Chemin serveur:', serverPath);

    // ✅ CORRECTION: Utiliser path.dirname(serverPath) pour le cwd
    // Cela garantit que les chemins relatifs (dotenv, fichiers config, etc.) fonctionnent
    const cwd = path.dirname(serverPath);

    // Lancer le serveur avec Electron en mode Node (pas de spawn('node'))
    serverProcess = spawn(process.execPath, [serverPath], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,  // ✅ false pour éviter les problèmes avec espaces
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: app.isPackaged ? 'production' : 'development',
        PORT: PORT.toString(),
        HOST: '127.0.0.1',
        APP_ROOT: resolveAppRoot(),
        RESOURCES_ROOT: resolveResourcesRoot(),
        LAGRACE_DATA_DIR: app.getPath('userData'),  // ✅ OBLIGATOIRE: dossier writable
        AI_LAGRACE_AUTOSTART: 'false',
      },
    });

    let serverReady = false;

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[SERVER]', output);
      
      // ✅ NE PAS faire resolve() ici - c'est un piège!
      // Les logs "Serveur démarré" ne garantissent pas que le serveur répond réellement à /api/health
      // On laisse waitForServer() tester la vraie disponibilité
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error('[SERVER ERROR]', output);
      
      // ✅ NE PAS faire resolve() sur les erreurs stderr non plus
      // Si le port est utilisé, waitForServer() va détecter que le serveur ne répond pas
    });

    serverProcess.on('error', (error) => {
      console.error('[SERVER ERROR] Erreur démarrage serveur:', error);
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

    // ✅ CRITIQUE: Attendre /api/health au lieu de resolve aveugles
    // Cela garantit que le backend est VRAIMENT prêt
    waitForServer(40).then(ok => {
      if (ok) {
        console.log('[SERVER] ✅ Backend prêt sur /api/health');
        resolve();
      } else {
        reject(new Error('Backend n\'a pas répondu sur /api/health après 20s'));
      }
    }).catch(reject);
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
      mainWindow.loadURL('http://127.0.0.1:5173').catch((error) => {
        console.error('[WINDOW] ❌ Erreur chargement Vite:', error);
        // Fallback vers le serveur backend
        console.log('[WINDOW] Fallback: Chargement de ' + SERVER_URL);
        mainWindow.loadURL(SERVER_URL);
      });
    } else {
      console.log('[WINDOW] Mode prod: Chargement de ' + SERVER_URL);
      mainWindow.loadURL(SERVER_URL).catch((error) => {
        console.error('[WINDOW] ❌ Erreur chargement serveur:', error);
        // Fallback vers UI en resources pour EXE
        const uiIndex = path.join(resolveResourcesRoot(), 'ui', 'index.html');
        if (fs.existsSync(uiIndex)) {
          console.log('[WINDOW] Fallback: loadFile UI:', uiIndex);
          mainWindow.loadFile(uiIndex);
        }
      });
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
              mainWindow.loadURL('http://127.0.0.1:5173');
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
    // 🔍 DIAGNOSTIC: Log très détaillé du démarrage
    console.log('\n');
    console.log('════════════════════════════════════════════════════════════════════');
    console.log('🚀 DÉMARRAGE DE LA GRACE POS');
    console.log('════════════════════════════════════════════════════════════════════');
    logCritical('🚀 DÉMARRAGE DE LA GRACE POS');
    
    console.log(`📅 Heure: ${new Date().toISOString()}`);
    console.log(`💻 Platform: ${process.platform}`);
    console.log(`📦 Version Electron: ${require('electron').app.getVersion()}`);
    console.log(`🔒 Mode: ${app.isPackaged ? 'PRODUCTION (packaged)' : 'DEVELOPMENT'}`);
    console.log(`📂 CWD: ${process.cwd()}`);
    console.log(`📂 __dirname: ${__dirname}`);
    console.log(`📂 app.getAppPath(): ${app.getAppPath()}`);
    console.log(`📂 process.resourcesPath: ${process.resourcesPath || '(undefined)'}`);
    console.log(`📄 Log file: ${MAIN_LOG}`);
    console.log('════════════════════════════════════════════════════════════════════\n');
    
    logCritical(`Mode: ${app.isPackaged ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    logCritical(`CWD: ${process.cwd()}`);
    logCritical(`appPath: ${app.getAppPath()}`);
    logCritical(`resourcesPath: ${process.resourcesPath}`);
    logCritical(`Log file: ${MAIN_LOG}`);
    
    // ✅ IMPORTANT: Définir les variables d'environnement AVANT l'initialisation
    // Point clé : APP_ROOT ≠ RESOURCES_ROOT
    // APP_ROOT = ...\resources\app.asar (prod) → où se trouve le code d'app (src/, electron/)
    // RESOURCES_ROOT = ...\resources (prod) → où se trouvent ui/, print/, config.env, ai/, etc.
    const appRootPath = resolveAppRoot();
    const resourcesRootPath = resolveResourcesRoot();
    
    process.env.APP_ROOT = appRootPath;
    process.env.RESOURCES_ROOT = resourcesRootPath;
    process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
    
    // ✅ CRITIQUE: Dossier DATA écrivable pour DB, logs, printer (jamais dans resources!)
    // Electron définit cela AVANT que paths.js ne soit utilisé
    process.env.LAGRACE_DATA_DIR = app.getPath('userData');
    
    console.log('📍 CHEMINS DÉFINIS:');
    console.log(`   APP_ROOT: ${process.env.APP_ROOT}`);
    console.log(`   RESOURCES_ROOT: ${process.env.RESOURCES_ROOT}`);
    console.log(`   LAGRACE_DATA_DIR: ${process.env.LAGRACE_DATA_DIR}`);
    
    // Vérification des fichiers clés
    console.log('\n🔍 VÉRIFICATION DES FICHIERS CRITIQUES:');
    const criticalFiles = [
      { name: 'server.js (ESM)', path: path.join(appRootPath, 'src', 'api', 'server.js') },
      { name: 'server-entry.cjs (wrapper)', path: path.join(appRootPath, 'src', 'api', 'server-entry.cjs') },
      { name: 'src/package.json (ESM)', path: path.join(appRootPath, 'src', 'package.json') },
      { name: 'UI (index.html)', path: path.join(resourcesRootPath, 'ui', 'index.html') },
      { name: 'UI assets', path: path.join(resourcesRootPath, 'ui', 'assets') },
      { name: 'main.cjs (app init)', path: path.join(__dirname, 'main.cjs') },
    ];
    
    for (const file of criticalFiles) {
      const exists = fs.existsSync(file.path);
      const status = exists ? '✅' : '❌';
      console.log(`   ${status} ${file.name}: ${file.path}`);
      logToFile(`[CHECK] ${status} ${file.name}: ${file.path}`);
    }
    console.log('');
    
    // Initialiser l'app (chemins, db, loggers, etc.)
    console.log('🚀 Initialisation Glowflixprojet...');
    const initBridge = require('./init-bridge.cjs');
    appContext = await initBridge.initializeApp();
    console.log('✓ Glowflixprojet contexte prêt\n');
    
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
      // En mode production, démarrer le serveur (in-process de préférence)
      console.log('\n📦 MODE PRODUCTION: démarrage du backend...');
      try {
        // ✅ RECOMMANDÉ: In-process (plus robuste, zéro spawn)
        console.log('[BACKEND] 🔄 Tentative démarrage in-process...');
        await startBackendInProcess();
        
        // ✅ CRITIQUE: Attendre /api/health après démarrage
        console.log('[BACKEND] 🔍 Validation du backend sur /api/health...');
        const ok = await waitForServer(40); // ~20 secondes
        if (!ok) throw new Error('Backend non accessible sur /api/health après démarrage');
        console.log('[BACKEND] ✅ Backend in-process DÉMARRÉ et VALIDÉ\n');
      } catch (inProcessError) {
        // ⚠️ Fallback: spawn avec Electron en mode Node
        console.warn('[BACKEND] ⚠️  In-process échoué, fallback spawn:', inProcessError.message);
        console.warn('[BACKEND] Stack:', inProcessError.stack);
        try {
          await startServer();
          
          // ✅ CRITIQUE: Attendre /api/health après spawn aussi
          console.log('[BACKEND] 🔍 Validation du backend spawn sur /api/health...');
          const ok = await waitForServer(40);
          if (!ok) throw new Error('Backend spawn non accessible sur /api/health');
          console.log('[BACKEND] ✅ Backend spawn DÉMARRÉ et VALIDÉ\n');
        } catch (spawnError) {
          console.error('[BACKEND] ❌ Spawn aussi échoué:', spawnError.message);
          console.error('[BACKEND] Stack:', spawnError.stack);
          throw spawnError;
        }
      }
      
      try {
        console.log('[WINDOW] 🪟 Création de la fenêtre BrowserWindow...');
        createWindow();
        console.log('[WINDOW] ✅ Fenêtre créée avec succès\n');
      } catch (windowError) {
        console.error('[WINDOW] ❌ Erreur création fenêtre:', windowError);
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
    console.error('\n');
    console.error('════════════════════════════════════════════════════════════════════');
    console.error('❌ ERREUR CRITIQUE lors du démarrage');
    console.error('════════════════════════════════════════════════════════════════════');
    console.error(`Message: ${error.message}`);
    console.error(`Stack:\n${error.stack}`);
    console.error('════════════════════════════════════════════════════════════════════\n');
    
    // ✅ ÉCRIRE DANS LE FICHIER DE LOG
    logCritical('❌ ERREUR CRITIQUE lors du démarrage');
    logCritical(`Message: ${error.message}`);
    if (error.stack) logToFile(error.stack);
    logCritical(`Voir le fichier de log complet: ${MAIN_LOG}`);
    
    // ✅ IMPORTANT: NE PAS quitter immédiatement si possible
    // Essayer de créer une fenêtre vide pour montrer l'erreur
    try {
      createWindow();
      if (mainWindow) {
        mainWindow.webContents.on('did-finish-load', () => {
          mainWindow.webContents.executeJavaScript(`
            document.body.innerHTML = '<h1 style="color:red; font-family:monospace;">❌ ERREUR DE DÉMARRAGE</h1>' +
            '<pre style="color:#ccc; font-family:monospace; margin:20px; white-space:pre-wrap; word-wrap:break-word;">${error.message}\n\nVoir les logs: ${MAIN_LOG}</pre>';
          `);
        });
        mainWindow.loadURL('data:text/html,<h1>❌ Erreur de démarrage</h1>');
      }
    } catch (e) {
      console.error('Impossible de créer une fenêtre d\'erreur:', e);
      logCritical('Impossible de créer fenêtre erreur:', e.message);
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
