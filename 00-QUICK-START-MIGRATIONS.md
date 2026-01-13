# ⚡ Quick Start: Exécution des Fixes

Copie-colle les commandes ci-dessous pour activer tous les fixes.

---

## 🚀 Étape 1: Appliquer les Migrations (Base de Données)

### Windows PowerShell

```powershell
# Chemin de la DB
$dbPath = "d:\logiciel\La Grace pro\v1\src\db\gestion_magasin.db"
$migrationsPath = "d:\logiciel\La Grace pro\v1\src\db\migrations"

# Étape 1: Ajouter colonne is_owner
Write-Host "📦 Migration 1: Ajout de is_owner..." -ForegroundColor Cyan
sqlite3 $dbPath < "$migrationsPath\add_is_owner.sql"
Write-Host "✅ is_owner ajouté" -ForegroundColor Green

# Étape 2: Ajouter soft delete pour produits
Write-Host "📦 Migration 2: Ajout de soft delete produits..." -ForegroundColor Cyan
sqlite3 $dbPath < "$migrationsPath\add_soft_delete_products.sql"
Write-Host "✅ deleted_at ajouté aux produits" -ForegroundColor Green

# Étape 3: Marquer le créateur comme OWNER
Write-Host "📦 Migration 3: Marquage du créateur comme OWNER..." -ForegroundColor Cyan
sqlite3 $dbPath < "$migrationsPath\mark_creator_as_owner.sql"
Write-Host "✅ Créateur marqué OWNER" -ForegroundColor Green

# Vérifier que tout a marché
Write-Host "`n🔍 Vérification..." -ForegroundColor Yellow
Write-Host "Utilisateurs OWNER:" -ForegroundColor Cyan
sqlite3 $dbPath "SELECT id, username, is_owner FROM users WHERE is_owner=1;"

Write-Host "`nColonne is_owner:" -ForegroundColor Cyan
sqlite3 $dbPath "PRAGMA table_info(users);" | Select-String "is_owner"

Write-Host "`nColonne deleted_at:" -ForegroundColor Cyan
sqlite3 $dbPath "PRAGMA table_info(products);" | Select-String "deleted_at"
```

### Ou Command Prompt (CMD)

```batch
set dbPath=d:\logiciel\La Grace pro\v1\src\db\gestion_magasin.db
set migrationsPath=d:\logiciel\La Grace pro\v1\src\db\migrations

echo. & echo Migration 1: is_owner
sqlite3 "%dbPath%" < "%migrationsPath%\add_is_owner.sql"

echo. & echo Migration 2: soft delete produits
sqlite3 "%dbPath%" < "%migrationsPath%\add_soft_delete_products.sql"

echo. & echo Migration 3: marquer createur OWNER
sqlite3 "%dbPath%" < "%migrationsPath%\mark_creator_as_owner.sql"

echo. & echo Verification:
sqlite3 "%dbPath%" "SELECT id, username, is_owner FROM users WHERE is_owner=1;"
```

### Ou Bash (Linux/Mac)

```bash
dbPath="d:\logiciel\La Grace pro\v1\src\db\gestion_magasin.db"
migrationsPath="d:\logiciel\La Grace pro\v1\src\db\migrations"

echo "Migration 1: is_owner"
sqlite3 "$dbPath" < "$migrationsPath/add_is_owner.sql"

echo "Migration 2: soft delete produits"
sqlite3 "$dbPath" < "$migrationsPath/add_soft_delete_products.sql"

echo "Migration 3: marquer createur OWNER"
sqlite3 "$dbPath" < "$migrationsPath/mark_creator_as_owner.sql"

echo "Vérification:"
sqlite3 "$dbPath" "SELECT id, username, is_owner FROM users WHERE is_owner=1;"
```

---

## 🎯 Étape 2: Redémarrer l'Application

```bash
# Arrêter l'app actuelle (Ctrl+C dans le terminal)

# Puis redémarrer
npm start
```

---

## ✅ Étape 3: Tests Rapides

### Test 1: Suppression de Vente (Non-Blocking)

```
1. Ouvrir SalesPOS
2. Vendre un produit
3. Aller dans SalesHistory
4. Supprimer la vente
   → ✅ Disparaît IMMÉDIATEMENT
   → ✅ SalesPOS reste cliquable
   → ✅ Historique mis à jour après 3-5 sec
```

### Test 2: Modification Compte en Mode Licence

```
1. Activer la licence
2. Aller dans "Compte Utilisateur"
3. Modifier le mot de passe
4. Cliquer "Sauvegarder"
   → ✅ Sauvegardé immédiatement (pas de freeze)
   → ✅ Synchro Sheets après 5-30 sec
```

### Test 3: Permissions Granulaires (UsersPage)

```
1. Se connecter en tant que NON-ADMIN
2. Aller dans "Utilisateurs"
   → ✅ Voir la liste (pas de "Accès Restreint")
3. Cliquer sur son propre compte
   → ✅ Pouvoir modifier (nom, téléphone, etc.)
4. Cliquer sur bouton "Admin" pour un autre utilisateur
   → ✅ Bouton DISABLED + opacity-50
   → ✅ Tooltip: "Seul le créateur peut modifier le statut"
   → ✅ Clic affiche erreur claire
```

### Test 4: Soft Delete Produits

```
1. Aller dans "Produits"
2. Supprimer un produit
   → ✅ Disparaît immédiatement
3. Recréer un produit avec le MÊME CODE
   → ✅ Réactivé automatiquement
   → ✅ Retrouve ses propriétés (prix, stock)
4. Vérifier audit log (ou admin panel)
   → ✅ product_delete enregistré
```

### Test 5: OWNER vs ADMIN

```
1. Se connecter avec le CRÉATEUR (OWNER)
2. Aller dans "Utilisateurs"
3. Cliquer "Admin" sur un autre user
   → ✅ Bouton ACTIF (pas disabled)
   → ✅ Peut promouvoir

4. Se déconnecter, connecter un ADMIN (non-créateur)
5. Cliquer "Admin" sur un autre user
   → ✅ Bouton DISABLED
   → ✅ Tooltip: "Seul le créateur..."
   → ✅ Message d'erreur si on essaie
```

---

## 🔧 Troubleshooting

### Migration Échoue: "UNIQUE constraint failed"

```bash
# Vérifier les colonnes existantes
sqlite3 "d:\logiciel\La Grace pro\v1\src\db\gestion_magasin.db" "PRAGMA table_info(users);"

# Si is_owner existe déjà, continuer (c'est OK)
# Si deleted_at existe déjà, continuer (c'est OK)
```

### App Crash après migration

```
1. Vérifier les logs:
   - Terminal affiche erreur?
   - npm console affiche undefined?

2. Redémarrer:
   - Ctrl+C pour arrêter
   - npm start pour relancer

3. Si persist:
   - Vérifier que SQLite est à jour
   - Vérifier chemins absolus des migrations
```

### Permissions ne changent pas

```
1. Recharger la page (F5)
2. Vider le cache browser (Ctrl+Shift+Del)
3. Vérifier console (F12) pour erreurs
4. Vérifier is_owner en DB:
   sqlite3 "..." "SELECT id, username, is_owner FROM users;"
```

---

## 📊 Vérifier le Statut

### Voir tous les utilisateurs et rôles

```bash
sqlite3 "d:\logiciel\La Grace pro\v1\src\db\gestion_magasin.db" "SELECT id, username, is_owner, is_admin, is_active FROM users ORDER BY id;"
```

### Voir produits ACTIFS vs SUPPRIMÉS

```bash
# Actifs
sqlite3 "..." "SELECT code, name FROM products WHERE is_active=1 AND deleted_at IS NULL LIMIT 10;"

# Supprimés
sqlite3 "..." "SELECT code, name, deleted_at FROM products WHERE deleted_at IS NOT NULL LIMIT 10;"
```

### Voir si migrations appliquées

```bash
# Check is_owner colonne
sqlite3 "..." ".schema users" | grep -i is_owner

# Check deleted_at colonne
sqlite3 "..." ".schema products" | grep -i deleted_at
```

---

## 🎓 Résumé Rapide

| Étape | Commande | Résultat |
|-------|----------|---------|
| 1 | Migrations SQL | ✅ Colonnes ajoutées |
| 2 | npm start | ✅ App redémarrée |
| 3 | Tester suppression | ✅ Instantané (pas de freeze) |
| 4 | Tester permissions | ✅ Granulaires, buttons disabled |
| 5 | Tester soft delete | ✅ Réactivation automatique |

---

## ❓ Support

Si quelque chose ne fonctionne pas:

1. Vérifier les logs (F12 Console)
2. Vérifier la DB (sqlite3 queries)
3. Redémarrer l'app
4. Vérifier que toutes les migrations sont appliquées
5. Vider le cache (Ctrl+Shift+Del)

