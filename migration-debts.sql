-- =========================
-- MIGRATION: Module Dettes Amélioré v2.0
-- =========================
-- Exécuter ce script manuellement dans SQLite
-- sqlite3 C:\Glowflixprojet\db\glowflixprojet.db < migration-debts.sql
-- =========================

-- =========================
-- 1. TABLE CLIENTS
-- =========================
CREATE TABLE IF NOT EXISTS clients (
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
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_code ON clients(client_code);

-- =========================
-- 2. TABLE debt_items
-- =========================
CREATE TABLE IF NOT EXISTS debt_items (
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
);

CREATE INDEX IF NOT EXISTS idx_debt_items_debt ON debt_items(debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_items_product ON debt_items(product_uuid);

-- =========================
-- 3. INDEX SUPPLÉMENTAIRES POUR PERFORMANCE
-- =========================
CREATE INDEX IF NOT EXISTS idx_debts_client_uuid ON debts(client_uuid);
CREATE INDEX IF NOT EXISTS idx_debts_status_created ON debts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_debts_created_at ON debts(created_at);
CREATE INDEX IF NOT EXISTS idx_debt_payments_date ON debt_payments(date(paid_at));

-- =========================
-- 4. TRIGGER: updated_at sur clients
-- =========================
DROP TRIGGER IF EXISTS trg_clients_updated_at;
CREATE TRIGGER trg_clients_updated_at
AFTER UPDATE ON clients
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE clients SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =========================
-- VÉRIFICATION
-- =========================
SELECT 'Tables créées:' as info;
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('clients', 'debt_items');

SELECT 'Index créés:' as info;
SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_clients%' OR name LIKE 'idx_debt%';
