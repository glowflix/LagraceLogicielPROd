# 🔐 Système RBAC PRO - LA GRACE

## Vue d'ensemble

Le système de contrôle d'accès basé sur les rôles (RBAC) permet de gérer précisément les permissions de chaque utilisateur selon son profil.

---

## 📋 Rôles Utilisateurs

### 👑 ADMIN (is_admin = OUI)
**Accès TOTAL** à toutes les fonctionnalités :
- ✅ Dashboard
- ✅ Ventes (POS)
- ✅ Historique des ventes
- ✅ Produits
- ✅ New Arrivage
- ✅ Gestion des utilisateurs
- ✅ Dettes
- ✅ Statistiques
- ✅ Paramètres
- ✅ Synchronisation
- ✅ Licence

**Actions spéciales :**
- Créer/modifier/bloquer des comptes
- Modifier les prix et le stock
- Accès total à la configuration

---

### 🏪 VENDEUR_SEULEMENT (is_vendeur = OUI)
**Accès limité aux ventes :**
- ✅ Ventes (POS)
- ✅ Historique des ventes
- ❌ Dashboard
- ❌ Produits
- ❌ Utilisateurs
- ❌ Dettes
- ❌ Statistiques
- ❌ Paramètres
- ❌ Synchronisation

**Redirection automatique :** `/sales`

---

### 📦 GERANT_STOCK (is_gerant_stock = OUI)
**Accès ventes + produits :**
- ✅ Dashboard
- ✅ Ventes (POS)
- ✅ Historique des ventes
- ✅ Produits
- ✅ New Arrivage
- ❌ Utilisateurs
- ❌ Dettes
- ❌ Statistiques
- ❌ Paramètres

**Actions spéciales :**
- Peut modifier le stock
- Ne peut PAS modifier les prix

**Redirection automatique :** `/products`

---

### 🛒 VENDEUR_STOCK (is_vendeur + is_gerant_stock = OUI)
**Accès ventes + produits complet :**
- ✅ Dashboard
- ✅ Ventes (POS)
- ✅ Historique des ventes
- ✅ Produits
- ✅ New Arrivage
- ❌ Utilisateurs
- ❌ Dettes
- ❌ Statistiques

**Actions spéciales :**
- Peut modifier le stock ET les prix

**Redirection automatique :** `/sales`

---

### 📝 LICENSE_ONLY (Licence seule, pas de login)
**Accès TOTAL** comme ADMIN

---

### 🚫 BLOCKED (is_active = false)
**Aucun accès** - Message affiché :
> "Compte Bloqué - Contactez La Grâce"

---

## 🔄 Flux de Connexion

```
┌─────────────┐
│   LOGIN     │
└─────┬───────┘
      │
      ▼
┌─────────────┐     NON     ┌─────────────────┐
│ is_active?  │ ──────────► │  PAGE BLOCKED   │
└─────┬───────┘             │  "Compte Bloqué │
      │ OUI                 │  Contactez La   │
      ▼                     │  Grâce"         │
┌─────────────┐             └─────────────────┘
│ Quel rôle?  │
└─────┬───────┘
      │
      ├── ADMIN ────────────► /dashboard
      │
      ├── VENDEUR_SEULEMENT ─► /sales
      │
      ├── GERANT_STOCK ─────► /products
      │
      └── VENDEUR_STOCK ────► /sales
```

---

## 👤 Nom du Vendeur Automatique

Le nom du vendeur est automatiquement défini selon le compte connecté :

| Situation | Nom affiché |
|-----------|-------------|
| Admin connecté | "Admin" |
| Licence seule (pas de login) | "Admin" |
| Vendeur connecté | Nom d'utilisateur (ex: "Frank", "Archile") |

---

## 🔑 Clé de Licence Masquée

La clé de licence est **toujours masquée** avec des points (`••••••••••`) pour la sécurité.

---

## 📊 Colonnes Google Sheets

Les permissions sont basées sur ces colonnes de la feuille "Compter Utilisateur" :

| Colonne | Description |
|---------|-------------|
| `admi` | Admin (OUI/NON) |
| `Vendeur` | Peut vendre (OUI/NON) |
| `Gerent Stock` | Peut gérer le stock (OUI/NON) |
| `Porudits est Vender` | Peut vendre les produits (OUI/NON) |
| `is_active` | Compte actif (OUI/NON) |

---

## 🛡️ Sécurité

1. **Blocage de compte** : Les comptes avec `is_active = false` sont automatiquement bloqués
2. **Protection des routes** : Chaque route vérifie les permissions avant d'afficher le contenu
3. **Clé masquée** : La clé de licence n'est jamais affichée en clair
4. **Restriction Users** : Seuls les admins peuvent accéder à la page de gestion des utilisateurs

---

## 📁 Fichiers Modifiés

- `src/ui/utils/permissions.js` - Définition des rôles et permissions
- `src/ui/pages/LoginPage.jsx` - Gestion du login avec blocage
- `src/ui/components/ProtectedRoute.jsx` - Protection des routes
- `src/ui/pages/BlockedPage.jsx` - Page compte bloqué (NOUVEAU)
- `src/ui/pages/SalesPOS.jsx` - Nom vendeur automatique
- `src/ui/pages/LicensePage.jsx` - Clé masquée
- `src/ui/pages/UsersPage.jsx` - Accès admin seulement
- `src/ui/App.jsx` - Route /blocked ajoutée

---

**Version:** 1.0  
**Date:** 2024  
**LA GRACE PRO - Système de Gestion de Ventes**
