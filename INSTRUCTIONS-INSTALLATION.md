# Instructions d'Installation - LA GRACE

## 🔧 Correction de l'erreur better-sqlite3

### Problème
Node.js v24.11.1 nécessite C++20 mais le compilateur utilise C++17.

### Solution appliquée
J'ai mis à jour `package.json` pour utiliser `better-sqlite3@^11.7.0` qui supporte Node.js v24.

### Étapes d'installation

1. **Nettoyer les anciennes installations** (si nécessaire) :
```bash
# Supprimer node_modules et package-lock.json
rm -rf node_modules package-lock.json
# Sur Windows PowerShell :
Remove-Item -Recurse -Force node_modules, package-lock.json
```

2. **Réinstaller les dépendances** :
```bash
npm install
```

3. **Si l'erreur persiste**, essayez :
```bash
# Installer avec build from source
npm install better-sqlite3 --build-from-source
```

4. **Alternative : Utiliser sql.js** (si better-sqlite3 ne fonctionne toujours pas) :
```bash
npm uninstall better-sqlite3
npm install sql.js
```

Puis modifier `src/db/sqlite.js` pour utiliser sql.js.

## ✅ Vérification

Après l'installation réussie :

```bash
# Initialiser la base de données
npm run migrate

# Démarrer le serveur
npm start
```

Vous devriez voir :
```
✅ Base de données SQLite connectée: C:\Glowflixprojet\db\glowflixprojet.db
🚀 Serveur démarré sur http://localhost:3030
```

## 🎨 Icône LA GRACE

L'icône `asset/image/icon/photo.png` a été intégrée dans :
- ✅ `index.html` (favicon)
- ✅ `Layout.jsx` (sidebar logo)
- ✅ `SplashScreen.jsx` (écran de démarrage)
- ✅ `LicensePage.jsx` (page licence)
- ✅ `LoginPage.jsx` (page connexion)

L'icône est maintenant visible partout dans l'application ! 🎉

## 📝 Notes

- L'icône est servie depuis `/asset/image/icon/photo.png`
- Vite copie automatiquement les fichiers du dossier `asset` lors du build
- Pour le développement, l'icône est accessible directement

