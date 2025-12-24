PRAGMA foreign_keys = ON;

-- =========================
-- CORE SETTINGS
-- =========================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings(key,value) VALUES
('exchange_rate_fc_per_usd','2800'),
('company_name','ALIMENTATION'),
('project_root','C:\\Glowflixprojet');

-- =========================
-- USERS (Compter Utilisateur)
-- =========================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS user_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_brand TEXT,
  expo_push_token TEXT,
  profile_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =========================
-- PRODUCTS + UNITS (Carton/Milliers/Pièce)
-- =========================
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,        -- UUID professionnel pour sync
  code TEXT NOT NULL UNIQUE,        -- Code produit (clé commune Sheets)
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- unit_level: CARTON | MILLIER | PIECE
-- unit_mark : ex CARTON, JUTE, SAC, BT, DZ, PCE...
CREATE TABLE IF NOT EXISTS product_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,        -- UUID professionnel pour sync
  product_id INTEGER NOT NULL,
  unit_level TEXT NOT NULL,
  unit_mark TEXT NOT NULL,
  stock_initial REAL NOT NULL DEFAULT 0,
  stock_current REAL NOT NULL DEFAULT 0,
  purchase_price_usd REAL NOT NULL DEFAULT 0,
  sale_price_fc REAL NOT NULL DEFAULT 0,
  sale_price_usd REAL NOT NULL DEFAULT 0,
  auto_stock_factor REAL NOT NULL DEFAULT 1,  -- conversion vers base unit
  qty_step REAL NOT NULL DEFAULT 1,           -- support 1.5 / 0.5 / 0.25 etc
  extra1 TEXT,
  extra2 TEXT,
  last_update TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  UNIQUE(product_id, unit_level, unit_mark),
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_units_prod ON product_units(product_id);

-- =========================
-- EXCHANGE RATES (Taux)
-- =========================
CREATE TABLE IF NOT EXISTS exchange_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate_fc_per_usd REAL NOT NULL,
  effective_at TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

-- =========================
-- SALES (Ventes) + items
-- =========================
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,        -- UUID professionnel pour sync
  invoice_number TEXT NOT NULL UNIQUE,
  sold_at TEXT NOT NULL,
  client_name TEXT,
  client_phone TEXT,                -- Telephone
  seller_name TEXT,
  seller_user_id INTEGER,
  total_fc REAL NOT NULL DEFAULT 0,
  total_usd REAL NOT NULL DEFAULT 0,
  rate_fc_per_usd REAL NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'cash',     -- cash|mobile|mix|dette
  paid_fc REAL NOT NULL DEFAULT 0,
  paid_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid',           -- paid|partial|unpaid|void
  origin TEXT NOT NULL DEFAULT 'LOCAL',          -- LOCAL|MOBILE|SHEETS
  source_device TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  FOREIGN KEY(seller_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,        -- UUID professionnel pour sync (line_id)
  sale_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_level TEXT NOT NULL,         -- mode stock (carton/millier/piece)
  unit_mark TEXT NOT NULL,          -- MARK
  qty REAL NOT NULL,                 -- QTE (support fractions 0.25/0.5/1.5)
  qty_label TEXT,                    -- ex "1/2", "DEMI DZ", "1.5"
  unit_price_fc REAL NOT NULL,      -- Prix unitaire
  subtotal_fc REAL NOT NULL,
  unit_price_usd REAL NOT NULL DEFAULT 0,  -- USD
  subtotal_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

-- =========================
-- SALES VOID (Annulation/Suppression facture PRO)
-- =========================
CREATE TABLE IF NOT EXISTS sale_voids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL UNIQUE,
  invoice_number TEXT NOT NULL,
  reason TEXT,
  voided_by INTEGER,
  voided_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY(voided_by) REFERENCES users(id)
);

-- =========================
-- DEBTS (Dettes) + payments
-- =========================
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,        -- UUID professionnel pour sync
  sale_id INTEGER,
  invoice_number TEXT,
  client_name TEXT NOT NULL,        -- Client
  client_phone TEXT,                 -- Telephone
  product_description TEXT,          -- objet\Description
  total_fc REAL NOT NULL DEFAULT 0,  -- prix a payer
  paid_fc REAL NOT NULL DEFAULT 0,  -- prix payer deja
  remaining_fc REAL NOT NULL DEFAULT 0,  -- reste
  total_usd REAL NOT NULL DEFAULT 0,    -- Dollars
  debt_fc_in_usd REAL,              -- Dettes Fc en usd
  status TEXT NOT NULL DEFAULT 'open',  -- open|partial|closed
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),  -- date
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  FOREIGN KEY(sale_id) REFERENCES sales(id)
);

CREATE TABLE IF NOT EXISTS debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL,
  amount_fc REAL NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'cash',
  paid_by INTEGER,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  FOREIGN KEY(debt_id) REFERENCES debts(id) ON DELETE CASCADE,
  FOREIGN KEY(paid_by) REFERENCES users(id)
);

-- =========================
-- PRICE LOGS (Stock de prix effectué)
-- =========================
CREATE TABLE IF NOT EXISTS price_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,        -- UUID professionnel pour sync
  at TEXT NOT NULL,                 -- Date
  product_code TEXT NOT NULL,       -- Numero du produit
  unit_level TEXT,
  unit_mark TEXT,
  unit_price_fc REAL NOT NULL,     -- Prix
  line_total_fc REAL NOT NULL,      -- Total
  invoice_number TEXT,              -- Numero de facture
  synced_at TEXT
);

-- =========================
-- SYNC OUTBOX (local -> Sheets)
-- =========================
CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,           -- products|product_units|sales|debts|rates...
  entity_id TEXT NOT NULL,        -- id local ou invoice_number
  op TEXT NOT NULL,               -- upsert|delete|void|payment...
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|sent|error
  tries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON sync_outbox(status, entity);

-- =========================
-- AUDIT
-- =========================
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  details_json TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================
-- LICENSE (Licence offline)
-- =========================
CREATE TABLE IF NOT EXISTS app_license (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL,
  is_licensed INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  activated_by_user TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

