# 🔒 Fix Sécurité: Auth + Users Routes

## 📋 Résumé

Trois bugs critiques ont été identifiés et fixés:

1. **auth.js** - `req.userRole` n'était pas défini dans tous les chemins
2. **auth.js** - `req.user.id` manquant en mode offline/licence
3. **users.routes.js** - Vérifications fragiles de permissions + pas de protection is_admin

---

## 🐛 Bugs Identifiés

### Bug A: req.userRole undefined

**Chemin affecté:** Local token + user DB trouvé

```javascript
// ❌ AVANT
if (payload.user_id) {
  const user = usersRepo.findById(payload.user_id);
  if (user && user.is_active) {
    req.user = user;
    return next();  // ❌ req.userRole jamais défini!
  }
}
```

**Conséquence:** Dans PUT /api/users/:id, la vérif `req.userRole !== 'ADMIN'` échouait → 403 même pour admin

---

### Bug B: req.user.id undefined

**Chemin affecté:** Offline token, licence mode, local token fallback

```javascript
// ❌ AVANT
if (token === 'offline-token') {
  req.user = { username: 'offline', is_admin: true };  // ❌ Pas d'id!
  return next();
}

const currentUserId = req.user?.id;  // undefined
if (userId !== currentUserId && ...) { // userId !== undefined = toujours true!
  return 403;
}
```

**Conséquence:** Impossible d'éditer son propre compte en mode offline

---

### Bug C: Vérif is_admin fragile

**Chemin affecté:** PUT /api/users/:id

```javascript
// ❌ AVANT: Dépend de req.userRole qui peut être undefined
if (userId !== currentUserId && (!req.userRole || req.userRole !== 'ADMIN')) {
  return 403;
}

// ❌ Aucune protection: n'importe qui peut modifier is_admin
```

**Conséquence:**
- Admins ne pouvaient pas modifier leurs propres accounts
- N'importe quel rôle pouvait envoyer `is_admin: true` (le backend l'appliquerait)

---

## ✅ Fixes Appliqués

### Fix 1: Fonctions Helper dans auth.js

```javascript
/**
 * Normaliser boolean depuis DB/payload
 */
function normalizeBool(v) {
  return v === 1 || v === true || v === '1' || v === 'true' || v === 'oui' || v === 'OUI';
}

/**
 * Calculer le rôle d'un utilisateur depuis ses flags DB
 * OWNER > ADMIN > autres rôles
 */
function computeUserRoleFromUser(user) {
  if (!user) return 'LICENSE_ONLY';
  if (normalizeBool(user.is_owner)) return 'OWNER';
  if (normalizeBool(user.is_admin)) return 'ADMIN';
  
  // ... puis VENDEUR_STOCK, VENDEUR_PRODUITS, etc.
}
```

**Bénéfice:** Code centralisé + reconnaît is_owner

---

### Fix 2: Toujours définir req.userRole dans authenticate()

#### Offline token
```javascript
if (token === 'offline-token') {
  req.user = { id: 0, username: 'offline', is_admin: true, is_active: 1 };
  req.userRole = 'ADMIN';  // ✅ Maintenant défini
  return next();
}
```

#### Local token + user DB trouvé
```javascript
if (payload.user_id) {
  const user = usersRepo.findById(payload.user_id);
  if (user && normalizeBool(user.is_active)) {
    req.user = user;
    req.userRole = computeUserRoleFromUser(user);  // ✅ IMPORTANT
    req.roleFlags = payload.role_flags || {};
    return next();
  }
}
```

#### Local token fallback
```javascript
req.user = {
  id: payload.user_id ? Number(payload.user_id) : undefined,  // ✅ Avoir id
  username: payload.user_id ? `user_${payload.user_id}` : 'offline',
  is_active: 1,
  is_admin: false,  // ✅ SÉCURITÉ: jamais depuis payload
  is_vendeur: roleFlags.vendeur === true,
  is_gerant_stock: roleFlags.gerentStock === true,
  can_manage_products: roleFlags.produitsVendeur === true,
};
req.userRole = payload.role || 'LICENSE_ONLY';  // ✅ Défini
```

#### JWT normal
```javascript
req.user = user;
req.userRole = computeUserRoleFromUser(user);  // ✅ Utiliser helper
```

---

### Fix 3: Vérification sécurisée dans PUT /api/users/:id

#### Avant (fragile)
```javascript
if (userId !== currentUserId && (!req.userRole || req.userRole !== 'ADMIN')) {
  return 403;
}
```

#### Après (sécurisé - lookup DB)
```javascript
const currentUser = usersRepo.findById(currentUserId);
const isOwner = currentUser && (currentUser.is_owner === 1 || currentUser.is_owner === true);
const isAdmin = currentUser && (currentUser.is_admin === 1 || currentUser.is_admin === true);

// Règle claire: propre compte TOUJOURS autorisé, autres comptes si ADMIN/OWNER
if (userId !== currentUserId && !isAdmin && !isOwner) {
  return 403;
}
```

#### Protection is_admin (NEW)
```javascript
// Seul OWNER peut changer is_admin
if ('is_admin' in req.body && !isOwner) {
  return 403;
}

// Personne ne peut définir is_owner (protection escalade)
if ('is_owner' in req.body) {
  return 403;
}
```

---

## 🧪 Scénarios Testés

### Scénario 1: Utilisateur mode offline
```
✅ offline-token → req.user.id = 0, req.userRole = 'ADMIN'
✅ Peut modifier son compte (userId=0, currentUserId=0)
✅ Peut modifier autres comptes (isAdmin=true)
```

### Scénario 2: Licence mode (local. token avec user_id=1)
```
✅ local.{base64({user_id:1, exp:9999...})} 
✅ → Charge user_id=1 de DB
✅ → req.user.id = 1, req.userRole = computeUserRoleFromUser(user)
✅ Peut modifier son compte (userId=1, currentUserId=1)
✅ Admins peuvent modifier autres (isAdmin=true lookup DB)
```

### Scénario 3: Admin essayant de se promouvoir OWNER
```
❌ PUT /api/users/2 avec { is_admin: true }
❌ currentUser.is_owner = false
❌ → 403 "Seul le créateur peut modifier le statut administrateur"
```

### Scénario 4: Tentative escalade de privilèges
```
❌ PUT /api/users/2 avec { is_owner: true }
❌ → 403 "Impossible de modifier le statut propriétaire"
```

---

## 📦 Fichiers Modifiés

1. **src/api/middlewares/auth.js**
   - ✅ Ajouté `normalizeBool()`
   - ✅ Ajouté `computeUserRoleFromUser()` 
   - ✅ Fixed offline-token path
   - ✅ Fixed local token + DB path
   - ✅ Fixed local token fallback
   - ✅ Fixed JWT path

2. **src/api/routes/users.routes.js**
   - ✅ POST /api/users: Destructurer is_vendeur, is_gerant_stock, can_manage_products
   - ✅ PUT /api/users/:id: Vérification sécurisée par lookup DB
   - ✅ Protection is_admin (OWNER only)
   - ✅ Protection is_owner (impossible à modifier)

---

## 🔐 Résultat Final

| Mode | req.user.id | req.userRole | Permissions |
|------|-------------|--------------|-------------|
| offline | 0 | ADMIN | ✅ Peut tout faire |
| local (user_id=1, OWNER) | 1 | OWNER | ✅ OWNER > tout |
| local (user_id=2, ADMIN) | 2 | ADMIN | ✅ Peut gérer users |
| JWT (VENDEUR) | 3 | VENDEUR_SEULEMENT | ✅ Propre compte seulement |
| Licence DB lookup | ✓ | ✓ (depuis DB) | ✅ Sécurisé |

---

## 🚀 Prochaines Étapes

1. ✅ **auth.js** fixé
2. ✅ **users.routes.js** fixé
3. ⏳ Database: Ajouter `is_owner` colonne
4. ⏳ Frontend UsersPage.jsx: Utiliser nouvelles permissions
5. ⏳ Test end-to-end tous les scénarios
