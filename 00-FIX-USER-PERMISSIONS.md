# 🔐 FIX: Permissions d'édition de Compte Utilisateur

## 📋 Résumé des Corrections

### 🐛 Problème Identifié

Quand un utilisateur non-admin essayait de modifier son propre compte dans "Compte Utilisateur", le système affichait:
```
⚠️ "Vous n'avez pas la permission de modifier les utilisateurs"
```

Mais le **backend AUTORISAIT** les utilisateurs à modifier leur propre compte. Le problème était au **frontend** qui était trop restrictif.

### ✅ Solutions Implémentées

#### 1️⃣ **Correction: Fonction `canEditUser`** (ligne 235-243)

**AVANT:**
```javascript
const canEditUser = useCallback((user) => {
  // Seuls les admins peuvent modifier
  return canManageUsers;
}, [canManageUsers]);
```

**APRÈS:**
```javascript
const canEditUser = useCallback((user) => {
  // Cas 1: Utilisateur modifie son propre compte = AUTORISÉ
  if (currentUser?.id === user.id) {
    return true;
  }
  // Cas 2: Modification d'un autre compte = Admin seulement
  return canManageUsers;
}, [currentUser?.id, canManageUsers]);
```

**Impact:**
- ✅ Les utilisateurs peuvent modifier leur propre compte SANS être admin
- ✅ Les admins peuvent modifier les autres comptes
- ✅ Les non-admins NE PEUVENT PAS modifier les autres comptes

#### 2️⃣ **Correction: Fonction `handleInlineEdit`** (ligne 218-233)

**AVANT:**
```javascript
if (!canManageUsers) {
  alert('⚠️ Vous n\'avez pas la permission de modifier les utilisateurs');
  return;
}
```

**APRÈS:**
```javascript
if (!canEditUser(user)) {
  const isOwnAccount = currentUser?.id === user.id;
  const message = isOwnAccount 
    ? '⚠️ Vous n\'avez pas la permission de modifier votre propre compte'
    : '⚠️ Seuls les administrateurs peuvent modifier les comptes d\'autres utilisateurs';
  alert(message);
  return;
}
```

**Impact:**
- ✅ Messages d'erreur plus clairs et précis
- ✅ Distingue "propre compte" vs "autre compte"
- ✅ Utilise la logique corrigée `canEditUser()`

---

## 🎯 Résultats

### Avant les corrections
| Action | Autorisé? | Message |
|--------|----------|---------|
| Modifier mon propre compte | ❌ | "pas de permission" |
| Modifier autre compte (admin) | ✅ | Fonctionne |
| Modifier autre compte (non-admin) | ❌ | "pas de permission" |

### Après les corrections
| Action | Autorisé? | Message |
|--------|----------|---------|
| Modifier mon propre compte | ✅ | Fonctionne (aucun message) |
| Modifier autre compte (admin) | ✅ | Fonctionne |
| Modifier autre compte (non-admin) | ❌ | "Seuls les admins..." |

---

## 📚 Synchronisation - Confirmée ✅

La synchronisation avec Google Sheets fonctionne TOUJOURS (elle n'a jamais été cassée):

1. **Modification locale** (instantanée)
   - Frontend met à jour l'affichage

2. **Sauvegarde en DB** (500ms debounce)
   - Appel `PUT /api/users/:id`
   - Modification stockée dans SQLite

3. **Ajout à l'outbox** (immédiat)
   - Entrée créée dans table `outbox`
   - Type: `users`, action: `upsert`
   - Inclut: uuid, username, phone, is_admin, etc.

4. **Sync en background** (5-30 secondes)
   - SyncWorker détecte les entrées
   - Envoie vers Google Sheets
   - Marque comme synchronisé

**Vous n'avez RIEN à faire** - tout est automatique !

---

## 🔍 Détails Techniques

### Logique de Permission

```javascript
/**
 * Détermine si un utilisateur peut modifier un compte
 */
const canEditUser = (user) => {
  // ✅ Cas 1: Modification de son propre compte
  // Autorisé pour TOUS les utilisateurs connectés
  if (currentUser?.id === user.id) {
    return true;
  }
  
  // ❌ Cas 2: Modification d'un autre compte
  // Autorisé SEULEMENT si l'utilisateur courant est admin
  return canManageUsers;
};
```

### Flux Détaillé

```
Utilisateur clique sur "Modifier mon compte"
    ↓
handleInlineEdit() appelé
    ↓
canEditUser(user) check
    ├─ currentUser.id === user.id ? → true → Continue ✅
    └─ Sinon → check canManageUsers
        ├─ Admin ? → true → Continue ✅
        └─ Non-admin ? → false → Alert ❌
    ↓
setEditingField() + setEditingValue()
    ↓
Champ devient éditable
    ↓
Utilisateur modifie
    ↓
handleInlineSave() appelé
    ↓
saveFieldChange() appelé (500ms debounce)
    ↓
PUT /api/users/:id
    ├─ Backend vérifie: userId === currentUserId OR isAdmin
    ├─ Oui → Mise à jour + outbox ✅
    └─ Non → 403 Forbidden ❌
    ↓
Sync automatique vers Sheets
```

---

## 🧪 Test de Vérification

Pour vérifier que tout fonctionne:

### Test 1: Modifier votre propre compte
```
1. Connectez-vous (n'importe quel utilisateur)
2. Allez sur "Compte Utilisateur"
3. Trouvez votre propre compte dans la liste
4. Cliquez sur "Modifier" (nom/phone/password)
5. Entrez une nouvelle valeur
6. ✅ Devrait fonctionner (pas de message d'erreur)
7. ✅ Vérifiez Google Sheets après 10-30s
```

### Test 2: Admin modifie autre compte
```
1. Connectez-vous comme ADMIN
2. Allez sur "Compte Utilisateur"
3. Trouvez un autre utilisateur
4. Cliquez sur "Modifier"
5. ✅ Devrait fonctionner
6. ✅ Vérifiez Google Sheets après 10-30s
```

### Test 3: Non-Admin essaie de modifier autre compte
```
1. Connectez-vous comme VENDEUR (non-admin)
2. Allez sur "Compte Utilisateur"
3. Trouvez un AUTRE utilisateur (pas vous)
4. Cliquez sur "Modifier"
5. ❌ Alert "Seuls les administrateurs..."
6. ❌ Action bloquée
```

---

## 📝 Fichiers Modifiés

- [UsersPage.jsx](d:\logiciel\La Grace pro\v1\src\ui\pages\UsersPage.jsx)
  - Ligne 218-233: Fonction `handleInlineEdit` (messages clairs)
  - Ligne 235-243: Fonction `canEditUser` (logique corrigée)

---

## 🎓 Résumé pour l'Utilisateur

| Question | Réponse |
|----------|--------|
| Je peux modifier mon compte ? | ✅ OUI, sans être admin |
| Ma modification se sync dans Sheets ? | ✅ OUI, automatiquement |
| Quand ? | ⏱️ 5-30 secondes après |
| Je dois faire quoi ? | ❌ RIEN, tout automatique |
| Pourquoi j'avais le message "pas de permission" avant ? | Bug frontend fixé |
