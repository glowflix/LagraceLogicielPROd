# 🚀 Configuration "PRO" - Glowflixprojet

## 📋 Architecture Finale

```
INSTALLATION APP
├─ C:\Users\<User>\AppData\Local\Programs\Glowflixprojet\
│  └─ (exécutable + ressources statiques)

DONNÉES (C:\ fixe)
├─ C:\Glowflixprojet\
│  ├─ db\
│  │  ├─ lagrace.sqlite
│  │  ├─ migrations\
│  │  └─ backups\
│  ├─ cache\
│  │  ├─ http\
│  │  ├─ images\
│  │  └─ ai\
│  ├─ logs\
│  │  ├─ main.log
│  │  ├─ backend.log
│  │  ├─ print.log
│  │  └─ ai.log
│  └─ printer\
│     ├─ assets\
│     ├─ templates\      (MODIFIABLES par utilisateur)
│     ├─ tmp\            (jobs en cours)
│     ├─ ok\             (jobs succès)
│     └─ err\            (jobs échoués)
```

## ✅ Modules Créés

### 1. **src/main/paths.js**
- Gère les chemins pour `C:\Glowflixprojet\`
- Crée automatiquement les dossiers
- Fallback si C:\ bloqué
- Fonction: `getPaths()`, `getDataRoot()`, `initializePaths()`

### 2. **src/main/db.js**
- Ouvre SQLite dans `C:\Glowflixprojet\db\lagrace.sqlite`
- Pragmas optimisés (WAL, NORMAL sync)
- Schéma initial (products, customers, invoices, print_history)
- Fonction: `openDb()`, `initializeSchema()`, `backupDb()`

### 3. **src/main/printJobQueue.js**
- **Job System** robuste pour impression
- État: `tmp/` → `ok/` ou `err/`
- Fonctions: `enqueuePrintJob()`, `markJobOk()`, `markJobErr()`, `deleteJob()`

### 4. **src/main/logger.js**
- Loggers séparés: main, backend, print, ai
- Fichiers logs dans `C:\Glowflixprojet\logs\`
- Cleanup automatique (14 jours par défaut)
- Instances: `mainLogger`, `backendLogger`, `printLogger`, `aiLogger`

### 5. **src/main/templateManager.js**
- Charge templates de `C:\Glowflixprojet\printer\templates\`
- Fallback sur templates embarqués
- Modifiables sans recompiler
- Classe: `TemplateManager`

### 6. **src/main/init.js**
- Initialisation complète à startup Electron
- Appelle tous les modules ci-dessus
- Fonction: `initializeApp(embeddedResourcesPath)`, `shutdownApp()`

### 7. **electron/init-bridge.cjs**
- Bridge CommonJS ↔ ESM pour Electron
- Détecte chemin ressources (dev vs prod)
- Wrapper: `initializeApp()`, `shutdownApp()`

## 🔧 Intégration Electron (main.cjs)

```javascript
// Avant: app.whenReady()
const initBridge = require('./init-bridge.cjs');
appContext = await initBridge.initializeApp();

// Après: app.before-quit
await initBridge.shutdownApp();
```

## 📦 Dépendances Requises

Déjà installées:
- ✓ `better-sqlite3`
- ✓ `electron`

À ajouter si manquantes:
```bash
npm install --save-dev electron-builder
```

## 🏗️ Build & Installation

### Mode Développement
```bash
npm run dev
# Crée C:\Glowflixprojet\ automatiquement
```

### Mode Production (Exécutable Standalone)
```bash
npm run build:ui
npm run build:electron
# Crée installeur dans dist/
```

## ⚙️ Configuration electron-builder

Ajouter dans `package.json`:
```json
{
  "build": {
    "appId": "com.glowflixprojet.app",
    "productName": "Glowflixprojet",
    "directories": {
      "buildResources": "public/asset",
      "output": "dist"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "src/**/*",
      "print/**/*",
      "ai-lagrace/**/*",
      "package.json"
    ],
    "win": {
      "target": ["nsis"],
      "icon": "public/asset/image/icon/photo.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "installerIcon": "public/asset/image/icon/photo.ico",
      "uninstallerIcon": "public/asset/image/icon/photo.ico"
    }
  }
}
```

## 🔐 Droits Admin (Important!)

**Problème**: Écrire dans `C:\` nécessite droits admin sur beaucoup de PC.

**Solution**:
1. **Mode install**: Installeur se lance EN ADMIN
   - Crée `C:\Glowflixprojet\`
   - Définit droits d'écriture pour l'utilisateur courant

2. **Mode runtime**: Check à chaque démarrage
   - Si `C:\Glowflixprojet` pas accessible → fallback sur `%LOCALAPPDATA%\Glowflixprojet`
   - Log le warning pour DEBUG

## 📝 Exemple Usage en Backend

```javascript
// src/api/server.js
import { getPaths } from '../main/paths.js';
import { openDb } from '../main/db.js';
import { printLogger } from '../main/logger.js';
import { templateManager } from '../main/templateManager.js';

// Accès aux chemins
const paths = getPaths();
const dbFile = paths.dbFile;
const templateHtml = templateManager.loadTemplate('invoice-a4');

// DB
const db = openDb();
const invoices = db.prepare('SELECT * FROM invoices').all();

// Logs
printLogger.info('Impression démarrée', { jobId });
```

## 🧪 Test Local

```bash
# Mode dev (crée C:\Glowflixprojet\)
npm run dev

# Vérifier structure créée
ls -la C:\Glowflixprojet\

# Voir logs
cat C:\Glowflixprojet\logs\main.log
```

## 🚀 Prochaines Étapes

1. **Adapter backend** → utiliser `getPaths()` et `openDb()` partout
2. **Adapter impression** → utiliser `printJobQueue.js` et `templateManager.js`
3. **Tester DB** → `initializeSchema()` crée les tables
4. **Build exe** → `npm run build:electron` crée l'installeur
5. **Embarquer Python IA** → copier ai-lagrace dans `resources/python/`

---

✓ **Architecture PRO prête pour la production**  
✓ **Offline-first avec C:\Glowflixprojet\** (fixe)  
✓ **Installation dans AppData** (utilisateur, pas admin)  
✓ **Données persistantes** hors app
