-- Migration: Ajouter colonne is_owner aux utilisateurs
-- Date: 2026-01-10
-- Description: Permet au créateur d'être "OWNER" avec super-droits

-- Vérifier si la colonne existe déjà (pour idempotence)
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;

-- Index pour recherches rapides
CREATE INDEX IF NOT EXISTS idx_users_is_owner ON users(is_owner);

-- ✅ IMPORTANT: Vous devez maintenant marquer le créateur comme OWNER
-- Trouvez l'ID ou UUID du créateur et exécutez:
-- UPDATE users SET is_owner=1 WHERE id=1;
-- Ou par UUID:
-- UPDATE users SET is_owner=1 WHERE uuid='VOTRE_UUID_CREATEUR';
