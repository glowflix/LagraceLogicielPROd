# 🔐 Fix UsersPage.jsx: Permissions Frontend Granulaires

## 📋 Résumé des Changements

Déplacement de **contrôles d'accès globaux** à **permissions granulaires par action**.

---

## ❌ Avant (Problématique)

### 1. Page-level Gate
```jsx
if (!canManageUsers) {
  return (
    <div>Accès Restreint - Seuls les admins</div>
  );
}
```
**Problème:** Non-admins ne peuvent pas voir la liste des utilisateurs ni modifier leur propre compte

---

### 2. handleToggle sans vérification
```jsx
const handleToggle = useCallback(async (userId, field) => {
  const user = users.find(u => u.id === userId);
  if (!user) return;
  
  const newValue = !(user[field] === 1 || user[field] === true);
  await saveFieldChange(userId, field, newValue);  // ❌ Pas de vérif de permission!
}, [users, saveFieldChange]);
```
**Problème:** Backend bloquerait is_admin, mais UI permet le clic → confusion utilisateur

---

### 3. Boutons toujours cliquables
```jsx
<button
  onClick={(e) => {
    e.stopPropagation();
    handleToggle(user.id, 'is_admin');
  }}
  className={`badge flex items-center gap-1 text-xs transition-all ${
    isAdmin ? 'badge-warning' : 'badge-secondary'
  }`}
>
  <Shield className="w-3 h-3" />
  {isAdmin ? 'Admin' : 'Vendeur'}
</button>
```
**Problème:** Visuellement cliquables même si backend refusera → mauvaise UX

---

### 4. canEditUser() trop simple
```jsx
const canEditUser = useCallback((user) => {
  if (currentUser?.id === user.id) return true;    // Toujours autorisé
  return canManageUsers;                            // Sans distinction de permission
}, [currentUser?.id, canManageUsers]);
```
**Problème:** Ne distingue pas MANAGE_USERS_SELF vs MANAGE_USERS_ALL

---

## ✅ Après (Sécurisé et Clair)

### 1. Nouvelles Variables de Permission
```jsx
const canManageUsersSelf = useMemo(() => hasPermission(userRole, PERMISSIONS.MANAGE_USERS_SELF), [userRole]);
const canManageUsersAll = useMemo(() => hasPermission(userRole, PERMISSIONS.MANAGE_USERS_ALL), [userRole]);
const canToggleAdmin = useMemo(() => hasPermission(userRole, PERMISSIONS.TOGGLE_ADMIN), [userRole]);
```
**Bénéfice:** Code explicite + aligné avec backend

---

### 2. handleToggle Sécurisé
```jsx
const handleToggle = useCallback(async (userId, field) => {
  const user = users.find(u => u.id === userId);
  if (!user) return;

  // ✅ Protection: is_admin ne peut être modifié que par OWNER
  if (field === 'is_admin' && !canToggleAdmin) {
    alert('⚠️ Seul le créateur peut changer le statut administrateur');
    return;
  }

  // ✅ Protection: Peut modifier is_active seulement sur son propre compte OU si admin/owner
  if (field === 'is_active' && userId !== currentUser?.id && !canManageUsersAll) {
    alert('⚠️ Vous ne pouvez changer le statut que de votre propre compte');
    return;
  }
  
  const newValue = !(user[field] === 1 || user[field] === true);
  await saveFieldChange(userId, field, newValue);
}, [users, saveFieldChange, canToggleAdmin, canManageUsersAll, currentUser?.id]);
```
**Bénéfice:** 
- Frontend bloque avant d'appeler backend
- Messages d'erreur clairs
- Règles métier explicitées

---

### 3. Boutons Visuellement Désactivés
```jsx
{/* Bouton is_admin - Seul OWNER peut modifier */}
<button
  disabled={!canToggleAdmin}
  onClick={(e) => {
    e.stopPropagation();
    handleToggle(user.id, 'is_admin');
  }}
  className={`badge flex items-center gap-1 text-xs transition-all ${
    !canToggleAdmin ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
  } ${
    isAdmin ? 'badge-warning' : 'badge-secondary'
  }`}
  title={canToggleAdmin ? "Cliquer pour modifier le statut administrateur" : "Seul le créateur peut modifier le statut administrateur"}
>
  <Shield className="w-3 h-3" />
  {isAdmin ? 'Admin' : 'Vendeur'}
</button>

{/* Bouton is_active - Propriétaire peut modifier tout, autres seulement leur compte */}
<button
  disabled={user.id !== currentUser?.id && !canManageUsersAll}
  onClick={(e) => {
    e.stopPropagation();
    handleToggle(user.id, 'is_active');
  }}
  className={`badge flex items-center gap-1 text-xs transition-all ${
    (user.id !== currentUser?.id && !canManageUsersAll) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
  } ${
    isActive ? 'badge-success' : 'badge-error'
  }`}
  title={
    user.id === currentUser?.id ? "Cliquer pour modifier votre statut" :
    canManageUsersAll ? "Cliquer pour modifier le statut" :
    "Vous pouvez seulement modifier votre propre compte"
  }
>
  {/* ... */}
</button>
```
**Bénéfice:**
- Visuellement clair si on peut cliquer (opacity-50 + cursor-not-allowed)
- Tooltip explique pourquoi c'est désactivé
- Cohérent avec backend (UI + backend = même règle)

---

### 4. canEditUser() Aligne aux Permissions
```jsx
const canEditUser = useCallback((user) => {
  // Cas 1: Modifier son propre compte = AUTORISÉ si permission MANAGE_USERS_SELF
  if (currentUser?.id === user.id) {
    return canManageUsersSelf;
  }
  // Cas 2: Modifier un AUTRE compte = AUTORISÉ seulement si MANAGE_USERS_ALL
  return canManageUsersAll;
}, [currentUser?.id, canManageUsersSelf, canManageUsersAll]);
```
**Bénéfice:**
- Distinction claire: propre compte vs autres comptes
- Respecte granularité des permissions

---

### 5. Page-level Gate Supprimé
```jsx
// ✅ Afficher la page à tous, mais contrôler l'accès aux actions
// (Au lieu de bloquer l'accès complètement)
```
**Bénéfice:**
- Utilisateurs peuvent voir la liste (non-intrusive)
- Actions sont protégées (sécurisé)
- Non-admins peuvent modifier leur propre compte

---

### 6. Messages d'Erreur Améliorés
```jsx
const message = isOwnAccount 
  ? '⚠️ Vous n\'avez pas la permission de modifier votre propre compte'
  : '⚠️ Vous n\'avez pas la permission de modifier les autres comptes. Vous pouvez seulement modifier votre propre compte.';
```
**Bénéfice:** 
- Clair quelle action est bloquée et pourquoi
- Suggère une alternative (modifier son propre compte)

---

## 🧪 Matrice de Permissions

| Rôle | propre compte | modifier autres | toggle is_admin |
|------|-----------------|-----------------|-----------------|
| OWNER | ✅ MANAGE_USERS_SELF | ✅ MANAGE_USERS_ALL | ✅ TOGGLE_ADMIN |
| ADMIN | ✅ MANAGE_USERS_SELF | ✅ MANAGE_USERS_ALL | ❌ TOGGLE_ADMIN |
| VENDEUR | ✅ MANAGE_USERS_SELF | ❌ MANAGE_USERS_ALL | ❌ TOGGLE_ADMIN |
| BLOQUÉ | ❌ MANAGE_USERS_SELF | ❌ MANAGE_USERS_ALL | ❌ TOGGLE_ADMIN |

---

## 🔍 Cas d'Usage

### Cas 1: OWNER (créateur)
```
✅ Voir la liste des utilisateurs
✅ Modifier son propre compte
✅ Modifier les autres comptes
✅ Promouvoir quelqu'un à admin
✅ Rétrograder admin à vendeur
```

### Cas 2: ADMIN (non-créateur)
```
✅ Voir la liste des utilisateurs
✅ Modifier son propre compte
✅ Modifier les autres comptes
❌ Promouvoir à admin (bouton disabled + tooltip)
❌ Rétrograder admin (bouton disabled + tooltip)
```

### Cas 3: VENDEUR
```
✅ Voir la liste des utilisateurs
✅ Modifier son propre compte
❌ Modifier les autres (canEditUser() retourne false)
❌ toggle is_admin (handleToggle bloque avant API)
```

### Cas 4: Utilisateur Bloqué
```
❌ Voir la liste (accès API refusé par authenticate)
```

---

## 📦 Fichier Modifié

**src/ui/pages/UsersPage.jsx**
- ✅ Ajouté canManageUsersSelf, canManageUsersAll, canToggleAdmin
- ✅ handleToggle: Vérification permission avant modification
- ✅ Boutons toggle: disabled visuel + title/tooltip
- ✅ canEditUser: Aligné aux permissions granulaires
- ✅ handleInlineEdit: Messages d'erreur améliorés
- ✅ Supprimé page-level gate (if !canManageUsers)

---

## 🎯 Résultat

| Avant | Après |
|-------|-------|
| Contrôle global (tout ou rien) | Permissions granulaires par action |
| Page cachée aux non-admins | Page visible, actions restreintes |
| Boutons cliquables même sans perm | Boutons disabled visuel si pas perm |
| Confusion: UI dit oui, backend dit non | Cohérence: UI et backend même règle |
| Messages génériques | Messages clairs et spécifiques |

