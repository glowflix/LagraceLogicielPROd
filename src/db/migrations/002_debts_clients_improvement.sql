-- =========================
-- MIGRATION: Amélioration module Ventes/Dettes/Clients
-- Version: 2.0.0
-- Date: 2026-01-05
-- =========================

-- =========================
-- TABLE CLIENTS (nouvelle)
-- =========================
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  client_code TEXT UNIQUE,            -- Code client unique (CLI-YYYYMMDD-XXX)
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  note TEXT,
  user_id INTEGER,                    -- Lien optionnel vers table users
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
-- MODIFICATION TABLE debts: Ajouter colonnes USD
-- =========================
-- Ajouter client_uuid si n'existe pas
ALTER TABLE debts ADD COLUMN client_uuid TEXT REFERENCES clients(uuid);

-- Ajouter colonnes USD comme référence (FC devient secondaire)
ALTER TABLE debts ADD COLUMN paid_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE debts ADD COLUMN remaining_usd REAL NOT NULL DEFAULT 0;

-- Ajouter colonnes pour tracking items
ALTER TABLE debts ADD COLUMN items_json TEXT;  -- JSON des items de la dette

-- Ajouter device_id pour offline-first
ALTER TABLE debts ADD COLUMN device_id TEXT;

-- =========================
-- MODIFICATION TABLE debt_payments: Ajouter colonnes USD
-- =========================
ALTER TABLE debt_payments ADD COLUMN uuid TEXT UNIQUE;
ALTER TABLE debt_payments ADD COLUMN amount_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE debt_payments ADD COLUMN rate_fc_per_usd REAL NOT NULL DEFAULT 2800;
ALTER TABLE debt_payments ADD COLUMN note TEXT;
ALTER TABLE debt_payments ADD COLUMN device_id TEXT;

-- Index pour requêtes par date (statistiques du jour)
CREATE INDEX IF NOT EXISTS idx_debt_payments_date ON debt_payments(date(paid_at));
CREATE INDEX IF NOT EXISTS idx_debt_payments_uuid ON debt_payments(uuid);

-- =========================
-- TABLE debt_items (items d'une dette - optionnel, plus propre que JSON)
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
-- TRIGGER: Mise à jour client_uuid auto sur debts
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_debts_client_uuid
AFTER INSERT ON debts
WHEN NEW.client_uuid IS NULL AND NEW.client_name IS NOT NULL
BEGIN
  UPDATE debts 
  SET client_uuid = (
    SELECT uuid FROM clients 
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.client_name)) 
    LIMIT 1
  )
  WHERE id = NEW.id;
END;

-- =========================
-- TRIGGER: Auto-calcul remaining_usd sur debts
-- =========================
DROP TRIGGER IF EXISTS trg_debts_calc_usd_ai;
CREATE TRIGGER IF NOT EXISTS trg_debts_calc_usd_ai
AFTER INSERT ON debts
BEGIN
  UPDATE debts
  SET 
    remaining_usd = CASE
      WHEN NEW.total_usd - NEW.paid_usd < 0 THEN 0
      ELSE (NEW.total_usd - NEW.paid_usd)
    END,
    remaining_fc = CASE
      WHEN NEW.total_fc - NEW.paid_fc < 0 THEN 0
      ELSE (NEW.total_fc - NEW.paid_fc)
    END,
    status = CASE
      WHEN NEW.paid_usd <= 0 AND NEW.paid_fc <= 0 THEN 'open'
      WHEN NEW.paid_usd >= NEW.total_usd OR NEW.paid_fc >= NEW.total_fc THEN 'paid'
      ELSE 'partial'
    END
  WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_debts_calc_usd_au;
CREATE TRIGGER IF NOT EXISTS trg_debts_calc_usd_au
AFTER UPDATE OF total_usd, paid_usd, total_fc, paid_fc ON debts
BEGIN
  UPDATE debts
  SET 
    remaining_usd = CASE
      WHEN NEW.total_usd - NEW.paid_usd < 0 THEN 0
      ELSE (NEW.total_usd - NEW.paid_usd)
    END,
    remaining_fc = CASE
      WHEN NEW.total_fc - NEW.paid_fc < 0 THEN 0
      ELSE (NEW.total_fc - NEW.paid_fc)
    END,
    status = CASE
      WHEN NEW.paid_usd <= 0 AND NEW.paid_fc <= 0 THEN 'open'
      WHEN NEW.paid_usd >= NEW.total_usd OR NEW.paid_fc >= NEW.total_fc THEN 'paid'
      ELSE 'partial'
    END
  WHERE id = NEW.id;
END;

-- =========================
-- TRIGGER: debt_payments applique paiement → maj dette (USD)
-- =========================
DROP TRIGGER IF EXISTS trg_debt_payments_apply;
CREATE TRIGGER IF NOT EXISTS trg_debt_payments_apply
AFTER INSERT ON debt_payments
BEGIN
  UPDATE debts
  SET 
    paid_fc = paid_fc + NEW.amount_fc,
    paid_usd = paid_usd + COALESCE(NEW.amount_usd, NEW.amount_fc / COALESCE(NEW.rate_fc_per_usd, 2800))
  WHERE id = NEW.debt_id;
END;

DROP TRIGGER IF EXISTS trg_debt_payments_revert;
CREATE TRIGGER IF NOT EXISTS trg_debt_payments_revert
AFTER DELETE ON debt_payments
BEGIN
  UPDATE debts
  SET 
    paid_fc = CASE WHEN paid_fc - OLD.amount_fc < 0 THEN 0 ELSE (paid_fc - OLD.amount_fc) END,
    paid_usd = CASE WHEN paid_usd - COALESCE(OLD.amount_usd, 0) < 0 THEN 0 ELSE (paid_usd - COALESCE(OLD.amount_usd, 0)) END
  WHERE id = OLD.debt_id;
END;

-- =========================
-- TRIGGER: Mise à jour updated_at sur clients
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_clients_updated_at
AFTER UPDATE ON clients
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE clients SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =========================
-- INDEX supplémentaires pour performance
-- =========================
CREATE INDEX IF NOT EXISTS idx_debts_client_uuid ON debts(client_uuid);
CREATE INDEX IF NOT EXISTS idx_debts_status_created ON debts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_debts_created_at ON debts(created_at);
