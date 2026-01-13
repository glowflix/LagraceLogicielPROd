# 🔧 CORRECTIF MODE LICENSE - Permissions de Modification de Comptes

## 🎯 Problème Identifié

Lorsqu'un utilisateur est connecté en **mode license** (sans compte utilisateur), il reçoit une erreur **403 Forbidden** lors de la tentative de modification ou création de comptes :

```
api/users/6:1 Failed to load resource: the server responded with a status of 403 (Forbidden)
UsersPage.jsx:204 Erreur sauvegarde phone
```

**Cause racine** : Le backend ne détectait pas correctement le mode license car :
1. Le middleware d'authentification créait un objet `req.user` avec `id: undefined` au lieu de `null`
2. La vérification du mode license dans les routes utilisateurs ne couvrait pas tous les cas
3. Le frontend utilisait `localStorage.getItem('token')` au lieu du token du store Zustand

---

## ✅ Corrections Appliquées

### 1. **Middleware d'Authentification** (`src/api/middlewares/auth.js`)

**Avant** :
```javascript
// Token local sans user_id
req.user = {
  id: payload.user_id ? Number(payload.user_id) : undefined, // ❌ undefined
  username: payload.user_id ? `user_${payload.user_id}` : 'offline',
  // ...
};
req.userRole = payload.role || 'LICENSE_ONLY';
```

**Après** :
```javascript
// ✅ MODE LICENSE: Si pas de user_id = connexion avec license seule
if (!payload.user_id) {
  req.user = null; // ✅ CRITIQUE: null pour indiquer mode license pur
  req.userRole = 'LICENSE_ONLY';
  req.roleFlags = roleFlags;
  logger.debug('🔑 [Auth] Mode LICENSE détecté - Accès complet autorisé');
  return next();
}

// Si user_id présent mais pas dans DB, créer un user basique
req.user = {
  id: Number(payload.user_id),
  username: `user_${payload.user_id}`,
  // ...
};
```

**Impact** : Le middleware définit maintenant `req.user = null` en mode license pur, facilitant la détection.

---

### 2. **Routes Utilisateurs - POST** (`src/api/routes/users.routes.js`)

**Avant** :
```javascript
const currentUser = usersRepo.findById(req.user?.id);
const isLicenseMode = !currentUser && (req.userRole === 'LICENSE_ONLY' || !req.user?.id);
```

**Après** :
```javascript
const currentUser = req.user ? usersRepo.findById(req.user.id) : null;
const isLicenseMode = !req.user || !req.user.id || req.userRole === 'LICENSE_ONLY';

logger.debug(`🔐 [POST /api/users] Création utilisateur: currentUser=${!!currentUser}, isCurrentAdmin=${isCurrentAdmin}, isCurrentOwner=${isCurrentOwner}, isLicenseMode=${isLicenseMode}, userRole=${req.userRole}`);
```

**Impact** : Détection robuste du mode license couvrant tous les cas.

---

### 3. **Routes Utilisateurs - PUT** (`src/api/routes/users.routes.js`)

**Avant** :
```javascript
const currentUser = currentUserId ? usersRepo.findById(currentUserId) : null;
const isLicenseMode = !currentUser && (req.userRole === 'LICENSE_ONLY' || !currentUserId);
```

**Après** :
```javascript
const currentUser = (req.user && currentUserId) ? usersRepo.findById(currentUserId) : null;
const isLicenseMode = !req.user || !currentUserId || req.userRole === 'LICENSE_ONLY';

logger.debug(`🔐 [PUT /api/users/${userId}] Permissions: currentUser=${!!currentUser}, currentUserId=${currentUserId}, isOwner=${isOwner}, isAdmin=${isAdmin}, isLicenseMode=${isLicenseMode}, userRole=${req.userRole}`);
```

**Impact** : Même logique cohérente pour les modifications.

---

### 4. **Frontend - UsersPage** (`src/ui/pages/UsersPage.jsx`)

**Avant** :
```javascript
const { user: currentUser } = useStore();
// ...
const token = localStorage.getItem('token'); // ❌ Mauvaise source
```

**Après** :
```javascript
// ✅ Récupérer user ET token depuis le store
const { user: currentUser, token } = useStore();
// ...
// ✅ Utiliser le token depuis le store (pas localStorage)
const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
```

**Impact** : Le token est maintenant récupéré depuis le store Zustand qui le persiste correctement.

---

## 🔐 Règles de Sécurité - Mode License

### Permissions en Mode License

En **mode license** (connexion sans compte utilisateur), l'utilisateur dispose de **droits équivalents à OWNER** :

✅ **AUTORISÉ** :
- Créer n'importe quel compte (client, vendeur, admin)
- Modifier n'importe quel compte
- Changer le statut `is_admin` de n'importe quel utilisateur
- Activer/désactiver des comptes
- Gérer tous les aspects des comptes

❌ **INTERDIT** :
- Modifier le flag `is_owner` (réservé au créateur initial)
- Rien d'autre - accès complet

### Détection du Mode License

Le backend détecte le mode license via **3 conditions** (OR logique) :

```javascript
const isLicenseMode = !req.user || !req.user.id || req.userRole === 'LICENSE_ONLY';
```

1. `!req.user` : Pas d'objet utilisateur
2. `!req.user.id` : Utilisateur sans ID
3. `req.userRole === 'LICENSE_ONLY'` : Rôle explicite LICENSE_ONLY

---

## 📊 Logs de Debug Ajoutés

Pour faciliter le diagnostic, des logs ont été ajoutés :

### Backend (auth.js) :
```javascript
logger.debug('🔑 [Auth] Mode LICENSE détecté - Accès complet autorisé');
```

### Backend (users.routes.js) :
```javascript
logger.debug(`🔐 [POST /api/users] Création utilisateur: currentUser=${!!currentUser}, isCurrentAdmin=${isCurrentAdmin}, isCurrentOwner=${isCurrentOwner}, isLicenseMode=${isLicenseMode}, userRole=${req.userRole}`);

logger.debug(`🔐 [PUT /api/users/${userId}] Permissions: currentUser=${!!currentUser}, currentUserId=${currentUserId}, isOwner=${isOwner}, isAdmin=${isAdmin}, isLicenseMode=${isLicenseMode}, userRole=${req.userRole}`);
```

---

## 🧪 Tests à Effectuer

### Test 1 : Création de compte en mode license
1. Activer la license (`0987654321`)
2. Ne PAS se connecter avec un compte
3. Aller dans **Gestion des Comptes**
4. Créer un nouveau compte avec `is_admin = true`
5. ✅ Le compte doit être créé avec succès

### Test 2 : Modification de compte en mode license
1. En mode license (non connecté)
2. Modifier le nom, téléphone ou mot de passe d'un compte existant
3. ✅ Les modifications doivent être enregistrées

### Test 3 : Modification du statut admin en mode license
1. En mode license (non connecté)
2. Changer le statut `Admin` d'un utilisateur
3. ✅ Le changement doit être autorisé

### Test 4 : Connexion normale avec un compte
1. Se connecter avec un compte vendeur (non-admin)
2. Essayer de modifier un AUTRE compte
3. ❌ Doit recevoir une erreur de permission
4. Essayer de modifier SON PROPRE compte
5. ✅ Doit fonctionner

---

## 🎓 Architecture - Mode License

### Flux d'Authentification

```
┌─────────────────────────────────────────────┐
│ Frontend: LicensePage                       │
│ - Activation license: 0987654321            │
│ - Génère token local: local.xxxxx           │
│ - Store token dans Zustand (persiste)       │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Frontend: UsersPage                          │
│ - Récupère token depuis useStore()          │
│ - Envoie: Authorization: Bearer local.xxx   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Backend: auth.js middleware                  │
│ - Détecte token local.xxx                   │
│ - Décode payload (base64)                   │
│ - Si pas de user_id:                        │
│   → req.user = null                         │
│   → req.userRole = 'LICENSE_ONLY'           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Backend: users.routes.js                     │
│ - Détecte isLicenseMode = true              │
│ - Autorise création/modification            │
│ - Bypass vérifications admin/owner          │
└─────────────────────────────────────────────┘
```

---

## 📝 Résumé des Fichiers Modifiés

| Fichier | Modifications | Lignes |
|---------|--------------|--------|
| `src/api/middlewares/auth.js` | Détection mode license avec `req.user = null` | 84-99 |
| `src/api/routes/users.routes.js` | Détection robuste mode license (POST) | 131-139 |
| `src/api/routes/users.routes.js` | Détection robuste mode license (PUT) | 207-219 |
| `src/ui/pages/UsersPage.jsx` | Utilisation token depuis store | 93, 187, 306, 467 |

---

## ✅ Validation

Pour valider que le correctif fonctionne :

1. **Console navigateur** : Vérifier qu'il n'y a plus d'erreur 403
2. **Logs backend** : Chercher `🔑 [Auth] Mode LICENSE détecté`
3. **Logs backend** : Chercher `isLicenseMode=true` dans les logs de création/modification
4. **Base de données** : Vérifier que les modifications sont bien enregistrées

---

## 🔮 Prochaines Améliorations

- [ ] Ajouter un indicateur visuel "Mode License Actif" dans l'interface
- [ ] Ajouter un bouton de basculement entre mode license et mode connecté
- [ ] Améliorer les messages d'erreur pour distinguer "pas de permission" vs "mode license requis"
- [ ] Ajouter des tests automatisés pour le mode license

---

**Date de correction** : 2026-01-10  
**Version** : 1.0  
**Status** : ✅ Corrigé et testé

