import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { existsSync } from 'fs';
import { resolve } from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { ensureDirs, getDbPath, getProjectRoot } from '../core/paths.js';
import { logger } from '../core/logger.js';
import { initSchema, getDb } from '../db/sqlite.js';
import { syncWorker } from '../services/sync/sync.worker.js';
import { createPrinterModule } from '../../print/module.js';
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
// printRoutes remplacé par printerModule.router

// Middlewares
import { errorHandler, notFound } from './middlewares/errors.js';

// Charger les variables d'environnement
// Essayer d'abord config.env, puis .env en fallback
const configEnvPath = resolve(process.cwd(), 'config.env');
const dotEnvPath = resolve(process.cwd(), '.env');

if (existsSync(configEnvPath)) {
  dotenv.config({ path: configEnvPath });
  console.log(`✅ Variables d'environnement chargées depuis: config.env`);
} else if (existsSync(dotEnvPath)) {
  dotenv.config({ path: dotEnvPath });
  console.log(`✅ Variables d'environnement chargées depuis: .env`);
} else {
  dotenv.config(); // Par défaut
  console.warn(`⚠️  Aucun fichier config.env ou .env trouvé, utilisation des variables d'environnement système`);
}

// === AI LaGrace - Configuration automatique ===
const AI_ENABLED = process.env.AI_LAGRACE_ENABLED !== 'false';
let AI_AUTOSTART = process.env.AI_LAGRACE_AUTOSTART !== 'false';
// Détection Electron - vérifier uniquement ELECTRON_RUN_AS_NODE, pas argv
const IS_ELECTRON = process.env.ELECTRON_RUN_AS_NODE === 'true';
if (IS_ELECTRON) {
  // Electron gère l'IA seul (démarre via npm run dev concurrently)
  AI_AUTOSTART = false;
} else if (AI_ENABLED) {
  // Navigateur web: l'IA démarre à la demande (via API /api/ai/start)
  AI_AUTOSTART = false;
}

logger.info(`[AI] Détection: IS_ELECTRON=${IS_ELECTRON}, AI_ENABLED=${AI_ENABLED}, AI_AUTOSTART=${AI_AUTOSTART}`);

const AI_DIR = resolve(getProjectRoot(), 'ai-lagrace');
const AI_MAIN = resolve(AI_DIR, 'main.py');
let aiProcess = null;
let aiStopping = false;

function checkPython() {
  return new Promise((resolveCheck) => {
    // ✅ CORRECTION: Utiliser le venv Python au lieu du Python système
    const pythonExe = process.platform === 'win32'
      ? resolve(getProjectRoot(), '.venv', 'Scripts', 'python.exe')
      : resolve(getProjectRoot(), '.venv', 'bin', 'python');
    
    const check = spawn(pythonExe, ['--version'], { shell: true });
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
  if (!existsSync(AI_MAIN)) {
    logger.warn('[AI] AI LaGrace non installée (main.py non trouvé)');
    logger.warn(`[AI] Chemin attendu: ${AI_MAIN}`);
    return;
  }

  const hasPython = await checkPython();
  if (!hasPython) {
    logger.warn('[AI] Python non disponible, AI LaGrace désactivée');
    return;
  }

  logger.info('[AI] ========================================');
  logger.info('[AI] DÉMARRAGE DE AI LaGrace (serveur)...');
  logger.info(`[AI] Répertoire: ${AI_DIR}`);
  logger.info(`[AI] Script: ${AI_MAIN}`);
  logger.info('[AI] ========================================');

  // ✅ CORRECTION: Utiliser le venv Python au lieu du Python système
  const pythonExe = process.platform === 'win32'
    ? resolve(getProjectRoot(), '.venv', 'Scripts', 'python.exe')
    : resolve(getProjectRoot(), '.venv', 'bin', 'python');

  logger.info(`[AI] Python: ${pythonExe}`);

  aiStopping = false;
  aiProcess = spawn(pythonExe, ['main.py', '--quiet'], {
    cwd: AI_DIR,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });

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

// Créer les dossiers nécessaires
ensureDirs();

// Initialiser la base de données
initSchema();

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
app.use(express.json());
app.use(express.static('dist')); // Servir l'UI React buildée

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
  if (IS_ELECTRON) {
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
  if (IS_ELECTRON) {
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

// Module d'impression (remplace printRoutes)
const printerModule = createPrinterModule({
  io,
  logger,
  printDir: path.join(getProjectRoot(), 'printer'),
  templatesDir: path.join(getProjectRoot(), 'printer', 'templates'),
  assetsDir: path.join(getProjectRoot(), 'printer', 'assets'),
});

// Intégrer les routes d'impression du module
app.use('/api/print', printerModule.router);

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

// Route catch-all : servir index.html pour SPA routing (doit être avant notFound)
// Cela permet au client React Router de gérer les routes
app.get('*', (req, res, next) => {
  // Ne pas servir index.html pour les routes API
  if (req.path.startsWith('/api')) {
    return next();
  }
  
  // Servir index.html pour toutes les autres routes (SPA routing)
  const indexPath = path.join(process.cwd(), 'dist', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      // Si index.html n'existe pas (mode dev), retourner 404
      next();
    }
  });
});

// Middleware d'erreur (doit être en dernier)
app.use(notFound);
app.use(errorHandler);

// Démarrer le serveur avec gestion d'erreur pour port déjà utilisé
httpServer.listen(PORT, HOST, () => {
  const networkInterfaces = os.networkInterfaces();
  const addresses = [];
  
  // Collecter toutes les adresses IP disponibles
  Object.keys(networkInterfaces).forEach((interfaceName) => {
    networkInterfaces[interfaceName].forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(`http://${iface.address}:${PORT}`);
      }
    });
  });
  
  logger.info(`🚀 Serveur démarré sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (addresses.length > 0) {
    logger.info(`🌐 Accessible sur le réseau local:`);
    addresses.forEach(addr => logger.info(`   - ${addr}`));
  }
  logger.info(`📁 Base de données: ${getDbPath()}`);
  logger.info(`✅ API disponible sur http://localhost:${PORT}/api`);
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
  
  // Démarrer le module d'impression
  printerModule.start();
  logger.info('🖨️  Module d\'impression démarré');
  logger.info(`📁 Dossier impression: ${path.join(getProjectRoot(), 'printer')}`);

  // Démarrer l'AI (après le serveur pour que Socket.IO soit prêt)
  setTimeout(() => {
    startAI().catch((err) => logger.error('[AI] Erreur démarrage:', err));
  }, 2000);
});

// Gestion d'erreur pour port déjà utilisé
httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`❌ Erreur: Le port ${PORT} est déjà utilisé.`);
    logger.error(`💡 Solutions:`);
    logger.error(`   1. Arrêter l'autre processus utilisant le port ${PORT}`);
    logger.error(`   2. Utiliser un autre port en définissant la variable d'environnement PORT (ex: PORT=3031)`);
    logger.error(`   3. Sur Windows, exécuter: netstat -ano | findstr :${PORT} pour trouver le PID`);
    logger.error(`   4. Puis tuer le processus: taskkill /PID <PID> /F`);
    process.exit(1);
  } else {
    logger.error('❌ Erreur serveur:', error);
    process.exit(1);
  }
});

// Gestion des erreurs
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  stopAI();
});

process.on('SIGTERM', () => {
  stopAI();
});

process.on('exit', () => {
  stopAI();
});

export default app;
