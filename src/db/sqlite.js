import Database from 'better-sqlite3';
import { getDbPath, ensureDirs } from '../core/paths.js';
import { logger } from '../core/logger.js';
import fs from 'fs';
import path from 'path';

let db = null;

/**
 * Initialise et retourne la connexion SQLite
 */
export function getDb() {
  if (db) {
    return db;
  }

  try {
    // S'assurer que les dossiers existent
    ensureDirs();
    
    const dbPath = getDbPath();
    const dbDir = path.dirname(dbPath);
    
    // Créer le dossier si nécessaire
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Ouvrir la base de données
    db = new Database(dbPath);
    
    // Activer les clés étrangères
    db.pragma('foreign_keys = ON');
    
    // Activer WAL mode pour les accès concurrents
    db.pragma('journal_mode = WAL');
    
    logger.info(`Base de données SQLite connectée: ${dbPath}`);
    
    return db;
  } catch (error) {
    logger.error('Erreur connexion SQLite:', error);
    throw error;
  }
}

/**
 * Ferme la connexion SQLite
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
    logger.info('Base de données SQLite fermée');
  }
}

/**
 * Exécute une migration SQL
 */
export function runMigration(sql) {
  const database = getDb();
  try {
    database.exec(sql);
    logger.info('Migration exécutée avec succès');
    return true;
  } catch (error) {
    logger.error('Erreur migration:', error);
    throw error;
  }
}

/**
 * Initialise le schéma de la base de données
 */
export function initSchema() {
  const database = getDb();
  const schemaPath = path.join(process.cwd(), 'src/db/schema.sql');
  
  try {
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      database.exec(schema);
      logger.info('Schéma de base de données initialisé');
    } else {
      logger.warn('Fichier schema.sql non trouvé');
    }
  } catch (error) {
    logger.error('Erreur initialisation schéma:', error);
    throw error;
  }
}

// Fermer proprement à la fin du processus
process.on('exit', () => {
  closeDb();
});

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});

