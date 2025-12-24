import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { ensureDirs, getDbPath, getProjectRoot } from '../core/paths.js';
import { logger } from '../core/logger.js';
import { initSchema, getDb } from '../db/sqlite.js';
import { syncWorker } from '../services/sync/sync.worker.js';
import { createPrinterModule } from '../../print/module.js';
import dotenv from 'dotenv';

// Routes
import authRoutes from './routes/auth.routes.js';
import productsRoutes from './routes/products.routes.js';
import stockRoutes from './routes/stock.routes.js';
import salesRoutes from './routes/sales.routes.js';
import debtsRoutes from './routes/debts.routes.js';
import ratesRoutes from './routes/rates.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import syncRoutes from './routes/sync.routes.js';
// printRoutes remplacé par printerModule.router

// Middlewares
import { errorHandler, notFound } from './middlewares/errors.js';

// Charger les variables d'environnement
dotenv.config();

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
});

const PORT = process.env.PORT || 3030;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('dist')); // Servir l'UI React buildée

// Routes API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
app.use('/api/rates', ratesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/sync', syncRoutes);

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

// WebSocket
io.on('connection', (socket) => {
  logger.info(`Client connecté: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`Client déconnecté: ${socket.id}`);
  });

  // Écouter les événements de vente
  socket.on('sale:created', (sale) => {
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

// Démarrer le serveur
httpServer.listen(PORT, () => {
  logger.info(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  logger.info(`📁 Base de données: ${getDbPath()}`);
  logger.info(`✅ API disponible sur http://localhost:${PORT}/api`);
  
  // Démarrer le worker de synchronisation
  if (process.env.GOOGLE_SHEETS_WEBAPP_URL) {
    syncWorker.start();
    logger.info('🔄 Worker de synchronisation démarré');
  } else {
    logger.warn('⚠️  GOOGLE_SHEETS_WEBAPP_URL non configuré, synchronisation désactivée');
  }
  
  // Démarrer le module d'impression
  printerModule.start();
  logger.info('🖨️  Module d\'impression démarré');
  logger.info(`📁 Dossier impression: ${path.join(getProjectRoot(), 'printer')}`);
});

// Gestion des erreurs
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

export default app;

