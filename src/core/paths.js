import fs from "fs";
import path from "path";
import os from "os";

export function getDataRoot() {
  if (process.env.LAGRACE_DATA_DIR) return path.resolve(process.env.LAGRACE_DATA_DIR);
  if (process.env.GLOWFLIX_ROOT_DIR) return path.resolve(process.env.GLOWFLIX_ROOT_DIR);

  const winDefault = "C:\\Glowflixprojet";
  return process.platform === "win32"
    ? winDefault
    : path.join(os.homedir(), "Glowflixprojet");
}

export function getResourcesRoot() {
  if (process.env.RESOURCES_ROOT) return path.resolve(process.env.RESOURCES_ROOT);
  if (process.env.APP_ROOT) return path.resolve(process.env.APP_ROOT);
  return process.cwd();
}

// ✅ compat: l'ancien nom doit pointer vers DATA (écriture)
export function getProjectRoot() {
  return getDataRoot();
}

export function ensureDirs() {
  const root = getDataRoot();
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
    "config",
  ];

  for (const d of dirs) {
    const fullPath = path.join(root, d);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
  }
  return root;
}

export function getDbPath() {
  return path.join(getDataRoot(), "db", "glowflixprojet.db");
}

export function getPrintDir() {
  if (process.env.GLOWFLIX_PRINT_DIR) return path.resolve(process.env.GLOWFLIX_PRINT_DIR);
  return path.join(getDataRoot(), "printer");
}

export function getLogsDir() {
  return path.join(getDataRoot(), "logs");
}

export function getConfigDir() {
  return path.join(getDataRoot(), "config");
}

