-- Migration: Marquer le créateur comme OWNER
-- Date: 2026-01-10
-- Description: Donne au premier/créateur les droits OWNER (super-admin)

-- ✅ Étape 1: Vérifier si la colonne is_owner existe
-- Si elle n'existe pas, exécuter: ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;

-- ✅ Étape 2: Marquer le créateur comme OWNER
-- Généralement, le créateur est le compte avec id=1 (premier créé)
UPDATE users SET is_owner=1 WHERE id=1;

-- ✅ Étape 3: Vérifier que ça a marché
-- Exécuter cette query pour voir:
-- SELECT id, username, is_owner, is_admin FROM users WHERE is_owner=1;

-- 📝 Notes:
-- - Si le créateur n'est pas id=1, remplacer par l'ID correct
-- - Vous pouvez aussi chercher par username:
--   UPDATE users SET is_owner=1 WHERE username='lorie' OR username='admin' OR username='creator';
-- - Ou par UUID si vous connaissez:
--   UPDATE users SET is_owner=1 WHERE uuid='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

-- ✅ Résultat:
-- Après cette migration, le créateur (is_owner=1) aura:
-- - TOGGLE_ADMIN: true (peut promouvoir/rétrograder admin)
-- - MANAGE_USERS_ALL: true (peut modifier tous les comptes)
-- - Tous les autres droits: true

-- 🔐 Sécurité:
-- - Seulement 1 compte doit avoir is_owner=1
-- - C'est irréversible via l'API (PUT /api/users bloque is_owner)
-- - Seul un OWNER peut modifier autre OWNER (protection contre suppression accidentelle)
