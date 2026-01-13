# 👤 Guide: Compte Utilisateur - Permissions et Synchronisation

## ✅ Permissions - Qui peut modifier quoi ?

### 1️⃣ **MODIFIER SON PROPRE COMPTE** 
- ✅ **AUTORISÉ POUR TOUS** les utilisateurs (connectés)
- Peut modifier:
  - ✏️ Son nom d'utilisateur
  - ✏️ Son mot de passe
  - ✏️ Son numéro de téléphone
  - ✏️ Son marque de device
  - ✏️ Son photo de profil

### 2️⃣ **MODIFIER UN AUTRE COMPTE**
- ❌ **INTERDIT sauf pour les Admins**
- Seuls les administrateurs peuvent:
  - Modifier les comptes d'autres utilisateurs
  - Changer les permissions (Admin/Vendeur)
  - Désactiver/Réactiver un compte
  - Modifier les accès (gérant stock, manage products)

---

## 🔄 Synchronisation avec Google Sheets

### ✅ Automatique en Arrière-Plan

Quand vous modifiez un compte utilisateur:

1. **Sauvegarde locale** (instantanée)
   - Modification affichée immédiatement dans le formulaire
   - Message "Sauvegarde..." s'affiche

2. **Mise à jour de la base de données** (500ms)
   - Debounce de 500ms pour éviter trop de requêtes
   - Modification stockée dans SQLite

3. **Ajout à l'outbox** (immédiat après enregistrement)
   - Entrée ajoutée à la table `outbox`
   - Contient: uuid, username, phone, is_admin, is_active, etc.

4. **Synchronisation avec Sheets** (en background)
   - Le SyncWorker détecte l'entrée dans l'outbox
   - Envoie vers Google Sheets automatiquement
   - Aucune action nécessaire de votre part

### 📋 Timeline Détaillé

```
T+0ms:   Clic sur Modifier
├─ Champ devient éditable
├─ Vous entrez la nouvelle valeur
│
T+500ms: Debounce déclenche sauvegarde
├─ Appel PUT /api/users/:id
├─ Base de données mise à jour
├─ Entrée ajoutée à l'outbox
├─ Frontend montre "Sauvegarde..."
│
T+600ms: Réponse reçue
├─ Champ redevient normal
├─ Message "Sauvegarde..." disparaît
├─ Modification visible dans la liste
│
T+5-30s: SyncWorker détecte outbox
├─ Itère les entrées "users"
├─ Envoie à Google Sheets
├─ Marque comme synchronisé
└─ Refresh de la liste (optionnel)
```

---

## 🎯 Cas d'Usage - Exemples

### Scénario 1: Modifier VOTRE propre mot de passe
```
✅ AUTORISÉ (pas besoin d'être admin)

1. Aller sur "Compte Utilisateur"
2. Cliquer sur "Modifier mot de passe"
3. Entrer le nouveau mot de passe
4. Cliquer ✓
5. Message "Sauvegarde..." s'affiche
6. ✅ Modification sauvegardée
   → Synchronisée automatiquement dans Sheets
```

### Scénario 2: Admin modifie un autre compte
```
✅ AUTORISÉ (admin seulement)

1. Admin va sur "Compte Utilisateur"
2. Clique sur un autre utilisateur
3. Peut modifier tous les champs
4. Peut toggle Admin/Vendeur
5. Peut désactiver/réactiver
6. ✅ Tout sauvegardé automatiquement
   → Synchronisé dans Sheets (en background)
```

### Scénario 3: Non-Admin essaie de modifier un autre compte
```
❌ INTERDIT

Tentative → Alert "Seuls les administrateurs..."
→ Action annulée
→ Impossible de continuer
```

---

## 🔒 Permissions Détaillées

| Permission | Tous | Vendeur | Gérant Stock | Admin |
|-----------|------|---------|--------------|-------|
| Modifier son propre compte | ✅ | ✅ | ✅ | ✅ |
| Modifier autre compte | ❌ | ❌ | ❌ | ✅ |
| Changer Admin/Vendeur | ❌ | ❌ | ❌ | ✅ |
| Désactiver utilisateur | ❌ | ❌ | ❌ | ✅ |
| Créer utilisateur | ❌ | ❌ | ❌ | ✅ |
| Voir tous les comptes | ✅ | ✅ | ✅ | ✅ |

---

## 📊 Vérification de la Synchronisation

### Comment vérifier que ça se synchronise avec Sheets ?

1. **Modifiez un champ** dans "Compte Utilisateur"
2. **Attendez 1-2 secondes** (sauvegarde locale)
3. **Attendez 10-30 secondes** (sync avec Sheets)
4. **Ouvrez Google Sheets** → Feuille "Utilisateurs"
5. **Cherchez votre modification** → Elle doit y être !

### Si ce n'est pas synchronisé ?

Vérifiez:
- ✅ Connexion internet actuelle
- ✅ Service backend est running (`npm start`)
- ✅ SyncWorker est actif (logs dans console)
- ✅ Google Sheets est accessible
- ✅ Compte Google Sheets est partagé correctement

---

## 🛠️ Résolution des Problèmes

### Problème: "Il faut passer en admin pour modifier"
**Cause:** Vous n'êtes pas admin et essayez de modifier un AUTRE compte
**Solution:** Vous pouvez uniquement modifier votre propre compte

### Problème: "Modification non synchronisée dans Sheets"
**Cause:** SyncWorker pas actif ou connexion internet
**Solution:** 
1. Vérifiez connexion
2. Attendez 30 secondes (SyncWorker cycle)
3. Rafraîchissez Google Sheets

### Problème: "Sauvegarde... reste bloqué"
**Cause:** Erreur API ou timeout
**Solution:**
1. Rafraîchissez la page
2. Réessayez la modification
3. Vérifiez les logs backend

---

## ✨ Améliorations Récentes (v1.0)

- ✅ **Correction:** Les utilisateurs peuvent maintenant modifier leur propre compte sans être admin
- ✅ **Messages clairs:** Distingue les erreurs ("autre compte" vs "propre compte")
- ✅ **Sync automatique:** Les modifications sont toujours synchronisées en background vers Sheets
- ✅ **Debounce:** Évite les surcharges (500ms entre modifications)
- ✅ **Feedback instantané:** L'UI montre immédiatement ce qui se passe

---

## 📝 Notes Techniques

### Flux de Synchronisation (Backend)

```javascript
// 1. Frontend appelle PUT /api/users/:id
// 2. Backend vérifie les permissions
if (userId !== currentUserId && !isAdmin) {
  return 403 Forbidden  // ❌ Pas autorisé
}
// 3. Mise à jour de la DB
await usersRepo.update(userId, { field: value });

// 4. Ajout à l'outbox (pour sync Sheets)
syncRepo.addToOutbox('users', user.id, 'upsert', {
  uuid: user.uuid,
  username: user.username,
  phone: user.phone,
  is_admin: user.is_admin,
  // ... autres champs
});

// 5. Retour success au frontend
res.json({ success: true, user });

// 6. SyncWorker (en background) détecte l'outbox
// 7. Envoie vers Google Sheets
// 8. Marque comme synchronisé ✅
```

### Points d'Entrée

| Endpoint | Méthode | Permission | Action |
|----------|---------|-----------|--------|
| `/api/users` | GET | Aucune | Récupérer tous les utilisateurs |
| `/api/users/me` | GET | Auth | Récupérer votre profil |
| `/api/users/:id` | GET | Aucune | Récupérer un utilisateur |
| `/api/users` | POST | Admin | Créer nouvel utilisateur |
| `/api/users/:id` | PUT | Auth | Modifier (self ou admin) |

---

## 🎓 Résumé

| Question | Réponse |
|----------|--------|
| Puis-je modifier mon compte ? | ✅ OUI, toujours autorisé |
| Puis-je modifier un autre compte ? | ❌ NON, sauf si admin |
| Est-ce que ça se sync dans Sheets ? | ✅ OUI, automatiquement |
| Quand est-ce que ça se sync ? | ⏱️ 5-30 secondes après |
| Dois-je faire quelque chose ? | ❌ NON, tout automatique |
| Pourquoi "faut passer en admin" ? | Vous modifiez quelqu'un d'autre |
