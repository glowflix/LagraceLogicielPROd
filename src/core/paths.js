import fs from "fs";
import path from "path";
import os from "os";

export function getDataRoot() {
  // PRIORITÉ 1: Variable d'environnement explicite
  if (process.env.LAGRACE_DATA_DIR) return path.resolve(process.env.LAGRACE_DATA_DIR);
  if (process.env.GLOWFLIX_ROOT_DIR) return path.resolve(process.env.GLOWFLIX_ROOT_DIR);

  // PRIORITÉ 2: Détection automatique selon le mode (build vs dev)
  // ✅ EN MODE EXE INSTALLÉ: Utiliser %APPDATA%\Glowflixprojet (utilisateur-spécifique)
  // ✅ EN DEV: Utiliser C:\Glowflixprojet (dossier commun)
  // La différence: AppData = installé pour l'utilisateur, C:\ = partagé
  if (process.platform === "win32") {
    // Chercher AppData (Roaming de préférence)
    const appDataRoaming = process.env.APPDATA; // %APPDATA% = AppData\Roaming
    if (appDataRoaming) {
      // CRITIQUE: En build, toujours utiliser AppData
      // Vérifier si on est en mode "packaged" (electron) ou dev
      const isPackaged = process.env.NODE_ENV === 'production' || 
                         process.defaultApp === false ||
                         (process.mainModule && process.mainModule.filename.indexOf('app.asar') !== -1);
      
      // En production (exe), TOUJOURS utiliser AppData
      if (isPackaged || process.env.NODE_ENV === 'production') {
        return path.join(appDataRoaming, "Glowflixprojet");
      }
      
      // En dev, utiliser C:\ si le dossier existe déjà, sinon AppData aussi
      const devPath = "C:\\Glowflixprojet";
      if (fs.existsSync(devPath)) {
        return devPath;
      }
      
      // Sinon, utiliser AppData même en dev (cohérence)
      return path.join(appDataRoaming, "Glowflixprojet");
    }
    // Fallback si APPDATA pas défini (rare mais possible)
    return "C:\\Glowflixprojet";
  }
  
  return path.join(os.homedir(), "Glowflixprojet");
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

  console.log('📁 [PATHS] ==========================================');
  console.log('📁 [PATHS] CRÉATION DES DOSSIERS SYSTÈME');
  console.log('📁 [PATHS] ==========================================');
  console.log(`📁 [PATHS] Root: ${root}`);
  console.log(`📁 [PATHS] Platform: ${process.platform}`);
  console.log(`📁 [PATHS] NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 [PATHS] APPDATA: ${process.env.APPDATA || '(non défini)'}`);

  for (const d of dirs) {
    const fullPath = path.join(root, d);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`✅ [PATHS] Créé: ${d}`);
    }
  }
  
  console.log(`✅ [PATHS] Tous les dossiers sont prêts`);
  console.log('📁 [PATHS] ==========================================');
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

