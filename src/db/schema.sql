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
  stock_initial REAL NOT NULL DEFAULT 0,  -- SOURCE DE VÉRITÉ: Correspond à la colonne C dans Sheets
  stock_current REAL NOT NULL DEFAULT 0,  -- DOIT être synchronisé avec stock_initial (même valeur)
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
  UNIQUE(product_id, unit_level),
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
  unit_mark TEXT NOT NULL,          -- MARK (modifiable par user, NE PAS utiliser comme clé)
  product_unit_uuid TEXT,           -- ✅ RÉFÉRENCE STABLE à l'unité (uuid de product_units)
  qty REAL NOT NULL,                 -- QTE (support fractions 0.25/0.5/1.5)
  qty_label TEXT,                    -- ex "1/2", "DEMI DZ", "1.5"
  unit_price_fc REAL NOT NULL,      -- Prix unitaire
  subtotal_fc REAL NOT NULL,
  unit_price_usd REAL NOT NULL DEFAULT 0,  -- USD
  subtotal_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(product_unit_uuid) REFERENCES product_units(uuid)
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_unit_uuid ON sale_items(product_unit_uuid);

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
-- SYNC OUTBOX (local -> Sheets) - LEGACY TABLE
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
-- SYNC OPERATIONS (Outbox PRO avec idempotence)
-- =========================
-- Système d'opérations offline-first avec:
-- - op_id UUID pour idempotence (évite doublons côté Sheets)
-- - Déduplication des patches produit (last-write-wins)
-- - Mouvements de stock par deltas (jamais valeur absolue)
-- =========================
CREATE TABLE IF NOT EXISTS sync_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT NOT NULL UNIQUE,     -- UUID unique pour idempotence
  op_type TEXT NOT NULL,          -- PRODUCT_PATCH|STOCK_MOVE|SALE|DEBT|RATE
  entity_uuid TEXT NOT NULL,      -- UUID de l'entité concernée (product, sale, etc.)
  entity_code TEXT,               -- Code produit, numéro facture, etc. (pour lookup)
  payload_json TEXT NOT NULL,     -- Données de l'opération
  device_id TEXT,                 -- ID du device source
  status TEXT NOT NULL DEFAULT 'pending', -- pending|sent|acked|error
  tries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,                   -- Date d'envoi réussie
  acked_at TEXT                   -- Date de confirmation Sheets
);

CREATE INDEX IF NOT EXISTS idx_sync_ops_pending ON sync_operations(status, op_type);
CREATE INDEX IF NOT EXISTS idx_sync_ops_entity ON sync_operations(entity_uuid, op_type, status);
CREATE INDEX IF NOT EXISTS idx_sync_ops_opid ON sync_operations(op_id);

-- =========================
-- STOCK MOVES (Historique des mouvements de stock)
-- =========================
-- Table séparée pour tracer tous les mouvements de stock
-- Permet de reconstruire le stock à tout moment
-- =========================
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_id TEXT NOT NULL UNIQUE,   -- UUID unique pour idempotence
  product_uuid TEXT NOT NULL,     -- UUID du produit
  product_code TEXT NOT NULL,     -- Code produit pour lookup
  unit_level TEXT NOT NULL,       -- CARTON|MILLIER|PIECE
  unit_mark TEXT DEFAULT '',      -- Mark de l'unité
  delta REAL NOT NULL,            -- Mouvement (+50, -3, etc.)
  reason TEXT NOT NULL,           -- adjustment|sale|void|inventory|correction
  reference_id TEXT,              -- UUID de la vente, ajustement, etc.
  stock_before REAL,              -- Stock avant le mouvement
  stock_after REAL,               -- Stock après le mouvement
  device_id TEXT,                 -- Device source
  synced INTEGER NOT NULL DEFAULT 0, -- 0=pending, 1=synced
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON stock_moves(product_uuid, unit_level, unit_mark);
CREATE INDEX IF NOT EXISTS idx_stock_moves_pending ON stock_moves(synced, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_moves_reason ON stock_moves(reason, created_at);

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

-- Supprimer le trigger existant s'il existe (pour permettre la mise à jour)
DROP TRIGGER IF EXISTS trg_sale_items_require_unit;

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
    THEN 1 -- Autoriser pour Sheets (même si product_id est NULL ou unité n'existe pas)
    WHEN NEW.product_id IS NULL
    THEN 1 -- Autoriser si product_id est NULL (pour compatibilité avec ventes historiques)
    WHEN (
      -- Pour les ventes locales, vérifier que l'unité existe
      SELECT COUNT(*) FROM product_units
      WHERE product_id = NEW.product_id
        AND unit_level = NEW.unit_level
        AND unit_mark  = COALESCE(NEW.unit_mark, '')
    ) = 0
    THEN RAISE(ABORT, 'Unité inconnue pour ce produit (unit_level/unit_mark)')
    ELSE 1 -- Autoriser si l'unité existe
  END;
END;

-- =========================
-- STOCK AUTO: INSERT/UPDATE/DELETE sale_items
-- IMPORTANT: Ne décrémente PAS le stock pour les ventes venant de Sheets (déjà vendues)
-- CRITIQUE: Réduit stock_initial ET stock_current pour éviter la double réduction
-- 
-- RÈGLE PROFESSIONNELLE:
-- - stock_initial = Source de vérité (correspond à la colonne C dans Sheets)
-- - stock_current = Même valeur que stock_initial (synchronisé automatiquement)
-- - Les deux colonnes doivent TOUJOURS être modifiées ensemble
-- - Le stock n'est réduit QU'UNE SEULE FOIS par le trigger (pas de double réduction)
-- - La réduction se fait directement avec la quantité vendue (sans auto_stock_factor)
-- =========================
DROP TRIGGER IF EXISTS trg_sale_items_stock_decrease_ai;
CREATE TRIGGER IF NOT EXISTS trg_sale_items_stock_decrease_ai
AFTER INSERT ON sale_items
BEGIN
  -- ✅ RÉFÉRENCE STABLE: utiliser product_unit_uuid (uuid immuable), pas unit_mark (modifiable)
  -- Ne décrémenter que si la vente n'est PAS venue de Sheets (déjà décrémentée)
  UPDATE product_units
  SET stock_initial = stock_initial - NEW.qty,
      stock_current = stock_current - NEW.qty,
      updated_at = datetime('now'),
      last_update = datetime('now')
  WHERE uuid = NEW.product_unit_uuid
    AND EXISTS (
      SELECT 1 FROM sales 
      WHERE id = NEW.sale_id 
        AND origin != 'SHEETS'
    );
END;

DROP TRIGGER IF EXISTS trg_sale_items_stock_adjust_au;
CREATE TRIGGER IF NOT EXISTS trg_sale_items_stock_adjust_au
AFTER UPDATE OF qty, product_unit_uuid ON sale_items
BEGIN
  -- ✅ RÉFÉRENCE STABLE: utiliser product_unit_uuid, pas unit_mark (modifiable)
  -- Restore OLD stock
  UPDATE product_units
  SET stock_initial = stock_initial + OLD.qty,
      stock_current = stock_current + OLD.qty,
      updated_at = datetime('now'),
      last_update = datetime('now')
  WHERE uuid = OLD.product_unit_uuid
    AND EXISTS (
      SELECT 1 FROM sales 
      WHERE id = OLD.sale_id 
        AND origin != 'SHEETS'
    );

  -- Apply NEW stock
  UPDATE product_units
  SET stock_initial = stock_initial - NEW.qty,
      stock_current = stock_current - NEW.qty,
      updated_at = datetime('now'),
      last_update = datetime('now')
  WHERE uuid = NEW.product_unit_uuid
    AND EXISTS (
      SELECT 1 FROM sales 
      WHERE id = NEW.sale_id 
        AND origin != 'SHEETS'
    );
END;

DROP TRIGGER IF EXISTS trg_sale_items_stock_restore_ad;
CREATE TRIGGER IF NOT EXISTS trg_sale_items_stock_restore_ad
AFTER DELETE ON sale_items
BEGIN
  -- ✅ RÉFÉRENCE STABLE: utiliser product_unit_uuid, pas unit_mark (modifiable)
  -- Restaurer le stock seulement si la vente n'était PAS venue de Sheets
  UPDATE product_units
  SET stock_initial = stock_initial + OLD.qty,
      stock_current = stock_current + OLD.qty,
      updated_at = datetime('now'),
      last_update = datetime('now')
  WHERE uuid = OLD.product_unit_uuid
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

  -- ✅ RÉFÉRENCE STABLE: utiliser product_unit_uuid (uuid immuable), pas unit_mark (modifiable)
  -- Restaurer stock_initial ET stock_current via l'uuid de l'unité
  UPDATE product_units
  SET stock_initial = stock_initial + (
    SELECT IFNULL(SUM(si.qty),0)
    FROM sale_items si
    WHERE si.sale_id = NEW.sale_id
      AND si.product_unit_uuid = product_units.uuid
  ),
  stock_current = stock_current + (
    SELECT IFNULL(SUM(si.qty),0)
    FROM sale_items si
    WHERE si.sale_id = NEW.sale_id
      AND si.product_unit_uuid = product_units.uuid
  ),
  updated_at = datetime('now'),
  last_update = datetime('now')
  WHERE uuid IN (
    SELECT product_unit_uuid
    FROM sale_items
    WHERE sale_id = NEW.sale_id
      AND product_unit_uuid IS NOT NULL
      AND TRIM(product_unit_uuid) != ''
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

-- =========================
-- PRINT JOBS (Queue d'impression)
-- =========================
CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'receipt-80',
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|printed|error
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  printed_at TEXT,
  FOREIGN KEY(invoice_number) REFERENCES sales(invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_invoice ON print_jobs(invoice_number);

