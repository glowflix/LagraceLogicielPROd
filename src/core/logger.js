import winston from "winston";
import path from "path";
import { getLogsDir } from "./paths.js";

const logsDir = getLogsDir();

// Format personnalisé pour les logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Format console (plus lisible)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Création du logger principal
// PRO: warn par défaut pour réduire les logs (erreurs et warnings seulement)
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "warn",
  format: logFormat,
  defaultMeta: { service: "glowflixprojet" },
  transports: [
    // Fichier pour toutes les logs
    new winston.transports.File({
      filename: path.join(logsDir, "app.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Fichier séparé pour les erreurs
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 5242880,
      maxFiles: 5,
    }),
    // Console en développement - PRO: désactivé pour performance
    // Activer seulement si LOG_LEVEL=debug ou LOG_CONSOLE=1
    ...(process.env.LOG_CONSOLE === '1' && process.env.NODE_ENV !== "production" 
      ? [new winston.transports.Console({ format: consoleFormat })]
      : []
    ),
  ],
});

// ============================================================================
// SYNC LOGGER INTELLIGENT - PRO VERSION
// ============================================================================
// SYNC_LOG_LEVEL: 
//   0 = SILENT (erreurs critiques seulement) [DÉFAUT PRO]
//   1 = MINIMAL (résumés uniquement, pas de détails)
//   2 = SUMMARY (résumés + compteurs par section)
//   3 = VERBOSE (logs détaillés pour debug)
// ============================================================================
const SYNC_LOG_LEVEL = parseInt(process.env.SYNC_LOG_LEVEL || '0', 10);

// Logger spécialisé pour la synchronisation
const baseSyncLogger = winston.createLogger({
  level: "info",
  format: logFormat,
  defaultMeta: { service: "sync" },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, "sync.log"),
      maxsize: 5242880,
      maxFiles: 5,
    }),
    // Console désactivée par défaut pour performance (activer avec SYNC_LOG_CONSOLE=1)
    ...(process.env.SYNC_LOG_CONSOLE === '1' 
      ? [new winston.transports.Console({ format: consoleFormat })]
      : []
    ),
  ],
});

// Compteurs pour les résumés
const syncCounters = {
  products: { pulled: 0, pushed: 0, errors: 0 },
  sales: { pulled: 0, pushed: 0, errors: 0 },
  debts: { pulled: 0, pushed: 0, errors: 0 },
  units: { pulled: 0, pushed: 0, errors: 0 },
  stock: { pulled: 0, pushed: 0, errors: 0 },
  lastResetTime: Date.now(),
};

// Reset des compteurs toutes les 60 secondes
setInterval(() => {
  const now = Date.now();
  const elapsed = now - syncCounters.lastResetTime;
  
  // Afficher un résumé si il y a eu des opérations
  const totalOps = Object.values(syncCounters).reduce((sum, c) => {
    if (typeof c === 'object' && c.pulled !== undefined) {
      return sum + c.pulled + c.pushed;
    }
    return sum;
  }, 0);
  
  if (totalOps > 0 && SYNC_LOG_LEVEL >= 1) {
    baseSyncLogger.info(`📊 [SYNC SUMMARY] ${Math.round(elapsed/1000)}s | Products: ↓${syncCounters.products.pulled}/↑${syncCounters.products.pushed} | Sales: ↓${syncCounters.sales.pulled}/↑${syncCounters.sales.pushed} | Debts: ↓${syncCounters.debts.pulled}/↑${syncCounters.debts.pushed} | Errors: ${syncCounters.products.errors + syncCounters.sales.errors + syncCounters.debts.errors}`);
  }
  
  // Reset
  syncCounters.products = { pulled: 0, pushed: 0, errors: 0 };
  syncCounters.sales = { pulled: 0, pushed: 0, errors: 0 };
  syncCounters.debts = { pulled: 0, pushed: 0, errors: 0 };
  syncCounters.units = { pulled: 0, pushed: 0, errors: 0 };
  syncCounters.stock = { pulled: 0, pushed: 0, errors: 0 };
  syncCounters.lastResetTime = now;
}, 60000);

// Wrapper intelligent pour le syncLogger
export const syncLogger = {
  // Niveau 0: Erreurs critiques seulement (toujours affichées)
  error: (...args) => baseSyncLogger.error(...args),
  
  // Niveau 1: Avertissements importants
  warn: (...args) => {
    if (SYNC_LOG_LEVEL >= 1) baseSyncLogger.warn(...args);
  },
  
  // Niveau 2: Infos résumées (défaut)
  info: (...args) => {
    if (SYNC_LOG_LEVEL >= 2) baseSyncLogger.info(...args);
  },
  
  // Niveau 3: Debug détaillé
  debug: (...args) => {
    if (SYNC_LOG_LEVEL >= 3) baseSyncLogger.debug(...args);
  },
  
  // Niveau 3: Verbose (pour les logs détaillés par item)
  verbose: (...args) => {
    if (SYNC_LOG_LEVEL >= 3) baseSyncLogger.info(...args);
  },
  
  // Méthodes utilitaires pour les compteurs
  incrementPulled: (entity, count = 1) => {
    if (syncCounters[entity]) syncCounters[entity].pulled += count;
  },
  incrementPushed: (entity, count = 1) => {
    if (syncCounters[entity]) syncCounters[entity].pushed += count;
  },
  incrementErrors: (entity, count = 1) => {
    if (syncCounters[entity]) syncCounters[entity].errors += count;
  },
  
  // Afficher un résumé de section (niveau 1+)
  summary: (section, data) => {
    if (SYNC_LOG_LEVEL >= 1) {
      const msg = typeof data === 'string' ? data : JSON.stringify(data);
      baseSyncLogger.info(`📊 [${section}] ${msg}`);
    }
  },
  
  // Afficher une progression (niveau 2+)
  progress: (section, current, total, extra = '') => {
    if (SYNC_LOG_LEVEL >= 2) {
      baseSyncLogger.info(`⏳ [${section}] ${current}/${total} ${extra}`);
    }
  },
  
  // Afficher le début/fin d'une opération (niveau 2+)
  start: (section, message = '') => {
    if (SYNC_LOG_LEVEL >= 2) baseSyncLogger.info(`🚀 [${section}] START ${message}`);
  },
  end: (section, message = '', durationMs = null) => {
    if (SYNC_LOG_LEVEL >= 2) {
      const durStr = durationMs ? ` (${durationMs}ms)` : '';
      baseSyncLogger.info(`✅ [${section}] END ${message}${durStr}`);
    }
  },
  
  // Accès aux compteurs
  getCounters: () => ({ ...syncCounters }),
  
  // Accès au niveau de log
  getLevel: () => SYNC_LOG_LEVEL,
  
  // Vérifier si un niveau est actif
  isVerbose: () => SYNC_LOG_LEVEL >= 3,
  isSummary: () => SYNC_LOG_LEVEL >= 2,
  isMinimal: () => SYNC_LOG_LEVEL >= 1,
};

// Logger spécialisé pour l'impression
export const printLogger = winston.createLogger({
  level: "info",
  format: logFormat,
  defaultMeta: { service: "print" },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, "print.log"),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

