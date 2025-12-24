import fs from "fs";
import path from "path";
import os from "os";

/**
 * Retourne le répertoire racine du projet Glowflixprojet
 * Windows default: C:\Glowflixprojet
 * Sinon: ~/Glowflixprojet
 */
export function getProjectRoot() {
  // Windows default, sinon fallback user home
  const winDefault = "C:\\Glowflixprojet";
  return process.env.GLOWFLIX_ROOT_DIR
    ? path.resolve(process.env.GLOWFLIX_ROOT_DIR)
    : (process.platform === "win32" ? winDefault : path.join(os.homedir(), "Glowflixprojet"));
}

/**
 * Crée automatiquement toute l'arborescence nécessaire
 * @returns {string} Le chemin racine créé
 */
export function ensureDirs() {
  const root = getProjectRoot();
  const dirs = [
    "db", 
    "db/migrations",
    "data/cache", 
    "data/imports", 
    "data/exports", 
    "data/backups", 
    "data/attachments",
    "printer/ok", 
    "printer/err", 
    "printer/tmp", 
    "printer/assets", 
    "printer/templates",
    "logs", 
    "config"
  ];
  
  for (const d of dirs) {
    const fullPath = path.join(root, d);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
  
  return root;
}

/**
 * Retourne le chemin de la base de données
 */
export function getDbPath() {
  const root = getProjectRoot();
  return path.join(root, "db", "glowflixprojet.db");
}

/**
 * Retourne le chemin du répertoire d'impression
 */
export function getPrintDir() {
  return process.env.GLOWFLIX_PRINT_DIR 
    ? path.resolve(process.env.GLOWFLIX_PRINT_DIR)
    : path.join(getProjectRoot(), "printer");
}

/**
 * Retourne le chemin des logs
 */
export function getLogsDir() {
  return path.join(getProjectRoot(), "logs");
}

/**
 * Retourne le chemin de configuration
 */
export function getConfigDir() {
  return path.join(getProjectRoot(), "config");
}

