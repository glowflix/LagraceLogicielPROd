# Fix pour better-sqlite3 avec Node.js v24

## Problème
Node.js v24.11.1 nécessite C++20 mais le compilateur utilise C++17, ce qui cause une erreur lors de la compilation de `better-sqlite3`.

## Solutions

### Solution 1 : Utiliser une version récente de better-sqlite3 (Recommandée)
J'ai mis à jour `package.json` pour utiliser `better-sqlite3@^11.7.0` qui supporte Node.js v24.

```bash
npm install
```

### Solution 2 : Si ça ne fonctionne toujours pas, utiliser sql.js (Alternative pure JS)

Si better-sqlite3 ne compile toujours pas, vous pouvez utiliser `sql.js` qui est une version JavaScript pure de SQLite :

```bash
# Supprimer better-sqlite3
npm uninstall better-sqlite3

# Installer sql.js
npm install sql.js
```

Puis modifier `src/db/sqlite.js` pour utiliser sql.js au lieu de better-sqlite3.

### Solution 3 : Downgrader Node.js (Non recommandé)

Installer Node.js v20 LTS qui est compatible avec better-sqlite3 v9.

## Vérification

Après l'installation, vérifiez que tout fonctionne :

```bash
npm run migrate
npm start
```

Si vous voyez "Base de données SQLite connectée", c'est bon ! ✅

