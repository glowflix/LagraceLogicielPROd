import Database from "better-sqlite3";
import { getPaths } from "./paths.js";
import fs from "node:fs";
import path from "node:path";

let dbInstance = null;

/**
 * Ouvre ou retourne la connexion SQLite
 * @returns {Database}
 */
export function openDb() {
  if (dbInstance) return dbInstance;

  const { dbFile, dbBackupsDir } = getPaths();

  try {
    const db = new Database(dbFile);

    // Pragmas optimisés
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -64000"); // 64MB
    db.pragma("temp_store = MEMORY");

    // Logs activés
    db.pragma("foreign_keys = ON");

    console.log(`✓ SQLite: ${dbFile}`);
    dbInstance = db;
    return db;
  } catch (err) {
    console.error(`❌ Erreur ouverture BD:`, err);
    throw err;
  }
}

/**
 * Ferme la connexion DB
 */
export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Crée une sauvegarde de la BD
 * @returns {string} chemin de la sauvegarde
 */
export function backupDb() {
  const db = openDb();
  const { dbFile, dbBackupsDir } = getPaths();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(dbBackupsDir, `lagrace_${timestamp}.sqlite`);

  try {
    const backup = new Database(backupPath);
    db.exec(`VACUUM INTO '${backupPath}'`);
    backup.close();
    console.log(`✓ Backup BD: ${backupPath}`);
    return backupPath;
  } catch (err) {
    console.error(`❌ Erreur backup BD:`, err);
    throw err;
  }
}

/**
 * Initialise le schéma BD (tables de base)
 */
export function initializeSchema() {
  const db = openDb();

  // Table des paramètres (config, IA, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Table des articles/produits
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      price REAL,
      quantity INTEGER DEFAULT 0,
      createdAt INTEGER DEFAULT (strftime('%s', 'now')),
      updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Table des clients
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      createdAt INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Table des factures
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY,
      uuid TEXT UNIQUE NOT NULL,
      customerId INTEGER,
      totalAmount REAL,
      status TEXT DEFAULT 'pending',
      pdfPath TEXT,
      createdAt INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (customerId) REFERENCES customers(id)
    );
  `);

  // Table d'historique d'impressions
  db.exec(`
    CREATE TABLE IF NOT EXISTS print_history (
      id INTEGER PRIMARY KEY,
      jobId TEXT UNIQUE NOT NULL,
      documentType TEXT,
      status TEXT,
      attemptCount INTEGER DEFAULT 0,
      lastAttemptAt INTEGER,
      completedAt INTEGER,
      errorMsg TEXT
    );
  `);

  console.log(`✓ Schéma BD initialisé`);
}

/**
 * Récupère/définit un paramètre
 */
export function getSetting(key, defaultValue = null) {
  const db = openDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : defaultValue;
}

export function setSetting(key, value) {
  const db = openDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

export { dbInstance };
