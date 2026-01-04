import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs, { existsSync } from 'fs';
import { resolve } from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { ensureDirs, getDbPath, getProjectRoot, getResourcesRoot, getPrintDir } from '../core/paths.js';
import { logger } from '../core/logger.js';
import { initSchema, getDb } from '../db/sqlite.js';
import { syncWorker } from '../services/sync/sync.worker.js';
import { setSocketIO } from './socket.js';
import dotenv from 'dotenv';

// Routes
import authRoutes from './routes/auth.routes.js';
import productsRoutes from './routes/products.routes.js';
import stockRoutes from './routes/stock.routes.js';
import salesRoutes from './routes/sales.routes.js';
import debtsRoutes from './routes/debts.routes.js';
import usersRoutes from './routes/users.routes.js';
import ratesRoutes from './routes/rates.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import syncRoutes from './routes/sync.routes.js';
import licenseRoutes from './routes/license.routes.js';
import autosyncRoutes from './routes/autosync.routes.js';
import autoStockRouter, { startAutoCheck, stopAutoCheck } from './routes/router.autostock.js';
import { autoSyncService } from './services/autoSync.service.js';

// Middlewares
import { errorHandler, notFound } from './middlewares/errors.js';

// ✅ Fonction pour expanser les variables d'environnement Windows (%APPDATA%, etc.)
function expandWinVars(value) {
  if (!value || typeof value !== 'string') return value;
  return value.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
}

// ✅ FONCTIONS UTILITAIRES
const getAppRoot = () => process.env.APP_ROOT || process.cwd();

const isElectronRuntime = () =>
  process.env.LAGRACE_IS_ELECTRON === '1' ||  // ✅ Flag dédié (posé par main.cjs avant import)
  process.env.ELECTRON_RUN_AS_NODE === '1' ||  // Fallback Electron classique
  process.env.ELECTRON_RUN_AS_NODE === 'true';

// ✅ Dossier de données écrivable (APPDATA/userData sur Windows, home sur Linux/Mac)
// Utilisé pour les fichiers runtime (printer output, db, caches, etc.)
const getDataRoot = () => {
  return process.env.LAGRACE_DATA_DIR || resolve(process.env.APPDATA || os.homedir(), 'LA GRACE POS');
};

// ✅ Charger config.env/env depuis plusieurs emplacements (prod + dev)
const candidates = [
  resolve(getResourcesRoot(), 'config.env'),  // ✅ resources/config.env (extraResources en prod)
  resolve(getAppRoot(), 'config.env'),        // ✅ si config.env dans asar
  resolve(process.cwd(), 'config.env'),       // fallback dev
  resolve(getResourcesRoot(), '.env'),
  resolve(getAppRoot(), '.env'),
  resolve(process.cwd(), '.env'),
];

const found = candidates.find(p => existsSync(p));

if (found) {
  dotenv.config({ path: found });
  console.log(`✅ Variables d'environnement chargées depuis: ${found}`);
} else {
  dotenv.config();
  console.warn(`⚠️  Aucun config.env/.env trouvé aux emplacements: ${candidates.join(' | ')}`);
  console.warn(`⚠️  Utilisation des variables d'environnement système`);
}

// ✅ Expanser les variables Windows (%APPDATA%, etc.)
for (const key of Object.keys(process.env)) {
  process.env[key] = expandWinVars(process.env[key]);
}

// Log des variables importantes pour le debug
console.log(`[INIT] APP_ROOT=${getAppRoot()}`);
console.log(`[INIT] RESOURCES_ROOT=${getResourcesRoot()}`);
console.log(`[INIT] process.cwd()=${process.cwd()}`);


// === AI LaGrace - Configuration automatique ===
const AI_ENABLED = process.env.AI_LAGRACE_ENABLED !== 'false';
let AI_AUTOSTART = process.env.AI_LAGRACE_AUTOSTART !== 'false';
// ✅ EN PRODUCTION: l'IA est lancée par Electron via startAI() → AI_AUTOSTART = false ici
// ✅ EN DÉVELOPPEMENT (web): l'IA peut être lancée via API /api/ai/start → AI_AUTOSTART = false aussi
// ✅ JAMAIS d'autostart dans server.js, car:
//    - En EXE Electron: Electron lance l'IA seul
//    - En web: l'utilisateur démarre l'IA via le UI/API
if (isElectronRuntime()) {
  // Electron gère l'IA seul
  AI_AUTOSTART = false;
} else {
  // Navigateur web: l'IA démarre à la demande (via API /api/ai/start)
  AI_AUTOSTART = false;
}

logger.info(`[AI] Détection: isElectron=${isElectronRuntime()}, AI_ENABLED=${AI_ENABLED}, AI_AUTOSTART=${AI_AUTOSTART}`);

// DIST_DIR sera défini dans startBackend()
let DIST_DIR = null;

// ✅ Détection: en production (packaged), l'IA est un EXE; en dev, c'est un script Python
const AI_DIR_PROD = resolve(getResourcesRoot(), 'ai');
const AI_DIR_DEV = resolve(getProjectRoot(), 'ai-lagrace');
const AI_DIR = DIST_DIR ? AI_DIR_PROD : AI_DIR_DEV;  // Sera mis à jour dans startBackend()
const AI_MAIN_PROD = resolve(AI_DIR_PROD, 'ai-lagrace', 'ai-lagrace.exe');  // EXE compilé en prod
const AI_MAIN_DEV = resolve(AI_DIR_DEV, 'main.py');  // Script Python en dev

let aiProcess = null;
let aiStopping = false;
let isPackaged = false;  // Sera défini depuis DIST_DIR

function checkPython() {
  return new Promise((resolveCheck) => {
    // ✅ CORRECTION: Utiliser le venv Python au lieu du Python système
    const pythonExe = process.platform === 'win32'
      ? resolve(getProjectRoot(), '.venv', 'Scripts', 'python.exe')
      : resolve(getProjectRoot(), '.venv', 'bin', 'python');
    
    // ✅ Utiliser shell: false pour plus de sécurité
    const check = spawn(pythonExe, ['--version'], { shell: false });
    check.on('close', (code) => resolveCheck(code === 0));
    check.on('error', () => resolveCheck(false));
  });
}

async function startAI() {
  if (!AI_ENABLED) {
    logger.info('[AI] AI LaGrace désactivée par configuration');
    return;
  }
  if (!AI_AUTOSTART) {
    logger.info('[AI] Autostart désactivé pour AI LaGrace (gérée par Electron)');
    return;
  }

  // ✅ Déterminer le chemin correct selon qu'on est en prod ou dev
  const AI_MAIN = isPackaged ? AI_MAIN_PROD : AI_MAIN_DEV;
  const currentAIDir = isPackaged ? AI_DIR_PROD : AI_DIR_DEV;

  if (!existsSync(AI_MAIN)) {
    logger.warn('[AI] AI LaGrace non installée');
    logger.warn(`[AI] Chemin attendu: ${AI_MAIN}`);
    return;
  }

  // ✅ En production, vérifier si l'EXE existe
  if (isPackaged) {
    logger.info('[AI] Mode PRODUCTION détecté - utilisation de ai-lagrace.exe');
    logger.info('[AI] DÉMARRAGE DE AI LaGrace (exe)...');
    logger.info(`[AI] Exécutable: ${AI_MAIN}`);
    
    aiStopping = false;
    aiProcess = spawn(AI_MAIN, ['--quiet'], {
      cwd: currentAIDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });
  } else {
    // ✅ En développement, vérifier Python
    const hasPython = await checkPython();
    if (!hasPython) {
      logger.warn('[AI] Python non disponible, AI LaGrace désactivée');
      return;
    }

    logger.info('[AI] Mode DÉVELOPPEMENT détecté - utilisation de main.py');
    logger.info('[AI] ========================================');
    logger.info('[AI] DÉMARRAGE DE AI LaGrace (serveur)...');
    logger.info(`[AI] Répertoire: ${currentAIDir}`);
    logger.info(`[AI] Script: ${AI_MAIN}`);
    logger.info('[AI] ========================================');

    const pythonExe = process.platform === 'win32'
      ? resolve(getProjectRoot(), '.venv', 'Scripts', 'python.exe')
      : resolve(getProjectRoot(), '.venv', 'bin', 'python');

    logger.info(`[AI] Python: ${pythonExe}`);

    aiStopping = false;
    aiProcess = spawn(pythonExe, ['main.py', '--quiet'], {
      cwd: currentAIDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });
  }

  aiProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) logger.info(`[AI] ${output}`);
  });

  aiProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) logger.error(`[AI] ${output}`);
  });

  aiProcess.on('close', (code) => {
    logger.warn(`[AI] AI LaGrace arrêtée (code: ${code})`);
    aiProcess = null;
    if (!aiStopping && code !== 0 && code !== null) {
      logger.warn('[AI] Redémarrage automatique dans 5 secondes...');
      setTimeout(() => {
        startAI().catch((err) => logger.error('[AI] Erreur au redémarrage:', err));
      }, 5000);
    }
  });

  aiProcess.on('error', (err) => {
    logger.error('[AI] Erreur process:', err);
    aiProcess = null;
  });
}

function stopAI() {
  if (!aiProcess) return;
  aiStopping = true;
  logger.info('[AI] Arrêt de AI LaGrace...');

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', aiProcess.pid.toString(), '/f', '/t'], { shell: true });
  } else {
    aiProcess.kill('SIGTERM');
  }
  aiProcess = null;
}

// ✅ IMPORTANT: ensureDirs() et initSchema() sont maintenant appelés dans startBackend()
// Cela garantit que APP_ROOT/RESOURCES_ROOT sont correctement posés en production

// ✅ App et serveur créés mais PAS listen() ici
// Cela sera fait dans startBackend()
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
  // Configuration pour éviter les déconnexions automatiques
  pingTimeout: 60000,      // Temps d'attente avant de considérer la connexion comme morte (60s)
  pingInterval: 25000,     // Intervalle entre les pings (25s)
  // Permettre les reconnexions
  allowEIO3: true,
  // Améliorer la gestion des connexions
  transports: ['websocket', 'polling'],
  // Timeout pour les connexions
  connectTimeout: 45000,
});

// Partager l'instance Socket.IO avec les routes
setSocketIO(io);

const PORT = process.env.PORT || 3030;
const HOST = process.env.HOST || '0.0.0.0'; // Écouter sur toutes les interfaces réseau

// Middlewares - CORS configuré pour accepter LAN et localhost
// Permet aux PC clients du réseau local de se connecter sans erreur
app.use(cors({
  origin: (origin, cb) => {
    // Permettre les outils non-navigateur (pas d'origine) - important pour Electron
    if (!origin) return cb(null, true);
    
    // Permettre localhost et 127.0.0.1
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return cb(null, true);
    }
    
    // Permettre toutes les IPs privées (LAN)
    // IPv4 privées: 192.168.x.x, 10.x.x.x, 172.16.x.x - 172.31.x.x
    const privateIPPatterns = [
      /^https?:\/\/192\.168\.\d+\.\d+/,
      /^https?:\/\/10\.\d+\.\d+\.\d+/,
      /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/,
    ];
    
    if (privateIPPatterns.some(pattern => pattern.test(origin))) {
      return cb(null, true);
    }
    
    // Permettre toutes les origines en dev/production pour compatibilité totale
    return cb(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'Expires',
    'X-Requested-With',
  ],
}));

app.options('*', cors()); // Gérer les requêtes preflight OPTIONS
// ✅ app.use(express.static()) sera fait dans startBackend() avec staticDir
app.use(express.json());

// Routes API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Route pour le statut de l'IA (pour navigateur web)
app.get('/api/ai/status', (req, res) => {
  const status = aiProcess ? 'running' : 'stopped';
  res.json({ 
    status,
    running: aiProcess !== null,
    pid: aiProcess ? aiProcess.pid : null,
    enabled: AI_ENABLED,
    timestamp: new Date().toISOString()
  });
});

// Route pour démarrer l'IA (pour navigateur web)
app.post('/api/ai/start', (req, res) => {
  if (isElectronRuntime()) {
    return res.status(400).json({ 
      success: false, 
      message: 'IA gérée par Electron, utiliser les contrôles Electron' 
    });
  }
  
  if (aiProcess) {
    return res.json({ success: true, message: 'IA déjà en cours d\'exécution' });
  }
  
  startAI().then(() => {
    res.json({ success: true, message: 'IA démarrée' });
  }).catch(err => {
    res.status(500).json({ success: false, message: err.message });
  });
});

// Route pour arrêter l'IA (pour navigateur web)
app.post('/api/ai/stop', (req, res) => {
  if (isElectronRuntime()) {
    return res.status(400).json({ 
      success: false, 
      message: 'IA gérée par Electron, utiliser les contrôles Electron' 
    });
  }
  
  if (!aiProcess) {
    return res.json({ success: true, message: 'IA déjà arrêtée' });
  }
  
  stopAI();
  res.json({ success: true, message: 'IA arrêtée' });
});

// Route de test pour le mode dev
if (process.env.NODE_ENV === 'development') {
  app.get('/api/test', (req, res) => {
    res.json({
      success: true,
      message: 'Mode développement actif',
      timestamp: new Date().toISOString(),
      env: {
        nodeEnv: process.env.NODE_ENV,
        port: PORT,
        dbPath: getDbPath(),
      },
    });
  });
}

app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/debts', debtsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/rates', ratesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/license', licenseRoutes);
app.use('/api/autosync', autosyncRoutes);
app.use('/api/autostock', autoStockRouter);

// ⚠️ app.locals.db sera assignée dans startBackend() APRÈS initSchema()
// (pour éviter que la DB ne s'ouvre au mauvais chemin en production EXE)

// Module d'impression sera créé dans startBackend() après les imports dynamiques
let printerModule = null;
let printerModuleReady = false;

// Middleware pour la route d'impression (qui sera activée après le chargement)
app.use('/api/print', (req, res, next) => {
  if (!printerModuleReady || !printerModule) {
    return res.status(503).json({ error: 'Printer module not ready' });
  }
  // Passer au router du module d'impression
  return printerModule.router(req, res, next);
});

// WebSocket - Synchronisation temps réel multi-utilisateurs
io.on('connection', (socket) => {
  logger.info(`Client connecté: ${socket.id} depuis ${socket.handshake.address}`);

  socket.on('disconnect', () => {
    logger.info(`Client déconnecté: ${socket.id}`);
  });

  // Écouter les événements de vente et diffuser à tous les clients
  socket.on('sale:created', (sale) => {
    logger.info(`Vente créée: ${sale.invoice_number || sale.id}`);
    io.emit('sale:created', sale); // Diffuser à tous les clients connectés
  });

  // Synchronisation des produits
  socket.on('product:updated', (product) => {
    logger.info(`Produit mis à jour: ${product.code || product.id}`);
    socket.broadcast.emit('product:updated', product); // Diffuser aux autres clients
  });

  // Synchronisation du stock
  socket.on('stock:updated', (stock) => {
    logger.info(`Stock mis à jour: produit ${stock.product_id}`);
    socket.broadcast.emit('stock:updated', stock); // Diffuser aux autres clients
  });

  // Synchronisation des ventes
  socket.on('sale:updated', (sale) => {
    logger.info(`Vente mise à jour: ${sale.invoice_number || sale.id}`);
    socket.broadcast.emit('sale:updated', sale); // Diffuser aux autres clients
  });

  // Synchronisation des dettes
  socket.on('debt:updated', (debt) => {
    logger.info(`Dette mise à jour: ${debt.id}`);
    socket.broadcast.emit('debt:updated', debt); // Diffuser aux autres clients
  });

  // Synchronisation des taux de change
  socket.on('rate:updated', (rate) => {
    logger.info(`Taux de change mis à jour: ${rate.rate}`);
    socket.broadcast.emit('rate:updated', rate); // Diffuser aux autres clients
  });

  // === AI LaGrace Events - LOGS DÉTAILLÉS ===
  
  // AI connectée
  socket.on('ai:connected', (data) => {
    logger.info(`🤖 ========================================`);
    logger.info(`🤖 AI LaGrace CONNECTÉE!`);
    logger.info(`🤖 Socket ID: ${socket.id}`);
    logger.info(`🤖 Data: ${JSON.stringify(data)}`);
    logger.info(`🤖 ========================================`);
    socket.aiConnected = true;
    socket.aiData = data;
    // Notifier les clients que l'AI est disponible
    io.emit('ai:status', { connected: true, ...data });
  });

  // AI déconnexion
  socket.on('ai:disconnecting', (data) => {
    logger.info(`🤖 AI LaGrace se déconnecte: ${JSON.stringify(data)}`);
    socket.aiConnected = false;
    io.emit('ai:status', { connected: false });
  });
  
  // AI ping (keepalive)
  socket.on('ping', (data) => {
    // Répondre avec pong pour confirmer la connexion
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });

  // AI demande d'impression
  socket.on('ai:print_request', (data) => {
    logger.info(`🖨️ AI demande impression: ${JSON.stringify(data)}`);
    // Rediriger vers le module d'impression
    socket.emit('print:started', { source: 'ai', ...data });
    // La logique d'impression réelle est dans le module print
  });

  // AI requête stock
  socket.on('ai:stock_request', async (data, callback) => {
    try {
      const db = getDb();
      const { product } = data;
      const result = db.prepare(`
        SELECT p.code, p.label, p.brand, s.quantity, p.sell_price
        FROM products p
        LEFT JOIN stock s ON p.id = s.product_id
        WHERE UPPER(p.code) LIKE ? OR UPPER(p.label) LIKE ?
        LIMIT 1
      `).get(`%${product.toUpperCase()}%`, `%${product.toUpperCase()}%`);
      
      if (callback) callback({ success: true, data: result });
    } catch (error) {
      logger.error('AI stock request error:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // AI requête ventes
  socket.on('ai:sales_request', async (data, callback) => {
    try {
      const db = getDb();
      const today = new Date().toISOString().split('T')[0];
      const result = db.prepare(`
        SELECT COUNT(*) as count, 
               COALESCE(SUM(total_cdf), 0) as total_cdf,
               COALESCE(SUM(total_usd), 0) as total_usd
        FROM sales WHERE DATE(created_at) = ?
      `).get(today);
      
      if (callback) callback({ success: true, data: result });
    } catch (error) {
      logger.error('AI sales request error:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // Notifier l'AI des nouvelles ventes
  socket.on('sale:created', (sale) => {
    // Notifier tous les clients y compris l'AI
    io.emit('sale:created', sale);
  });
});

// ✅ FONCTION EXPORTABLE: startBackend()
// Ceci remplace httpServer.listen()
export async function startBackend({
  port = Number(process.env.PORT || 3030),
  host = process.env.HOST || '0.0.0.0',
  staticDir = null,
  isElectron = false,
  appRoot = null,
  resourcesPath = null,
} = {}) {
  // ✅ Configuration Electron
  if (isElectron) {
    process.env.ELECTRON_RUN_AS_NODE = 'true';
    process.env.AI_LAGRACE_AUTOSTART = 'false'; // IA gérée par Electron
    
    // ✅ IMPORTANT: Définir les chemins pour que les imports relatifs fonctionnent en prod
    if (appRoot) {
      process.env.APP_ROOT = appRoot;
    }
    if (resourcesPath) {
      process.env.RESOURCES_ROOT = resourcesPath;
    }
    
    // ✅ IMPORTANT: Définir le dossier de données écrivable (userData Electron)
    if (process.env.LAGRACE_DATA_DIR === undefined && typeof window === 'undefined') {
      // Ne pas écraser si déjà défini, et seulement en contexte Node
      process.env.LAGRACE_DATA_DIR = resolve(process.env.APPDATA || os.homedir(), 'LA GRACE POS');
    }
  }

  // ✅ DÉTECTION: Vérifie si on est en production (packaged) ou développement
  // Cela définit aussi DIST_DIR pour startAI()
  isPackaged = resourcesPath && resourcesPath.includes('resources');
  DIST_DIR = resourcesPath || process.cwd();  // ressources path en prod, cwd en dev
  
  logger.info(`[APP] Mode: ${isPackaged ? 'PRODUCTION (packaged)' : 'DÉVELOPPEMENT'}`);
  logger.info(`[APP] DIST_DIR=${DIST_DIR}`);
  logger.info(`[APP] AI_DIR=${isPackaged ? resolve(DIST_DIR, 'ai') : resolve(getProjectRoot(), 'ai-lagrace')}`);

  // ✅ IMPORTANT: Créer les dossiers et initialiser la DB APRÈS avoir posé les env vars
  // Cela garantit que les chemins sont corrects en production (EXE)
  ensureDirs();
  initSchema();
  
  // ✅ Assigner la DB à app.locals APRÈS initSchema() pour éviter les problèmes de chemin en prod
  app.locals.db = getDb();

  // ✅ DIAGNOSTIC: Vérifier que les chemins sont corrects
  console.log('[PATHS] DATA_ROOT=', getProjectRoot());
  console.log('[PATHS] RESOURCES_ROOT=', getResourcesRoot());
  console.log('[PATHS] DB_PATH=', getDbPath());
  console.log('[PATHS] PRINT_DIR=', getPrintDir());
  if (getProjectRoot() === process.env.APPDATA || getProjectRoot().includes('Program Files')) {
    console.warn('⚠️  ALERTE: getProjectRoot() pointe vers Program Files - check LAGRACE_DATA_DIR!');
  }

  // ✅ Charger le module d'impression dynamiquement (depuis RESOURCES_ROOT/print)
  try {
    const resourcesRoot = getResourcesRoot();
    
    // ✅ STRATÉGIE 1: Essayer depuis resourcesRoot (EXE mode)
    let printModuleFile = path.join(resourcesRoot, 'print', 'module.js');
    
    // ✅ STRATÉGIE 2: Fallback vers le chemin de développement
    if (!existsSync(printModuleFile)) {
      printModuleFile = path.join(getProjectRoot(), 'print', 'module.js');
      logger.info(`[PRINT] Module non trouvé en prod, essai mode dev: ${printModuleFile}`);
    }

    if (!existsSync(printModuleFile)) {
      throw new Error(`print/module.js introuvable: ${printModuleFile}`);
    }

    logger.info(`[PRINT] Chargement du module: ${printModuleFile}`);
    
    // ✅ IMPORTANT: Ajouter node_modules au chemin de recherche des modules
    // Cela garantit que les imports dynamiques du print/module.js trouvent les dépendances
    const nodeModulesPath = path.join(getProjectRoot(), 'node_modules');
    if (!module.paths.includes(nodeModulesPath) && existsSync(nodeModulesPath)) {
      module.paths.unshift(nodeModulesPath);
      logger.info(`[PRINT] Ajout node_modules au module.paths: ${nodeModulesPath}`);
    }

    const mod = await import(pathToFileURL(printModuleFile).href);
    // ✅ Tolérer export default si la structure change
    const createPrinterModule =
      mod.createPrinterModule || mod.default?.createPrinterModule || mod.default;

    if (!createPrinterModule) {
      throw new Error('createPrinterModule() introuvable dans print/module.js');
    }

    const printDir = getPrintDir(); // ✅ writable (userData)

    // ✅ templates/assets: idéalement depuis resources/print/*
    // Fallback vers dev si pas trouvé en prod
    let templatesDir = path.join(resourcesRoot, 'print', 'templates');
    let assetsDir = path.join(resourcesRoot, 'print', 'assets');
    
    if (!existsSync(templatesDir)) {
      templatesDir = path.join(getProjectRoot(), 'print', 'templates');
      logger.info(`[PRINT] Templates non trouvés en prod, fallback dev: ${templatesDir}`);
    }
    if (!existsSync(assetsDir)) {
      assetsDir = path.join(getProjectRoot(), 'print', 'assets');
      logger.info(`[PRINT] Assets non trouvés en prod, fallback dev: ${assetsDir}`);
    }

    // ✅ Vérifier l'existence des dossiers templates/assets
    if (!existsSync(templatesDir)) logger.warn(`[PRINT] templatesDir manquant: ${templatesDir}`);
    if (!existsSync(assetsDir)) logger.warn(`[PRINT] assetsDir manquant: ${assetsDir}`);

    printerModule = createPrinterModule({
      io,
      logger,
      printDir,        // writable
      templatesDir,    // read-only packagé
      assetsDir,       // read-only packagé
    });

    printerModuleReady = true;
    logger.info('✅ Printer module chargé avec succès');
  } catch (error) {
    printerModuleReady = false;
    printerModule = null;
    logger.error('❌ Erreur chargement printer module:', error.message);
    logger.error('   Stack:', error.stack);
    logger.warn('⚠️  Impression indisponible (le backend continue sans impression)');
    
    // ✅ DEBUG: Afficher les chemins essayés
    logger.warn(`[PRINT] Chemins essayés:`);
    logger.warn(`   - ${path.join(getResourcesRoot(), 'print', 'module.js')}`);
    logger.warn(`   - ${path.join(getProjectRoot(), 'print', 'module.js')}`);
    logger.warn(`[PRINT] Vérifiez que le dossier 'print' est inclus dans extraResources (electron-builder.json)`);
  }

  // ✅ Définir DIST_DIR avec staticDir
  // En production (EXE), utiliser resources/ui au lieu de dist/ui
  const defaultUiDir = (process.env.NODE_ENV === 'production')
    ? resolve(getResourcesRoot(), 'ui')   // ✅ EXE: resources/ui
    : resolve(getAppRoot(), 'dist', 'ui'); // ✅ dev build local
  
  DIST_DIR = staticDir || defaultUiDir;

  logger.info(`[PATHS] APP_ROOT=${getAppRoot()}`);
  logger.info(`[PATHS] RESOURCES_ROOT=${getResourcesRoot()}`);
  logger.info(`[PATHS] DIST_DIR=${DIST_DIR}`);
  logger.info(`[PATHS] UI existant: ${existsSync(DIST_DIR)}`);

  // ✅ Servir l'UI statique (priorité à staticDir, sinon DIST_DIR en fallback)
  const uiDir = (staticDir && existsSync(staticDir)) ? staticDir : DIST_DIR;

  if (uiDir && existsSync(uiDir)) {
    // ✅ VÉRIFIER QUE LES ASSETS EXISTENT
    const assetsDir = resolve(uiDir, 'assets');
    const indexHtml = resolve(uiDir, 'index.html');
    const hasAssets = existsSync(assetsDir);
    const hasIndex = existsSync(indexHtml);
    
    logger.info(`[STATIC] 🎨 Assets dir: ${assetsDir} (existe: ${hasAssets})`);
    logger.info(`[STATIC] 📄 index.html: ${indexHtml} (existe: ${hasIndex})`);
    
    // ✅ Lister les fichiers du répertoire UI pour diagnostic
    if (existsSync(uiDir)) {
      const files = fs.readdirSync(uiDir).slice(0, 20); // Les 20 premiers fichiers
      logger.info(`[STATIC] Contenu de ${uiDir}: ${files.join(', ')}`);
    }
    
    if (!hasAssets) {
      logger.warn(`⚠️  ALERTE: Le dossier assets manque! ${assetsDir}`);
      logger.warn(`⚠️  Les fichiers JS/CSS (index-*.js) ne seront PAS trouvés`);
      logger.warn(`⚠️  Vérifier: extraResources dans electron-builder.json`);
    }
    if (!hasIndex) {
      logger.warn(`⚠️  ALERTE: index.html manque! ${indexHtml}`);
    }
    
    app.use(express.static(uiDir));
    logger.info(`[STATIC] ✅ UI servie depuis: ${uiDir}`);
  } else {
    logger.error(`❌ ERREUR CRITIQUE: Aucun dossier UI valide trouvé`);
    logger.error(`   staticDir=${staticDir} (existe: ${staticDir ? existsSync(staticDir) : 'N/A'})`);
    logger.error(`   DIST_DIR=${DIST_DIR} (existe: ${existsSync(DIST_DIR)})`);
    logger.warn(`⚠️  Les clients recevront index.html mais les assets JS/CSS seront manquants`);
  }

  // ✅ IMPORTANT: Route catch-all APRÈS express.static() pour SPA routing
  // Cela permet à React Router de gérer les routes côté client
  app.get('*', (req, res) => {
    // Ne pas servir index.html pour les routes API et Socket.IO
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      // Les routes API non trouvées passent au middleware notFound
      return res.status(404).json({ success: false, error: 'Route non trouvée' });
    }
    
    // Ne pas servir index.html pour les fichiers avec extension (.js, .css, .png, etc.)
    if (/\.\w+$/.test(req.path)) {
      // Les fichiers non trouvés (comme assets manquants) retournent 404
      return res.status(404).send('Fichier non trouvé');
    }
    
    // Servir index.html pour toutes les autres routes (SPA routing)
    const indexPath = path.join(uiDir, 'index.html');
    if (!existsSync(indexPath)) {
      return res.status(404).send('index.html non trouvé');
    }
    
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(500).send('Erreur serveur');
      }
    });
  });

  // ✅ IMPORTANT: Middleware d'erreur APRÈS le catch-all SPA
  // Pour que le catch-all SPA s'exécute AVANT notFound
  app.use(notFound);
  app.use(errorHandler);

  // ✅ Démarrer le serveur avec gestion d'erreur pour port déjà utilisé
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);

    httpServer.listen(port, host, () => {
      const networkInterfaces = os.networkInterfaces();
      const addresses = [];
      
      // Collecter toutes les adresses IP disponibles
      Object.keys(networkInterfaces).forEach((interfaceName) => {
        networkInterfaces[interfaceName].forEach((iface) => {
          if (iface.family === 'IPv4' && !iface.internal) {
            addresses.push(`http://${iface.address}:${port}`);
          }
        });
      });
      
      logger.info(`🚀 Serveur démarré sur http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
      if (addresses.length > 0) {
        logger.info(`🌐 Accessible sur le réseau local:`);
        addresses.forEach(addr => logger.info(`   - ${addr}`));
      }
      logger.info(`📁 Base de données: ${getDbPath()}`);
      logger.info(`✅ API disponible sur http://localhost:${port}/api`);
      logger.info(`🔌 WebSocket disponible pour synchronisation temps réel`);
      
      // Démarrer le worker de synchronisation en arrière-plan (non-bloquant)
      if (process.env.GOOGLE_SHEETS_WEBAPP_URL) {
        // Utiliser setImmediate pour démarrer la sync après que le serveur soit prêt
        setImmediate(() => {
          syncWorker.start().catch(err => {
            logger.error('❌ Erreur démarrage worker sync:', err);
          });
          logger.info('🔄 Worker de synchronisation démarré (arrière-plan)');
        });
      } else {
        logger.warn('⚠️  GOOGLE_SHEETS_WEBAPP_URL non configuré, synchronisation désactivée');
      }
      
      // ✅ Démarrer le module d'impression (avec protection)
      if (printerModuleReady && printerModule?.start) {
        printerModule.start();
        logger.info('🖨️  Module d\'impression démarré');
        logger.info(`📁 Dossier impression: ${getPrintDir()}`);
      } else {
        logger.warn('🖨️  Module d\'impression non démarré (module absent ou non initialisé)');
      }

      // Démarrer l'auto-check (vérification automatique du stock toutes les 2 secondes)
      startAutoCheck(getDb());
      logger.info('🔄 AutoCheck démarré (vérification stock toutes les 2 secondes)');

      // ✅ Démarrer la synchronisation automatique (toutes les 10 secondes)
      autoSyncService.start();
      logger.info('🔄 AutoSync démarré (synchronisation intelligente toutes les 10 secondes)');

      // Démarrer l'AI (après le serveur pour que Socket.IO soit prêt)
      // Sauf si c'est Electron (IA gérée par main.cjs)
      if (!isElectron) {
        setTimeout(() => {
          startAI().catch((err) => logger.error('[AI] Erreur démarrage:', err));
        }, 2000);
      }

      // ✅ Retourner l'objet avec stop()
      resolve({
        port,
        host,
        app,
        io,
        httpServer,
        async stop() {
          stopAutoCheck(); // Arrêter l'auto-check avant de fermer le serveur
          autoSyncService.stop(); // Arrêter la sync automatique
          return new Promise((r) => httpServer.close(() => r()));
        },
      });
    });

    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Erreur: Le port ${port} est déjà utilisé.`);
        logger.error(`💡 Solutions:`);
        logger.error(`   1. Arrêter l'autre processus utilisant le port ${port}`);
        logger.error(`   2. Utiliser un autre port en définissant PORT (ex: PORT=3031)`);
        logger.error(`   3. Sur Windows: netstat -ano | findstr :${port}`);
        logger.error(`   4. Puis: taskkill /PID <PID> /F`);
        reject(error);
      } else {
        logger.error('❌ Erreur serveur:', error);
        reject(error);
      }
    });
  });
}

// Gestion des erreurs globales
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// ✅ Export par défaut toujours le app pour compatibilité
export default app;

// ✅ Mode développement: auto-démarrer le serveur
// Lance si invoqué directement : node server.js OR electron server.js (ELECTRON_RUN_AS_NODE=1)
(async () => {
  const isDirect = process.argv[1]?.includes('server.js');
  
  if (isDirect) {
    console.log('[SERVER] Mode développement - démarrage automatique du serveur...');
    console.log('[SERVER] Runtime:', isElectronRuntime() ? 'Electron (ELECTRON_RUN_AS_NODE=1)' : 'Node.js');
    
    // Assurer que les répertoires existent
    ensureDirs();
    
    await startBackend({
      port: PORT,
      host: HOST,
      staticDir: null,  // Pas de static en dev (Vite fournit l'UI)
      isElectron: isElectronRuntime(),
    });
    
    console.log(`✅ Serveur Express prêt sur http://${HOST}:${PORT}`);
  }
})().catch(err => {
  console.error('[SERVER] Erreur démarrage:', err);
  process.exit(1);
});

// Gestion des signaux de fermeture
process.on('SIGINT', () => {
  stopAI();
});

process.on('SIGTERM', () => {
  stopAI();
});

process.on('exit', () => {
  stopAI();
});
