/**
 * Script de migration pour le module Dettes amélioré
 * 
 * Exécuter avec: node run-debts-migration.js
 * 
 * Ce script:
 * 1. Ajoute les nouvelles colonnes à la table debts (USD, items_json, etc.)
 * 2. Crée la table clients
 * 3. Crée la table debt_items
 * 4. Ajoute les colonnes USD à debt_payments
 * 5. Met à jour les triggers
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chemin vers la base de données (unifié C:\Glowflixprojet)
const DB_PATH = process.env.DB_PATH || (
  process.platform === 'win32' 
    ? 'C:\\Glowflixprojet\\db\\glowflixprojet.db'
    : path.join(process.env.HOME || __dirname, 'Glowflixprojet', 'db', 'glowflixprojet.db')
);

console.log('═'.repeat(80));
console.log('🔄 MIGRATION: Module Dettes Amélioré');
console.log('═'.repeat(80));
console.log(`📂 Base de données: ${DB_PATH}`);

// Vérifier que la base existe
if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Base de données non trouvée: ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

console.log('\n📋 Étape 1: Ajout des colonnes à la table debts...');

// Helper pour vérifier si une colonne existe
function columnExists(table, column) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  return info.some(col => col.name === column);
}

// Helper pour vérifier si une table existe
function tableExists(table) {
  const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  return !!result;
}

// 1. Ajouter colonnes à debts
const debtsNewColumns = [
  { name: 'client_uuid', type: 'TEXT' },
  { name: 'paid_usd', type: 'REAL NOT NULL DEFAULT 0' },
  { name: 'remaining_usd', type: 'REAL NOT NULL DEFAULT 0' },
  { name: 'items_json', type: 'TEXT' },
  { name: 'device_id', type: 'TEXT' }
];

for (const col of debtsNewColumns) {
  if (!columnExists('debts', col.name)) {
    try {
      db.exec(`ALTER TABLE debts ADD COLUMN ${col.name} ${col.type}`);
      console.log(`   ✅ Colonne debts.${col.name} ajoutée`);
    } catch (e) {
      console.log(`   ⚠️ debts.${col.name}: ${e.message}`);
    }
  } else {
    console.log(`   ℹ️ debts.${col.name} existe déjà`);
  }
}

console.log('\n📋 Étape 2: Création de la table clients...');

if (!tableExists('clients')) {
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      client_code TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      note TEXT,
      user_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      device_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
  console.log('   ✅ Table clients créée');
  
  // Index
  db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_code ON clients(client_code)`);
  console.log('   ✅ Index clients créés');
} else {
  console.log('   ℹ️ Table clients existe déjà');
}

console.log('\n📋 Étape 3: Création de la table debt_items...');

if (!tableExists('debt_items')) {
  db.exec(`
    CREATE TABLE debt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      debt_id INTEGER NOT NULL,
      product_uuid TEXT,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      unit_level TEXT,
      unit_mark TEXT,
      qty REAL NOT NULL DEFAULT 1,
      unit_price_usd REAL NOT NULL DEFAULT 0,
      line_total_usd REAL NOT NULL DEFAULT 0,
      unit_price_fc REAL NOT NULL DEFAULT 0,
      line_total_fc REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(debt_id) REFERENCES debts(id) ON DELETE CASCADE,
      FOREIGN KEY(product_uuid) REFERENCES products(uuid)
    )
  `);
  console.log('   ✅ Table debt_items créée');
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_debt_items_debt ON debt_items(debt_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_debt_items_product ON debt_items(product_uuid)`);
  console.log('   ✅ Index debt_items créés');
} else {
  console.log('   ℹ️ Table debt_items existe déjà');
}

console.log('\n📋 Étape 4: Ajout des colonnes à debt_payments...');

const paymentsNewColumns = [
  { name: 'uuid', type: 'TEXT' },
  { name: 'amount_usd', type: 'REAL NOT NULL DEFAULT 0' },
  { name: 'rate_fc_per_usd', type: 'REAL NOT NULL DEFAULT 2800' },
  { name: 'note', type: 'TEXT' },
  { name: 'device_id', type: 'TEXT' }
];

for (const col of paymentsNewColumns) {
  if (!columnExists('debt_payments', col.name)) {
    try {
      db.exec(`ALTER TABLE debt_payments ADD COLUMN ${col.name} ${col.type}`);
      console.log(`   ✅ Colonne debt_payments.${col.name} ajoutée`);
    } catch (e) {
      console.log(`   ⚠️ debt_payments.${col.name}: ${e.message}`);
    }
  } else {
    console.log(`   ℹ️ debt_payments.${col.name} existe déjà`);
  }
}

// Index pour les paiements par date
db.exec(`CREATE INDEX IF NOT EXISTS idx_debt_payments_date ON debt_payments(date(paid_at))`);
console.log('   ✅ Index idx_debt_payments_date créé');

console.log('\n📋 Étape 5: Mise à jour des données existantes...');

// Calculer les valeurs USD pour les dettes existantes qui n'ont pas de total_usd
const rate = 2800;
const debtsToUpdate = db.prepare(`
  SELECT id, total_fc, paid_fc, remaining_fc 
  FROM debts 
  WHERE (total_usd IS NULL OR total_usd = 0) AND total_fc > 0
`).all();

if (debtsToUpdate.length > 0) {
  const updateStmt = db.prepare(`
    UPDATE debts SET
      total_usd = ?,
      paid_usd = ?,
      remaining_usd = ?
    WHERE id = ?
  `);
  
  for (const debt of debtsToUpdate) {
    const totalUsd = Math.round((debt.total_fc / rate) * 100) / 100;
    const paidUsd = Math.round((debt.paid_fc / rate) * 100) / 100;
    const remainingUsd = Math.round((debt.remaining_fc / rate) * 100) / 100;
    
    updateStmt.run(totalUsd, paidUsd, remainingUsd, debt.id);
  }
  
  console.log(`   ✅ ${debtsToUpdate.length} dette(s) mise(s) à jour avec valeurs USD`);
} else {
  console.log('   ℹ️ Aucune dette à mettre à jour');
}

// Mettre à jour les paiements existants sans amount_usd
const paymentsToUpdate = db.prepare(`
  SELECT id, amount_fc 
  FROM debt_payments 
  WHERE (amount_usd IS NULL OR amount_usd = 0) AND amount_fc > 0
`).all();

if (paymentsToUpdate.length > 0) {
  const updatePaymentStmt = db.prepare(`
    UPDATE debt_payments SET
      amount_usd = ?,
      rate_fc_per_usd = ?
    WHERE id = ?
  `);
  
  for (const payment of paymentsToUpdate) {
    const amountUsd = Math.round((payment.amount_fc / rate) * 100) / 100;
    updatePaymentStmt.run(amountUsd, rate, payment.id);
  }
  
  console.log(`   ✅ ${paymentsToUpdate.length} paiement(s) mis à jour avec valeurs USD`);
} else {
  console.log('   ℹ️ Aucun paiement à mettre à jour');
}

console.log('\n📋 Étape 6: Création des index supplémentaires...');

db.exec(`CREATE INDEX IF NOT EXISTS idx_debts_client_uuid ON debts(client_uuid)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_debts_status_created ON debts(status, created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_debts_created_at ON debts(created_at)`);
console.log('   ✅ Index debts créés');

console.log('\n📋 Étape 7: Mise à jour des triggers...');

// Trigger pour updated_at sur clients
db.exec(`
  DROP TRIGGER IF EXISTS trg_clients_updated_at;
  CREATE TRIGGER trg_clients_updated_at
  AFTER UPDATE ON clients
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE clients SET updated_at = datetime('now') WHERE id = NEW.id;
  END;
`);
console.log('   ✅ Trigger trg_clients_updated_at créé');

console.log('\n═'.repeat(80));
console.log('✅ MIGRATION TERMINÉE AVEC SUCCÈS');
console.log('═'.repeat(80));

// Afficher les statistiques
const stats = {
  debts: db.prepare('SELECT COUNT(*) as count FROM debts').get().count,
  debtsWithUsd: db.prepare('SELECT COUNT(*) as count FROM debts WHERE total_usd > 0').get().count,
  payments: db.prepare('SELECT COUNT(*) as count FROM debt_payments').get().count,
  clients: tableExists('clients') ? db.prepare('SELECT COUNT(*) as count FROM clients').get().count : 0,
  debtItems: tableExists('debt_items') ? db.prepare('SELECT COUNT(*) as count FROM debt_items').get().count : 0
};

console.log('\n📊 Statistiques:');
console.log(`   Dettes totales: ${stats.debts}`);
console.log(`   Dettes avec USD: ${stats.debtsWithUsd}`);
console.log(`   Paiements: ${stats.payments}`);
console.log(`   Clients: ${stats.clients}`);
console.log(`   Items de dette: ${stats.debtItems}`);

db.close();
console.log('\n✅ Base de données fermée');
