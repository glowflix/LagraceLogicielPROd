/**
 * src/main/init.js
 * Initialisation complète au démarrage Electron
 * Crée structure, ouvert DB, loggers, etc.
 */

import { initializePaths, getPaths } from "./paths.js";
import { initializeLoggers, mainLogger } from "./logger.js";
import { initializeTemplateManager } from "./templateManager.js";
import path from "node:path";
import { app } from "electron";

export async function initializeApp(embeddedResourcesPath) {
  try {
    mainLogger.info("🚀 Initialisation Glowflixprojet...");

    // 1. Chemin données
    const paths = initializePaths();
    mainLogger.info(`📁 Racine données: ${paths.root}`);

    // 2. Loggers
    initializeLoggers();
    mainLogger.info("📝 Loggers prêts");

    // 3. Base de données (optionnelle en Electron)
    let db = null;
    try {
      const dbModule = await import("./db.js");
      db = dbModule.openDb();
      dbModule.initializeSchema();
      mainLogger.info(`💾 BD initialisée: ${paths.dbFile}`);
    } catch (dbError) {
      mainLogger.warn(`⚠️ BD Electron indisponible (utilisation du backend HTTP): ${dbError.message}`);
      console.warn("DB Electron error (using HTTP backend instead):", dbError.message);
    }

    // 4. Templates modifiables
    const embeddedTemplates = path.join(embeddedResourcesPath, "templates", "print");
    initializeTemplateManager(embeddedTemplates);
    mainLogger.info("📄 Template manager prêt");

    // 5. Logs cleanup (toutes les 12h)
    setInterval(() => {
      mainLogger.cleanupOldLogs();
    }, 12 * 60 * 60 * 1000);

    mainLogger.info("✓ Application initialisée avec succès");

    return {
      paths,
      db,
    };
  } catch (error) {
    console.error("❌ INIT ERROR:", error);
    mainLogger.error("INIT ERROR", error);
    throw error;
  }
}

export async function shutdownApp() {
  mainLogger.info("🛑 Arrêt Glowflixprojet...");
  try {
    const dbModule = await import("./db.js");
    dbModule.closeDb();
  } catch (e) {
    // DB non disponible, c'est OK
  }
  mainLogger.info("✓ Arrêt normal");
}
