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
  uuid TEXT UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_vendeur INTEGER NOT NULL DEFAULT 1,
  is_gerant_stock INTEGER NOT NULL DEFAULT 0,
  can_manage_products INTEGER NOT NULL DEFAULT 0,
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

-- =========================
-- RUNTIME PRAGMAS (à exécuter aussi côté backend à chaque connexion)
-- =========================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

-- =========================
-- updated_at AUTO (triggers)
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_products_updated_at
AFTER UPDATE ON products
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE products SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_product_units_updated_at
AFTER UPDATE ON product_units
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE product_units SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sales_updated_at
AFTER UPDATE ON sales
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE sales SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_debts_updated_at
AFTER UPDATE ON debts
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE debts SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_outbox_updated_at
AFTER UPDATE ON sync_outbox
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE sync_outbox SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_settings_updated_at
AFTER UPDATE ON settings
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE settings SET updated_at = datetime('now') WHERE key = NEW.key;
END;

CREATE TRIGGER IF NOT EXISTS trg_app_license_updated_at
AFTER UPDATE ON app_license
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE app_license SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =========================
-- SALE ITEMS -> VALIDATION unité + blocage si facture void
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_sale_items_block_if_void
BEFORE INSERT ON sale_items
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM sales WHERE id = NEW.sale_id) = 'void'
    THEN RAISE(ABORT, 'Impossible: facture void')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_sale_items_require_unit
BEFORE INSERT ON sale_items
BEGIN
  -- Pour les ventes venant de Sheets, on autorise même si l'unité n'existe pas exactement
  -- (ces ventes sont historiques et peuvent avoir des unités qui n'existent plus)
  -- Pour les ventes locales, on vérifie que l'unité existe dans product_units
  SELECT CASE
    WHEN (
      -- Si la vente vient de Sheets, autoriser (pas de vérification stricte)
      SELECT origin FROM sales WHERE id = NEW.sale_id
    ) = 'SHEETS'
    THEN 1 -- Autoriser pour Sheets
    WHEN (
      -- Pour les ventes locales, vérifier que l'unité existe
      SELECT COUNT(*) FROM product_units
      WHERE product_id = NEW.product_id
        AND unit_level = NEW.unit_level
        AND unit_mark  = NEW.unit_mark
    ) = 0
    THEN RAISE(ABORT, 'Unité inconnue pour ce produit (unit_level/unit_mark)')
    ELSE 1 -- Autoriser si l'unité existe
  END;
END;

-- =========================
-- STOCK AUTO: INSERT/UPDATE/DELETE sale_items
-- IMPORTANT: Ne décrémente PAS le stock pour les ventes venant de Sheets (déjà vendues)
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_sale_items_stock_decrease_ai
AFTER INSERT ON sale_items
BEGIN
  -- Ne décrémenter le stock QUE si la vente n'est PAS venue de Sheets
  -- Les ventes SHEETS sont déjà des ventes passées, le stock a déjà été décrémenté
  UPDATE product_units
  SET stock_current = stock_current - NEW.qty,
      last_update   = datetime('now')
  WHERE product_id = NEW.product_id
    AND unit_level = NEW.unit_level
    AND unit_mark  = NEW.unit_mark
    AND EXISTS (
      SELECT 1 FROM sales 
      WHERE id = NEW.sale_id 
        AND origin != 'SHEETS'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_sale_items_stock_adjust_au
AFTER UPDATE OF qty, unit_level, unit_mark, product_id ON sale_items
BEGIN
  -- Restore OLD (seulement si pas SHEETS)
  UPDATE product_units
  SET stock_current = stock_current + OLD.qty,
      last_update   = datetime('now')
  WHERE product_id = OLD.product_id
    AND unit_level = OLD.unit_level
    AND unit_mark  = OLD.unit_mark
    AND EXISTS (
      SELECT 1 FROM sales 
      WHERE id = OLD.sale_id 
        AND origin != 'SHEETS'
    );

  -- Apply NEW (seulement si pas SHEETS)
  UPDATE product_units
  SET stock_current = stock_current - NEW.qty,
      last_update   = datetime('now')
  WHERE product_id = NEW.product_id
    AND unit_level = NEW.unit_level
    AND unit_mark  = NEW.unit_mark
    AND EXISTS (
      SELECT 1 FROM sales 
      WHERE id = NEW.sale_id 
        AND origin != 'SHEETS'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_sale_items_stock_restore_ad
AFTER DELETE ON sale_items
BEGIN
  -- Restaurer le stock seulement si la vente n'était PAS venue de Sheets
  UPDATE product_units
  SET stock_current = stock_current + OLD.qty,
      last_update   = datetime('now')
  WHERE product_id = OLD.product_id
    AND unit_level = OLD.unit_level
    AND unit_mark  = OLD.unit_mark
    AND EXISTS (
      SELECT 1 FROM sales 
      WHERE id = OLD.sale_id 
        AND origin != 'SHEETS'
    );
END;

-- =========================
-- SALES TOTALS AUTO: recalcul total_fc/usd à chaque changement ligne
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_sale_items_recalc_sales_ai
AFTER INSERT ON sale_items
BEGIN
  UPDATE sales
  SET total_fc  = (SELECT IFNULL(SUM(subtotal_fc),0)  FROM sale_items WHERE sale_id = NEW.sale_id),
      total_usd = (SELECT IFNULL(SUM(subtotal_usd),0) FROM sale_items WHERE sale_id = NEW.sale_id)
  WHERE id = NEW.sale_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sale_items_recalc_sales_au
AFTER UPDATE ON sale_items
BEGIN
  UPDATE sales
  SET total_fc  = (SELECT IFNULL(SUM(subtotal_fc),0)  FROM sale_items WHERE sale_id = NEW.sale_id),
      total_usd = (SELECT IFNULL(SUM(subtotal_usd),0) FROM sale_items WHERE sale_id = NEW.sale_id)
  WHERE id = NEW.sale_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sale_items_recalc_sales_ad
AFTER DELETE ON sale_items
BEGIN
  UPDATE sales
  SET total_fc  = (SELECT IFNULL(SUM(subtotal_fc),0)  FROM sale_items WHERE sale_id = OLD.sale_id),
      total_usd = (SELECT IFNULL(SUM(subtotal_usd),0) FROM sale_items WHERE sale_id = OLD.sale_id)
  WHERE id = OLD.sale_id;
END;

-- =========================
-- VOID facture: status + restore stock (sans supprimer la facture)
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_sale_voids_mark_sale
AFTER INSERT ON sale_voids
BEGIN
  UPDATE sales SET status = 'void' WHERE id = NEW.sale_id;

  -- Restore stock for all items in the sale (si vous gardez sale_items)
  UPDATE product_units
  SET stock_current = stock_current + (
    SELECT IFNULL(SUM(si.qty),0)
    FROM sale_items si
    WHERE si.sale_id   = NEW.sale_id
      AND si.product_id = product_units.product_id
      AND si.unit_level = product_units.unit_level
      AND si.unit_mark  = product_units.unit_mark
  ),
  last_update = datetime('now')
  WHERE EXISTS (
    SELECT 1 FROM sale_items si
    WHERE si.sale_id   = NEW.sale_id
      AND si.product_id = product_units.product_id
      AND si.unit_level = product_units.unit_level
      AND si.unit_mark  = product_units.unit_mark
  );
END;

-- =========================
-- DEBTS: remaining_fc + status AUTO
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_debts_calc_ai
AFTER INSERT ON debts
BEGIN
  UPDATE debts
  SET remaining_fc = CASE
      WHEN NEW.total_fc - NEW.paid_fc < 0 THEN 0
      ELSE (NEW.total_fc - NEW.paid_fc)
    END,
    status = CASE
      WHEN NEW.paid_fc <= 0 THEN 'open'
      WHEN NEW.paid_fc < NEW.total_fc THEN 'partial'
      ELSE 'closed'
    END
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_debts_calc_au
AFTER UPDATE OF total_fc, paid_fc ON debts
BEGIN
  UPDATE debts
  SET remaining_fc = CASE
      WHEN NEW.total_fc - NEW.paid_fc < 0 THEN 0
      ELSE (NEW.total_fc - NEW.paid_fc)
    END,
    status = CASE
      WHEN NEW.paid_fc <= 0 THEN 'open'
      WHEN NEW.paid_fc < NEW.total_fc THEN 'partial'
      ELSE 'closed'
    END
  WHERE id = NEW.id;
END;

-- =========================
-- DEBT PAYMENTS: applique paiement -> maj debt
-- =========================
CREATE TRIGGER IF NOT EXISTS trg_debt_payments_apply
AFTER INSERT ON debt_payments
BEGIN
  UPDATE debts
  SET paid_fc = paid_fc + NEW.amount_fc
  WHERE id = NEW.debt_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_debt_payments_revert
AFTER DELETE ON debt_payments
BEGIN
  UPDATE debts
  SET paid_fc = CASE
      WHEN paid_fc - OLD.amount_fc < 0 THEN 0
      ELSE (paid_fc - OLD.amount_fc)
    END
  WHERE id = OLD.debt_id;
END;

-- =========================
-- Indexes utiles (API / filtres fréquents)
-- =========================
CREATE INDEX IF NOT EXISTS idx_debts_client_status ON debts(client_name, status);
CREATE INDEX IF NOT EXISTS idx_debts_sale_id       ON debts(sale_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt  ON debt_payments(debt_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_sales_status_date   ON sales(status, sold_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_prod     ON sale_items(product_id, product_code);
CREATE INDEX IF NOT EXISTS idx_units_lookup        ON product_units(product_id, unit_level, unit_mark);

