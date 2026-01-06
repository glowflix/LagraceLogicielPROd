import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const DATA_ROOT_WIN = "C:\\Glowflixprojet";

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (err) {
    console.warn(`⚠️  Impossible de créer ${p}:`, err.message);
  }
}

function canWrite(dir) {
  try {
    ensureDir(dir);
    const test = path.join(dir, ".write_test_" + Date.now());
    fs.writeFileSync(test, "ok");
    fs.unlinkSync(test);
    return true;
  } catch (err) {
    console.warn(`❌ ${dir} pas accessible:`, err.message);
    return false;
  }
}

export function getDataRoot() {
  // ✅ PRIORITÉ 1: Variable d'environnement LAGRACE_DATA_DIR (définie par Electron main.cjs)
  if (process.env.LAGRACE_DATA_DIR) {
    const dataDir = path.resolve(process.env.LAGRACE_DATA_DIR);
    console.log(`✅ [PATHS-ELECTRON] Utilisation LAGRACE_DATA_DIR: ${dataDir}`);
    ensureDir(dataDir);
    return dataDir;
  }
  
  // ✅ PRIORITÉ 2: app.getPath('userData') en mode EXE/production
  const isPackaged = 
    process.env.LAGRACE_IS_ELECTRON === '1' ||
    process.env.NODE_ENV === 'production' ||
    app.isPackaged;
    
  if (isPackaged) {
    const userData = app.getPath('userData');
    console.log(`✅ [PATHS-ELECTRON] Mode PRODUCTION: ${userData}`);
    ensureDir(userData);
    return userData;
  }
  
  // ✅ PRIORITÉ 3 (DEV): Si Windows ET C:\Glowflixprojet accessible → on l'utilise
  if (process.platform === "win32" && canWrite(DATA_ROOT_WIN)) {
    console.log(`✅ [PATHS-ELECTRON] Mode DEV: ${DATA_ROOT_WIN}`);
    return DATA_ROOT_WIN;
  }

  // Fallback si C:\ bloqué (sécurité)
  const fallback = path.join(app.getPath("localAppData"), "Glowflixprojet");
  console.log(`⚠️  [PATHS-ELECTRON] Fallback vers: ${fallback}`);
  ensureDir(fallback);
  return fallback;
}

export function getPaths() {
  const root = getDataRoot();
  const printer = path.join(root, "printer");
  const db = path.join(root, "db");
  const cache = path.join(root, "cache");
  const logs = path.join(root, "logs");

  const paths = {
    // Racine données
    root,

    // Database
    dbDir: db,
    dbFile: path.join(db, "lagrace.sqlite"),
    dbBackupsDir: path.join(db, "backups"),
    dbMigrationsDir: path.join(db, "migrations"),

    // Impression (Job System)
    printerDir: printer,
    printerAssets: path.join(printer, "assets"),
    printerTemplates: path.join(printer, "templates"),
    printerTmp: path.join(printer, "tmp"),      // Jobs en cours
    printerOk: path.join(printer, "ok"),        // Jobs succès
    printerErr: path.join(printer, "err"),      // Jobs erreur

    // Cache
    cacheDir: cache,
    cacheHttp: path.join(cache, "http"),
    cacheImages: path.join(cache, "images"),
    cacheAi: path.join(cache, "ai"),

    // Logs
    logsDir: logs,
  };

  // Créer tous les dossiers
  const dirPaths = [
    paths.dbDir,
    paths.dbBackupsDir,
    paths.dbMigrationsDir,
    paths.printerDir,
    paths.printerAssets,
    paths.printerTemplates,
    paths.printerTmp,
    paths.printerOk,
    paths.printerErr,
    paths.cacheDir,
    paths.cacheHttp,
    paths.cacheImages,
    paths.cacheAi,
    paths.logsDir,
  ];

  dirPaths.forEach((p) => ensureDir(p));

  return paths;
}

// Initialisation au démarrage Electron
export function initializePaths() {
  const paths = getPaths();
  console.log(`📁 Répertoire données: ${paths.root}`);
  return paths;
}
