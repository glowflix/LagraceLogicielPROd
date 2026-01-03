# 📁 Localisation de la Base de Données - PRODUCTION

## 🎯 Où est stockée la BD SQLite?

La base de données SQLite (`glowflixprojet.db`) est stockée **en dehors du dossier d'installation Electron** pour persister les données même après désinstallation.

### Windows (Production)
```
C:\Users\<USERNAME>\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
```

**Exemple:**
```
C:\Users\john\AppData\Roaming\Glowflixprojet\
├── db/
│   ├── glowflixprojet.db          ← BASE DE DONNÉES (PERSISTENTE)
│   └── glowflixprojet.db-shm      ← WAL temporary file
├── data/
│   ├── cache/
│   ├── imports/
│   ├── exports/
│   ├── backups/
│   └── attachments/
├── logs/
├── config/
└── printer/
```

### macOS (Production)
```
~/Library/Application Support/Glowflixprojet/db/glowflixprojet.db
```

### Linux (Production)
```
~/.config/Glowflixprojet/db/glowflixprojet.db
```

## 🔧 Code: Initialisation Electron

Dans [electron/main.cjs](electron/main.cjs#L155):

```javascript
// Production: AppData/Roaming/Glowflixprojet
// Development: C:\Glowflixprojet
const defaultProdRoot = path.join(app.getPath('appData'), 'Glowflixprojet');
process.env.GLOWFLIX_ROOT_DIR = dataRoot;
```

## 🗂️ Code: Résolution des chemins

Dans [src/core/paths.js](src/core/paths.js):

```javascript
export function getProjectRoot() {
  // Mode Electron → userData (AppData/Roaming)
  if (isElectron && global.__ELECTRON_APP__) {
    return global.__ELECTRON_APP__.getPath("userData");
  }
  
  // Mode CLI/Dev → C:\Glowflixprojet
  return process.env.GLOWFLIX_ROOT_DIR
    ? path.resolve(process.env.GLOWFLIX_ROOT_DIR)
    : (process.platform === "win32" 
      ? "C:\\Glowflixprojet" 
      : path.join(os.homedir(), "Glowflixprojet"));
}

export function getDbPath() {
  const root = getProjectRoot();
  return path.join(root, "db", "glowflixprojet.db");
}
```

## 🚀 Initialisation de la BD

Dans [src/db/sqlite.js](src/db/sqlite.js#L18):

```javascript
export function getDb() {
  if (db) return db;
  
  ensureDirs();  // ← Crée les dossiers si nécessaire
  const dbPath = getDbPath();
  
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');    // ← Mode Write-Ahead Logging (stable)
  db.pragma('synchronous = NORMAL');  // ← Performance + sécurité
  db.pragma('busy_timeout = 5000');
  
  return db;
}
```

Dans [src/api/server.js](src/api/server.js#L180):

```javascript
export async function startBackend({ port, host, staticDir, isElectron }) {
  // ...
  initSchema();  // ← Initialise la BD au démarrage
}
```

---

## ❌ npm ET node_modules : PAS INCLUS EN PRODUCTION

### Dossier d'installation Electron
```
C:\Program Files\LA GRACE POS\
├── app/
│   ├── src/              ← Code source compilé
│   ├── dist/ui/          ← Interface React compilée
│   ├── electron/
│   ├── print/
│   ├── asset/
│   ├── package.json      ← Métadonnées UNIQUEMENT
│   └── node_modules/     ← ❌ INCLUS mais NON accessible en usage normal
├── resources/
│   └── ai/               ← IA embarquée (ai-lagrace.exe)
└── electron.exe
```

### Configuration electron-builder.json

```json
{
  "files": [
    "electron/**/*",
    "src/**/*",
    "dist/ui/**/*",
    "asset/**/*",
    "print/**/*",
    "package.json",
    "!node_modules/**/*.{md,ts,map}"  ← ❌ Exclut les fichiers inutiles
  ],
  "asarUnpack": [
    "**/*.node",
    "node_modules/better-sqlite3/**",  ← ✅ Décompresse les modules natifs
    "node_modules/bcrypt/**"
  ],
  "extraResources": [
    {
      "from": "dist/ai/ai-lagrace",     ← IA compilée (STANDALONE)
      "to": "ai"
    }
  ]
}
```

### Configuration package.json build

```json
{
  "build": {
    "files": [
      "electron/**/*",
      "src/**/*",
      "dist/ui/**/*",        ← React compilée
      "asset/**/*",
      "print/**/*",
      "package.json"         ← SEULEMENT les métadonnées
    ],
    "asarUnpack": [
      "**/*.node",
      "node_modules/better-sqlite3/**",
      "node_modules/bcrypt/**"
    ]
  }
}
```

### ⚠️ Modules natifs inclus (nécessaires)

Uniquement **les modules avec code natif C++** sont inclus:
- ✅ `better-sqlite3` (accès BD)
- ✅ `bcrypt` (chiffrement)

Les modules purs JavaScript SONT inclus mais compressés dans `app.asar`.

---

## 🔄 Flux de démarrage

```
1. Utilisateur lance: LA GRACE POS.exe
   ↓
2. electron/main.cjs:
   - Définit GLOWFLIX_ROOT_DIR = C:\Users\<user>\AppData\Roaming\Glowflixprojet
   ↓
3. startBackendInProcess()
   - Import server.js
   ↓
4. server.js:startBackend()
   - initSchema()
   ↓
5. src/db/sqlite.js:getDb()
   - Utilise getProjectRoot() → userData (AppData)
   - Ouvre C:\Users\<user>\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
   - Crée si nécessaire
   ↓
6. Serveur écoute sur 0.0.0.0:3030
   ↓
7. Fenêtre Electron charge http://localhost:3030/
   ↓
8. React UI + Socket.IO = APP PRÊTE
```

---

## ✅ Vérification: 0 npm lors de l'installation

### Avant installation
```powershell
PS> npm install          ← Crée node_modules/
PS> npm run build:ai     ← Crée dist/ai/ai-lagrace.exe
PS> npm run build:ui     ← Crée dist/ui/
PS> npm run build:electron ← electron-builder crée le setup
```

### Pendant installation
```
LA GRACE POS Setup 1.0.0.exe
  ↓
Accepter conditions
  ↓
Choisir dossier d'installation (C:\Program Files\LA GRACE POS)
  ↓
Installation (copie fichiers, crée shortcuts)
  ↓
✅ Installation complète - 0 npm lancé
```

### Après installation
```powershell
PS> cd "C:\Program Files\LA GRACE POS"
PS> ls  ↓ Fichiers: app/, resources/, electron.exe
# ❌ Pas de node_modules/ visible, pas d'appels npm
```

### Au démarrage de l'app
```
LA GRACE POS.exe
  ↓
main.cjs charge via Electron asar
  ↓
No npm/npm commands executed
  ↓
Serveur Express démarre in-process
  ↓
BD ouvre depuis AppData/Roaming
  ↓
✅ App prête
```

---

## 🛡️ Sécurité: BD persistente

La BD n'est **PAS supprimée** lors de la désinstallation:

```powershell
# Après désinstallation
C:\Users\john\AppData\Roaming\Glowflixprojet\  ← ✅ PERSISTE
  db/glowflixprojet.db
  data/
  logs/
```

### Réinstallation
```
La réinstallation se connecte à la même BD existante
→ Les données restent intactes
```

### Suppression manuelle (si nécessaire)
```powershell
PS> Remove-Item "$env:APPDATA\Glowflixprojet" -Recurse -Force
# Supprime BD + tous les fichiers de l'app
```

---

## 📊 Résumé

| Aspect | Localisation | Persiste? |
|--------|---|---|
| **App** | `C:\Program Files\LA GRACE POS\` | ❌ Supprimée à la désinstallation |
| **BD SQLite** | `C:\Users\<user>\AppData\Roaming\Glowflixprojet\db\` | ✅ Persiste |
| **Données** | `C:\Users\<user>\AppData\Roaming\Glowflixprojet\data\` | ✅ Persiste |
| **Logs** | `C:\Users\<user>\AppData\Roaming\Glowflixprojet\logs\` | ✅ Persiste |
| **npm** | **0 occurrence après build** | ✅ Aucune dépendance npm à l'exécution |

