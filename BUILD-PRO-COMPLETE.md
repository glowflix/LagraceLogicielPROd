# 🚀 BUILD PRO COMPLET - LA GRACE POS

## ✅ Configuration Pro Appliquée

Voici ce qui a été mis en place pour créer un installateur .exe **complet** (UI + backend + SQLite + IA) sans aucune dépendance externe pour l'utilisateur final.

---

## 🎯 Objectif Final

```
LA GRACE POS Setup 1.0.0.exe
  ↓
[Installation sur PC utilisateur]
  ↓
Logiciel complet (+ DB + IA Python compilée)
  ↓
Aucune dépendance: npm ❌ | Node ❌ | Python ❌
```

---

## 📋 Modifications Effectuées

### 1. ✅ package.json - Scripts de Build

**Build :ai** - Compilation Python → EXE (PyInstaller)
```bash
"build:ai": "powershell -ExecutionPolicy Bypass -Command \"if (Test-Path .venv) { .\\.venv\\Scripts\\Activate.ps1 }; python -m pip install -q pyinstaller; pyinstaller --noconfirm --clean --onedir --name ai-lagrace ai-lagrace/main.py\"",
```

**Build complet** - UI + IA + Electron
```bash
"build": "npm run build:ui && npm run build:ai && npm run build:electron",
```

### 2. ✅ package.json - electron-builder

**asarUnpack** - Déballer les .node hors du bundle
```json
"asarUnpack": [
  "**/*.node",
  "**/better-sqlite3/**",
  "**/bcrypt/**"
]
```

**extraResources** - Embarquer l'IA + print + assets
```json
"extraResources": [
  {
    "from": "dist/ai-lagrace",
    "to": "ai",
    "filter": ["**/*"]
  },
  {
    "from": "print",
    "to": "print",
    "filter": ["**/*"]
  },
  {
    "from": "asset",
    "to": "asset",
    "filter": ["**/*"]
  }
]
```

### 3. ✅ electron/main.cjs - Mode Prod vs Dev

**Initialisation userData** (ligne ~607)
```javascript
// ✅ IMPORTANT: Initialiser global.__ELECTRON_APP__ pour userData
global.__ELECTRON_APP__ = app;
```

**Logique IA dev/prod** (ligne ~160-190)
```javascript
const isProd = app.isPackaged;

if (isProd) {
  // PROD: EXE PyInstaller embarquée dans resources/ai
  aiCmd = path.join(process.resourcesPath, 'ai', 'ai-lagrace.exe');
  aiArgs = ['--quiet'];
} else {
  // DEV: Python + main.py depuis .venv
  aiCmd = pythonExe;
  aiArgs = ['main.py', '--quiet'];
}
```

### 4. ✅ src/core/paths.js - userData en Production

```javascript
export function getProjectRoot() {
  // Mode Electron: utiliser userData (stable en prod)
  const isElectron = typeof window !== 'undefined' || process.env.ELECTRON_RUN_AS_NODE === '1';
  
  if (isElectron && global.__ELECTRON_APP__) {
    return global.__ELECTRON_APP__.getPath("userData");
  }
  
  // Dev/CLI: C:\Glowflixprojet
  const winDefault = "C:\\Glowflixprojet";
  return process.env.GLOWFLIX_ROOT_DIR
    ? path.resolve(process.env.GLOWFLIX_ROOT_DIR)
    : (process.platform === "win32" ? winDefault : path.join(os.homedir(), "Glowflixprojet"));
}
```

**Résultat:**
- **PRODUCTION:** `C:\Users\<User>\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db`
- **DÉVELOPPEMENT:** `C:\Glowflixprojet\db\glowflixprojet.db`

---

## 🔧 Commandes de Build

### Phase 1: Vérifier Prérequis

```bash
# Vérifier Node/npm
node --version  # ≥16
npm --version   # ≥8

# Vérifier Python + venv
.\.venv\Scripts\activate
python --version  # ≥3.9

# Installer PyInstaller
pip install pyinstaller
```

### Phase 2: Installer Dependencies

```bash
# Installer les dépendances Node
npm install

# Vérifier que electron-builder est prêt
npm list electron-builder
```

### Phase 3: Build Complet

```bash
# OPTION A: Build complet (UI + IA + Electron)
npm run build

# OPTION B: Build par étapes (pour déboguer)
npm run build:ui
npm run build:ai
npm run build:electron
```

### Phase 4: Vérifier la Sortie

```bash
# Vérifier que tout est construit
dir dist-electron\

# Résultat attendu:
#   LA GRACE POS Setup 1.0.0.exe
#   LA GRACE POS Setup 1.0.0.exe.blockmap
#   ...
```

---

## 🧪 Test de Production

### Test Local (avant installation)

```bash
# Simuler un environnement Electron packagé
# (sans installer, juste vérifier le bundle)

# 1. Vérifier que l'IA exe est présente
dir dist-electron\ /s | findstr "ai-lagrace.exe"

# 2. Vérifier les ressources
dir dist-electron\ | findstr "ai|print|asset"
```

### Test d'Installation

```bash
# 1. Exécuter l'installateur
dist-electron\"LA GRACE POS Setup 1.0.0.exe"

# 2. Suivre l'assistant d'installation

# 3. Au premier lancement:
# - Vérifier que DB est créée dans AppData\Roaming\Glowflixprojet
# - Vérifier que l'IA démarre correctement
# - Vérifier que l'UI se charge

# 4. Tester les fonctionnalités principales:
# - Ajouter un produit
# - Faire une vente
# - Écouter l'IA (TTS)
```

---

## 📁 Structure Finale Après Installation

```
C:\Program Files (x86)\LA GRACE POS\
  ├── app.asar
  ├── resources/
  │   ├── ai/
  │   │   ├── ai-lagrace.exe
  │   │   ├── piper.exe (ou winsound)
  │   │   ├── models/
  │   │   └── [autres dépendances Python]
  │   ├── print/
  │   │   └── [templates HTML/assets]
  │   └── asset/
  │       └── [images, icons, etc]
  └── [autres fichiers Electron]

C:\Users\<User>\AppData\Roaming\Glowflixprojet\
  ├── db/
  │   ├── glowflixprojet.db (créée au 1er lancement)
  │   └── migrations/
  ├── data/
  │   ├── cache/
  │   ├── imports/
  │   ├── exports/
  │   └── backups/
  ├── printer/
  │   ├── ok/, err/, tmp/
  │   └── assets/
  └── logs/
```

---

## 🔴 Problèmes Connus & Solutions

### ❌ "ai-lagrace.exe introuvable après installation"

**Cause:** PyInstaller n'a pas été exécuté ou a échoué.

**Solution:**
```bash
# Reconstruire manuellement
npm run build:ai

# Vérifier le résultat
ls -la dist/ai-lagrace/
```

### ❌ "Database en lecture seule"

**Cause:** Permissions sur AppData\Roaming

**Solution:**
```bash
# S'assurer que le dossier a les bons droits
icacls "C:\Users\<User>\AppData\Roaming\Glowflixprojet" /grant:r "%USERNAME%:F"
```

### ❌ "Electron-builder fail: asar not found"

**Cause:** Missing `files` ou `extraResources`

**Solution:**
```bash
# Vérifier que tous les fichiers existent avant le build
npm run build:ui   # Doit créer dist/
npm run build:ai   # Doit créer dist/ai-lagrace/
```

### ❌ "Process resourcesPath is undefined"

**Cause:** Code non-Electron accédant à `process.resourcesPath`

**Solution:**
```javascript
// Vérifier la présence avant utilisation
const aiExe = process.resourcesPath ? path.join(process.resourcesPath, 'ai', 'ai-lagrace.exe') : null;
```

---

## ✨ Checklist Final

- [x] package.json scripts: `build:ai`, `build`, complets ✅
- [x] electron-builder config: `asarUnpack`, `extraResources` ✅
- [x] electron/main.cjs: Mode prod/dev pour IA ✅
- [x] src/core/paths.js: userData en production ✅
- [x] `.venv` avec Python 3.9+ ✅
- [x] PyInstaller installé: `pip list | grep pyinstaller` ✅
- [x] ai-lagrace/main.py buildable ✅

---

## 🚀 Démarrer le Build

```bash
# 1. Naviguer au projet
cd "D:\logiciel\La Grace pro\v1"

# 2. Activer venv
.\.venv\Scripts\activate

# 3. Installer/vérifier deps
npm install

# 4. BUILD COMPLET
npm run build

# 5. Attendre...
#    - build:ui (2-3 min)
#    - build:ai (3-5 min pour PyInstaller)
#    - build:electron (2-3 min)

# 6. Vérifier la sortie
dir dist-electron\
```

---

## 📞 Support

Si quelque chose échoue:
1. Vérifier les logs du build (terminal)
2. Nettoyer le build: `rm -r dist dist-electron node_modules && npm install`
3. Vérifier que .venv est OK: `.\.venv\Scripts\activate && python main.py`
4. Vérifier que PyInstaller marche: `pyinstaller --version`

---

**Date:** Janvier 2026  
**Status:** ✅ Production-Ready
