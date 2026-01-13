/**
 * ============================================================
 * LA GRACE POS - Chemins UNIFIÉS (DEV + EXE identiques)
 * ============================================================
 * CHEMIN UNIQUE: C:\Glowflixprojet
 * - DB: C:\Glowflixprojet\db\glowflixprojet.db
 * - Print: C:\Glowflixprojet\printer\
 * - Logs: C:\Glowflixprojet\logs\
 * ============================================================
 */

import fs from "fs";
import path from "path";
import os from "os";

// ✅ CHEMIN FIXE UNIQUE - Identique DEV et EXE
const FIXED_DATA_ROOT = "C:\\Glowflixprojet";

function ensureDir(p) {
  try {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * ✅ Retourne TOUJOURS C:\Glowflixprojet sur Windows
 * Identique en DEV et EXE - Plus de confusion de chemins
 */
export function getDataRoot() {
  if (process.platform === "win32") {
    // Créer si n'existe pas
    if (!fs.existsSync(FIXED_DATA_ROOT)) {
      try {
        fs.mkdirSync(FIXED_DATA_ROOT, { recursive: true });
      } catch (e) {
        // Fallback APPDATA seulement si C:\ bloqué
        const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        const fallback = path.join(appData, "LA GRACE POS");
        ensureDir(fallback);
        return fallback;
      }
    }
    return FIXED_DATA_ROOT;
  }
  
  // Linux/Mac
  const homePath = path.join(os.homedir(), "Glowflixprojet");
  ensureDir(homePath);
  return homePath;
}

export function getResourcesRoot() {
  if (process.env.RESOURCES_ROOT) return path.resolve(process.env.RESOURCES_ROOT);
  if (process.env.APP_ROOT) return path.resolve(process.env.APP_ROOT);
  return process.cwd();
}

export function getAppRoot() {
  if (process.env.APP_ROOT) return path.resolve(process.env.APP_ROOT);
  return process.cwd();
}

export function getProjectRoot() {
  return getDataRoot();
}

export function ensureDirs() {
  const root = getDataRoot();
  const dirs = [
    "db",
    "printer",
    "printer/ok",
    "printer/err",
    "printer/tmp",
    "printer/templates",
    "printer/assets",
    "logs",
    "config",
    "data/cache",
    "data/imports",
    "data/exports",
    "data/backups",
  ];

  // ✅ PRO: Création silencieuse des dossiers
  for (const d of dirs) {
    const fullPath = path.join(root, d);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
  
  return root;
}

export function getDbPath() {
  const dbDir = path.join(getDataRoot(), "db");
  ensureDir(dbDir);
  return path.join(dbDir, "glowflixprojet.db");
}

export function getPrintDir() {
  const printDir = path.join(getDataRoot(), "printer");
  const subDirs = ["", "ok", "err", "tmp", "templates", "assets"];
  for (const sub of subDirs) {
    const dir = sub ? path.join(printDir, sub) : printDir;
    ensureDir(dir);
  }
  return printDir;
}

export function getLogsDir() {
  const logsDir = path.join(getDataRoot(), "logs");
  ensureDir(logsDir);
  return logsDir;
}

export function getConfigDir() {
  const configDir = path.join(getDataRoot(), "config");
  ensureDir(configDir);
  return configDir;
}

