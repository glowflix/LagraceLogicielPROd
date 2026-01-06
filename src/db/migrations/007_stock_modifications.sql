-- =========================
-- STOCK MODIFICATIONS (New Arrivage - Historique des modifications de stock)
-- =========================
-- Table pour tracer les modifications de stock avec date
-- Utilisée par la page "New Arrivage" pour afficher les produits modifiés
-- =========================

CREATE TABLE IF NOT EXISTS stock_modifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modification_id TEXT NOT NULL UNIQUE,  -- UUID unique
  product_id INTEGER NOT NULL,           -- ID du produit
  product_uuid TEXT NOT NULL,            -- UUID du produit pour sync
  product_code TEXT NOT NULL,            -- Code produit
  product_name TEXT,                     -- Nom du produit au moment de la modification
  unit_level TEXT NOT NULL,              -- CARTON|MILLIER|PIECE
  unit_mark TEXT DEFAULT '',             -- Mark de l'unité
  
  -- Valeurs de stock
  stock_before REAL NOT NULL DEFAULT 0,  -- Stock avant modification
  stock_after REAL NOT NULL DEFAULT 0,   -- Stock après modification
  delta REAL NOT NULL DEFAULT 0,         -- Différence (stock_after - stock_before)
  
  -- Prix au moment de la modification
  sale_price_fc REAL NOT NULL DEFAULT 0,
  sale_price_usd REAL NOT NULL DEFAULT 0,
  purchase_price_usd REAL NOT NULL DEFAULT 0,
  
  -- Métadonnées
  modification_type TEXT NOT NULL DEFAULT 'manual', -- manual|sale|void|import|sync
  reason TEXT,                           -- Raison de la modification
  modified_by INTEGER,                   -- User ID qui a fait la modification
  device_id TEXT,                        -- Device source
  
  -- Timestamps
  modified_at TEXT NOT NULL DEFAULT (datetime('now')),  -- Date de modification
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT                         -- Date de synchronisation cloud
);

-- Index pour requêtes courantes
CREATE INDEX IF NOT EXISTS idx_stock_modifications_date ON stock_modifications(modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_modifications_product ON stock_modifications(product_code, unit_level);
CREATE INDEX IF NOT EXISTS idx_stock_modifications_type ON stock_modifications(modification_type);
CREATE INDEX IF NOT EXISTS idx_stock_modifications_product_id ON stock_modifications(product_id);

-- Vue pour New Arrivage (dernières modifications groupées par produit/unité)
CREATE VIEW IF NOT EXISTS v_new_arrivage AS
SELECT 
  sm.id,
  sm.modification_id,
  sm.product_id,
  sm.product_uuid,
  sm.product_code,
  COALESCE(p.name, sm.product_name) as product_name,
  sm.unit_level,
  sm.unit_mark,
  sm.stock_before,
  sm.stock_after,
  sm.delta,
  sm.sale_price_fc,
  sm.sale_price_usd,
  sm.purchase_price_usd,
  sm.modification_type,
  sm.reason,
  sm.modified_at,
  sm.created_at,
  -- Calculs
  (sm.stock_after * sm.sale_price_fc) as total_value_fc,
  (sm.stock_after * sm.sale_price_usd) as total_value_usd,
  -- Infos produit actuelles
  pu.stock_current as current_stock,
  pu.sale_price_fc as current_price_fc,
  pu.sale_price_usd as current_price_usd
FROM stock_modifications sm
LEFT JOIN products p ON sm.product_id = p.id
LEFT JOIN product_units pu ON sm.product_id = pu.product_id 
  AND sm.unit_level = pu.unit_level
ORDER BY sm.modified_at DESC;
