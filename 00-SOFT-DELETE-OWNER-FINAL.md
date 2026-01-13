# ✅ Soft Delete Produits + OWNER Role: IMPLÉMENTÉ

## 📋 Ce Qui A Été Fait

### 1. **Soft Delete pour Produits** ✅

**Avant:**
- Supprimer un produit = DELETE de la DB
- ❌ Impossible de réactiver
- ❌ Les données sont perdues

**Après:**
- Supprimer un produit = `UPDATE deleted_at = now()`
- ✅ Produit reste en DB (invisible)
- ✅ Si on recrée avec le même nom → réactivation

---

### 2. **OWNER Role pour Licence** ✅

**Avant:**
- Licence = LICENSE_ONLY (pas de droits spéciaux)
- ❌ Pas de distinction créateur/fondateur
- ❌ Impossible de promouvoir admins

**Après:**
- Créateur = `is_owner=1` en DB
- Licence pointe vers créateur → `req.userRole = 'OWNER'`
- ✅ OWNER peut promouvoir admins
- ✅ OWNER seul a `TOGGLE_ADMIN=true`

---

## 🔧 Migrations Automatiques Appliquées

### sqlite.js (Ligne ~325-330)
```javascript
// ✅ SOFT DELETE: Ajouter colonne deleted_at pour soft delete des produits
ensureColumn('products', 'deleted_at', 'DATETIME DEFAULT NULL');
ensureColumn('products', 'is_active', 'INTEGER DEFAULT 1');

// ✅ OWNER ROLE: Ajouter colonne is_owner pour identifier le créateur
ensureColumn('users', 'is_owner', 'INTEGER DEFAULT 0');
```

**Résultat:** À chaque redémarrage, les colonnes manquantes sont automatiquement ajoutées!

---

## 🎯 Flux Complet: Créer → Supprimer → Recréer Produit

### Scénario: Gérer un Produit "Biscuit"

#### 1️⃣ Créer le produit "Biscuit"
```javascript
// ProductsPage.jsx handleCreateProduct()
POST /api/products { code: 'BISCUIT', name: 'Biscuit', ... }

// Backend: products.repo.js create()
INSERT INTO products (code, name, ..., deleted_at=NULL, is_active=1)
→ Produit visible ✅
```

#### 2️⃣ Afficher le produit
```javascript
// Frontend ProductsPage
GET /api/products
→ Retourne tous produits WHERE deleted_at IS NULL
→ "Biscuit" s'affiche ✅
```

#### 3️⃣ Cliquer "Supprimer"
```javascript
// ProductsPage.jsx handleDeleteProduct()
DELETE /api/products/BISCUIT

// Backend: products.routes.js DELETE
UPDATE products SET deleted_at = datetime('now') WHERE code='BISCUIT'
→ Produit marqué supprimé (hidden)
→ Disparaît de l'affichage ✅
```

#### 4️⃣ Recrée le même produit "Biscuit"
```javascript
// Frontend ProductsPage handleCreateProduct()
POST /api/products { code: 'BISCUIT', name: 'Biscuit', ... }

// Backend: products.repo.js create()
// ✅ SOFT DELETE: Cherche si existe
existing = SELECT * FROM products WHERE code='BISCUIT'
→ Trouve le vieux produit (deleted_at IS NOT NULL)

// ✅ Réactive au lieu de créer doublon
UPDATE products SET deleted_at=NULL, is_active=1 WHERE id=old_id
→ Produit réactivé ✅
→ Réaffiche automatiquement ✅
```

---

## 📊 État DB Après Opérations

```sql
-- ✅ Produit actif
SELECT * FROM products WHERE code='BISCUIT';
| id | code    | name    | deleted_at | is_active |
| 1  | BISCUIT | Biscuit | NULL       | 1         | ← Visible ✅

-- Après supprimer
| id | code    | name    | deleted_at          | is_active |
| 1  | BISCUIT | Biscuit | 2026-01-10 10:30:00 | 0         | ← Caché ✅

-- Après recréer
| id | code    | name    | deleted_at | is_active |
| 1  | BISCUIT | Biscuit | NULL       | 1         | ← Réactivé ✅
```

---

## 🔐 Sécurité: is_owner Protégé

### Backend Protection

```javascript
// users.routes.js PUT /api/users/:id (Ligne ~222)
if ('is_owner' in req.body) {
  return 403;  // ❌ Impossible de changer is_owner via API
}

if ('is_admin' in req.body && !isOwner) {
  return 403;  // ❌ Seul OWNER peut changer is_admin
}
```

### Résultat
- ✅ Personne ne peut se promouvoir OWNER via API
- ✅ Seul OWNER peut créer/retirer admins
- ✅ is_owner modifiable seulement en SQL direct

---

## 📝 Fichiers Modifiés

| Fichier | Changement | Impact |
|---------|-----------|--------|
| `src/db/sqlite.js` | Ajout migrations `deleted_at` et `is_owner` | Colonnes créées auto |
| `src/db/repositories/products.repo.js` | Fix `hasProducts()` filtre soft delete | Produits affichés ✅ |
| `src/api/routes/products.routes.js` | Soft delete + réactivation | Suppression logique |
| `src/api/middlewares/auth.js` | Reconnaît `is_owner` → OWNER role | Licence = OWNER |
| `src/ui/pages/UsersPage.jsx` | Permissions granulaires | Boutons désactivés si pas droit |
| `src/ui/utils/permissions.js` | OWNER role + TOGGLE_ADMIN | Permissions claires |

---

## ✅ Vérification

Démarrer l'app:
```bash
npm start
```

**Vérifier Soft Delete:**
1. Créer un produit "Test"
2. Cliquer Delete → disparaît ✅
3. Créer "Test" à nouveau → réapparaît ✅

**Vérifier OWNER:**
1. Licence activée (pointant user_id=1)
2. Créateur connecté → peut promouvoir admins ✅
3. Admin (non-créateur) connecté → boutons désactivés ✅

---

## 🚀 Prochaines Étapes (Optionnel)

- [ ] Tester soft delete avec Google Sheets sync
- [ ] Ajouter un endpoint pour voir produits supprimés (admin only)
- [ ] Archivage: transformer deleted_at en archive_at (historique)
- [ ] Hard delete: après 90 jours, supprimer vraiment de la DB

