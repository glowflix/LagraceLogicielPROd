import Database from 'better-sqlite3';
import { getDbPath, ensureDirs } from '../core/paths.js';
import { logger } from '../core/logger.js';
import { generateUUID } from '../core/crypto.js';
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
    
    // PRAGMA critiques pour comportement PRO (cohérence + performance)
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    
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
 * Vérifie si une colonne existe dans une table
 */
export function columnExists(tableName, columnName) {
  const database = getDb();
  try {
    const result = database.prepare(`
      SELECT COUNT(*) as count 
      FROM pragma_table_info(?) 
      WHERE name = ?
    `).get(tableName, columnName);
    return result.count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Assure qu'une colonne existe dans une table (ajoute si manquante)
 * @param {string} tableName - Nom de la table
 * @param {string} columnName - Nom de la colonne
 * @param {string} columnType - Type SQL (TEXT, REAL, INTEGER, etc.)
 * @returns {boolean} true si la colonne a été ajoutée, false si elle existait déjà
 */
export function ensureColumn(tableName, columnName, columnType = 'TEXT') {
  const database = getDb();
  try {
    if (columnExists(tableName, columnName)) {
      logger.debug(`[MIGRATION] Colonne ${tableName}.${columnName} existe déjà`);
      return false;
    }
    
    logger.info(`[MIGRATION] Ajout de la colonne ${columnName} (${columnType}) à la table ${tableName}...`);
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
    logger.info(`✅ [MIGRATION] Colonne ${tableName}.${columnName} ajoutée avec succès`);
    return true;
  } catch (error) {
    // Ignorer l'erreur si la colonne existe déjà (race condition)
    if (error.message.includes('duplicate column') || error.message.includes('already exists')) {
      logger.debug(`[MIGRATION] Colonne ${tableName}.${columnName} existe déjà (ignoré)`);
      return false;
    }
    logger.error(`[MIGRATION] Erreur ajout colonne ${tableName}.${columnName}:`, error);
    throw error;
  }
}

/**
 * Applique les migrations nécessaires (ajout de colonnes manquantes)
 */
function applyMigrations() {
  const database = getDb();
  try {
    logger.info('[MIGRATION] Vérification des migrations nécessaires...');
    
    // Migrations pour la table products
    const productsUuidAdded = ensureColumn('products', 'uuid', 'TEXT');
    
    // Migrations pour la table product_units
    const unitsUuidAdded = ensureColumn('product_units', 'uuid', 'TEXT');
    
    // Migrations pour la table debts
    ensureColumn('debts', 'uuid', 'TEXT');
    ensureColumn('debts', 'client_phone', 'TEXT');
    ensureColumn('debts', 'product_description', 'TEXT'); // CRITIQUE: manquante dans les anciennes bases
    ensureColumn('debts', 'total_usd', 'REAL');
    ensureColumn('debts', 'debt_fc_in_usd', 'REAL');
    ensureColumn('debts', 'note', 'TEXT');
    ensureColumn('debts', 'synced_at', 'TEXT');
    
    // Générer des UUIDs pour les produits existants qui n'en ont pas
    if (productsUuidAdded || columnExists('products', 'uuid')) {
      try {
        const productsWithoutUuid = database.prepare('SELECT id FROM products WHERE uuid IS NULL OR uuid = ""').all();
        
        if (productsWithoutUuid.length > 0) {
          logger.info(`[MIGRATION] Génération de ${productsWithoutUuid.length} UUID(s) pour les produits existants...`);
          const updateStmt = database.prepare('UPDATE products SET uuid = ? WHERE id = ?');
          
          for (const product of productsWithoutUuid) {
            const uuid = generateUUID();
            updateStmt.run(uuid, product.id);
          }
          
          logger.info(`[MIGRATION] ✅ ${productsWithoutUuid.length} UUID(s) généré(s) pour les produits`);
        }
      } catch (error) {
        logger.warn('[MIGRATION] Erreur génération UUIDs produits:', error.message);
      }
    }
    
    // Générer des UUIDs pour les unités existantes qui n'en ont pas
    if (unitsUuidAdded || columnExists('product_units', 'uuid')) {
      try {
        const unitsWithoutUuid = database.prepare('SELECT id FROM product_units WHERE uuid IS NULL OR uuid = ""').all();
        
        if (unitsWithoutUuid.length > 0) {
          logger.info(`[MIGRATION] Génération de ${unitsWithoutUuid.length} UUID(s) pour les unités existantes...`);
          const updateStmt = database.prepare('UPDATE product_units SET uuid = ? WHERE id = ?');
          
          for (const unit of unitsWithoutUuid) {
            const uuid = generateUUID();
            updateStmt.run(uuid, unit.id);
          }
          
          logger.info(`[MIGRATION] ✅ ${unitsWithoutUuid.length} UUID(s) généré(s) pour les unités`);
        }
      } catch (error) {
        logger.warn('[MIGRATION] Erreur génération UUIDs unités:', error.message);
      }
    }
    
    // Créer les index uniques sur uuid si les colonnes existent
    try {
      if (columnExists('products', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_uuid ON products(uuid) WHERE uuid IS NOT NULL');
      }
      if (columnExists('product_units', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_uuid ON product_units(uuid) WHERE uuid IS NOT NULL');
      }
      if (columnExists('debts', 'uuid')) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_uuid ON debts(uuid) WHERE uuid IS NOT NULL');
      }
    } catch (error) {
      // Ignorer si l'index existe déjà
      if (!error.message.includes('already exists')) {
        logger.warn('[MIGRATION] Erreur création index uuid:', error.message);
      }
    }
    
    logger.info('[MIGRATION] ✅ Toutes les migrations appliquées avec succès');
  } catch (error) {
    logger.error('[MIGRATION] ❌ Erreur lors des migrations:', error);
    // Ne pas bloquer l'application si migration échoue (colonne peut exister)
    if (!error.message.includes('duplicate column') && !error.message.includes('already exists')) {
      logger.warn('[MIGRATION] ⚠️  Migration partielle, certaines colonnes peuvent être manquantes');
    }
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
    
    // Appliquer les migrations après l'initialisation du schéma
    applyMigrations();
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

