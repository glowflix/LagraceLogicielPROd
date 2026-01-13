-- Migration: Soft Delete pour les Produits
-- Date: 2026-01-10
-- Description: Ajouter support soft delete (suppression logique) aux produits

-- ✅ Ajouter colonne deleted_at
-- Quand NULL = produit actif
-- Quand = timestamp = produit supprimé (hidden)
ALTER TABLE products ADD COLUMN deleted_at DATETIME DEFAULT NULL;

-- Index pour filtrer rapidement les produits actifs
CREATE INDEX IF NOT EXISTS idx_products_deleted_at ON products(deleted_at);

-- 🔄 Pattern Soft Delete:
-- SELECT * FROM products WHERE deleted_at IS NULL;  -- Produits actifs seulement
-- UPDATE products SET deleted_at=datetime('now') WHERE id=?;  -- Marquer supprimé
-- UPDATE products SET deleted_at=NULL WHERE id=?;  -- Réactiver
