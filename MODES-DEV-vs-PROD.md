# 🎯 MODES DEV vs PROD - DOCUMENTATION COMPLÈTE

## 📊 Comparaison Rapide

| Aspect | DEV | PROD |
|--------|-----|------|
| **Commande** | `npm run dev` | `LA GRACE POS.exe` |
| **Code** | Source JS (non compilé) | Compilé + compressé (ASAR) |
| **BD SQLite** | `C:\Glowflixprojet\db\` | `%APPDATA%\Glowflixprojet\db\` |
| **Backend** | Node.js `node server.js` | Electron in-process |
| **Frontend** | Vite `http://localhost:5173` | Compilée `http://localhost:3030` |
| **AI** | Python venv `python main.py` | Exe embarquée `ai-lagrace.exe` |
| **Fichiers sourcés** | 0 (Dev mode seulement) | Code compilé uniquement |
| **npm en exécution** | ✅ npm run | ❌ Zéro npm |
| **Vitesse démarrage** | Lent (~10s) | Rapide (~2s) |
| **Logs détaillés** | Oui (console) | Fichiers logs seulement |
| **Hot reload** | ✅ Oui (Vite) | ❌ Non |

---

## 🔧 MODE DÉVELOPPEMENT (DEV)

### Commande
```powershell
npm run dev
```

### Démarrage
```
1. npm run dev:backend     ← Lance: node src/api/server.js
2. npm run dev:ui          ← Lance: vite (localhost:5173)
3. wait-and-launch-electron ← Lance: electron .
                             Charge: http://localhost:3030
```

### Architecture Dev
```
Node.js (Backend)
  └── node src/api/server.js
      ├── Écoute: 0.0.0.0:3030
      ├── BD: C:\Glowflixprojet\db\ (DEV)
      └── Initialise via startBackend()

Vite (Frontend)
  └── http://localhost:5173
      ├── Hot reload ✅
      ├── Source maps ✅
      └── Code non-minifié ✅

Electron (Window)
  └── electron .
      ├── Charge: http://localhost:3030 (Express)
      ├── WebPreferences: preload.cjs
      └── Fenêtre: 1400x900

Python IA (Optionnel)
  └── python ai-lagrace/main.py
      └── Écoute Socket.IO
```

### Chemins BD en Dev
```
Dev source code:        D:\logiciel\La Grace pro\v1\
Dev database:           C:\Glowflixprojet\db\glowflixprojet.db
Dev logs:               C:\Glowflixprojet\logs\
Dev data:               C:\Glowflixprojet\data\
```

### Avantages Dev
- ✅ Hot reload (F5 recharge l'UI)
- ✅ Source maps pour debugging
- ✅ Logs en console en temps réel
- ✅ Facile à modifier et tester
- ✅ Python AI en venv (flexible)

### Désavantages Dev
- ❌ Démarrage lent (~10 secondes)
- ❌ npm utilisé (dépendances chargées)
- ❌ Consommation mémoire élevée
- ❌ Fenêtres multiples (Electron + Vite)

---

## 🚀 MODE PRODUCTION (PROD)

### Commande
```powershell
LA GRACE POS Setup 1.0.0.exe
→ LA GRACE POS.exe
```

### Démarrage
```
1. LA GRACE POS.exe
   ├── electron/main.cjs
   │   ├── requestSingleInstanceLock() → Ensure single instance
   │   ├── setDataDir() → %APPDATA%\Glowflixprojet
   │   ├── startBackendInProcess() → import server.js
   │   └── createWindow() → Load http://localhost:3030
   │
   ├── src/api/server.js (imported, NOT called)
   │   └── export async startBackend()
   │
   └── Electron initialization
       ├── Écoute: 0.0.0.0:3030 (in-process)
       ├── BD: %APPDATA%\Glowflixprojet\db\
       └── UI: dist/ui/ (compilée)
```

### Architecture Prod
```
Electron Main (tout-en-un)
  ├── main.cjs (in-process Express)
  │   └── startBackendInProcess()
  │       ├── Import: src/api/server.js
  │       └── Call: startBackend()
  │
  ├── Express Backend (in-process)
  │   ├── Écoute: 0.0.0.0:3030
  │   ├── BD: %APPDATA%\Glowflixprojet\db\
  │   └── UI static: dist/ui/
  │
  ├── React UI (compilée)
  │   ├── Bundle: 0.7 MB
  │   ├── Assets: compressés
  │   └── No hot reload
  │
  └── IA (subprocess)
      └── Spawn ai-lagrace.exe (standalone)
          └── Socket.IO communicate
```

### Chemins BD en Prod
```
Installation:           C:\Program Files\LA GRACE POS\
Production database:    C:\Users\<USER>\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
Production logs:        C:\Users\<USER>\AppData\Roaming\Glowflixprojet\logs\
Production data:        C:\Users\<USER>\AppData\Roaming\Glowflixprojet\data\
```

### Avantages Prod
- ✅ Démarrage rapide (~2 secondes)
- ✅ Zéro npm en exécution
- ✅ Empreinte mémoire faible (~100MB)
- ✅ Une fenêtre unique
- ✅ IA autonome (exe standalone)
- ✅ Offline-first mode
- ✅ LAN-accessible (0.0.0.0:3030)

### Désavantages Prod
- ❌ Pas de hot reload
- ❌ Compilation nécessaire pour modifications
- ❌ Logs dans fichiers seulement
- ❌ Plus difficile à déboguer

---

## 🔄 FLUX COMPLET

### Dev Mode
```powershell
PS> npm run dev

1. npm run dev:backend
   └─> node src/api/server.js
       └─> await startBackend()
           ├─ ensureDirs()
           ├─ initSchema()
           └─ httpServer.listen(3030, '0.0.0.0')
           └─> ✅ "Express prêt"

2. npm run dev:ui
   └─> vite
       └─> ✅ "Local: http://localhost:5173"

3. wait-and-launch-electron
   └─> electron .
       └─> electron/main.cjs
           ├─ Définit GLOWFLIX_ROOT_DIR = C:\Glowflixprojet
           ├─ appWindow.loadURL("http://localhost:3030")
           └─> ✅ Window opens

4. App loads
   ├─ React connects to Express on 3030
   ├─ Socket.IO connection established
   └─> ✅ App Ready
```

### Prod Mode
```
User clicks: LA GRACE POS.exe

1. Electron main process
   ├─> requestSingleInstanceLock() → Ensure single instance
   ├─> setDataDir() → %APPDATA%\Glowflixprojet
   │
   ├─> startBackendInProcess()
   │   ├─ import('./src/api/server.js')
   │   └─ await mod.startBackend({...})
   │       ├─ getDb() → Open %APPDATA%\...\db\
   │       ├─ initSchema()
   │       └─ httpServer.listen(3030, '0.0.0.0')
   │       └─> ✅ Backend ready
   │
   ├─> createWindow()
   │   └─ mainWindow.loadURL("http://localhost:3030")
   │       ├─ Loads dist/ui/index.html (compiled)
   │       ├─ React loads from same origin
   │       └─ Socket.IO connects (same port)
   │       └─> ✅ Window ready
   │
   └─> startAI()
       └─ spawn ai-lagrace.exe
           └─> ✅ AI running
```

---

## 🔍 DIFFÉRENCES CLÉS

### 1. Backend
```javascript
// DEV
npm run dev:backend
└─> node src/api/server.js
    ├─ Exécute le code directement
    └─ await startBackend() appelé à la fin

// PROD
electron/main.cjs
└─> import('./src/api/server.js')
    ├─ Dynamic import du module compilé
    └─ await mod.startBackend() appelé explicitement
```

### 2. Base de Données
```
// DEV
GLOWFLIX_ROOT_DIR = C:\Glowflixprojet
bd path: C:\Glowflixprojet\db\glowflixprojet.db

// PROD
GLOWFLIX_ROOT_DIR = %APPDATA%\Glowflixprojet
bd path: C:\Users\<USER>\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
```

### 3. Frontend
```
// DEV
Vite dev server: http://localhost:5173
├─ Hot reload ✅
├─ Source maps ✅
└─ Code non-minifié

// PROD
Compiled & served by Express: http://localhost:3030
├─ dist/ui/index.html (minified)
├─ dist/ui/assets/ (chunked)
└─ No hot reload
```

### 4. IA/Subprocess
```
// DEV
Python venv: .venv/Scripts/python.exe
└─ spawn python main.py

// PROD
Standalone exe: dist/ai/ai-lagrace.exe (11.8 MB)
└─ spawn ai-lagrace.exe
```

### 5. npm Usage
```
// DEV
npm run dev
├─ npm processes running ✅
├─ node_modules loaded
└─ Hot reload active

// PROD
LA GRACE POS.exe
├─ npm NOT involved ❌
├─ Everything compiled
└─ Direct execution
```

---

## 🧪 VÉRIFICATION QUE PROD FONCTIONNE

### Test 1: Après Build
```powershell
# Exécuter le script de vérification
.\VERIFY-DATABASE-PRODUCTION-CLEAN.ps1

# Doit afficher:
[OK] Setup trouve: LA GRACE POS Setup 1.0.0.exe
[OK] node_modules: PAS inclus
[OK] ai-lagrace.exe: 11.8 MB
[OK] React UI: 0.7 MB
```

### Test 2: Après Installation
```powershell
# Exécuter le setup
.\dist\release\LA GRACE POS Setup 1.0.0.exe

# Accepter conditions
# Choisir dossier
# Installer

# Vérifier
Test-Path "C:\Program Files\LA GRACE POS"  # ✅ Doit être true
Test-Path "$env:APPDATA\Glowflixprojet"    # ✅ Doit être false (créé au 1er démarrage)
```

### Test 3: Premier Démarrage
```powershell
# Lancer l'app
& "C:\Program Files\LA GRACE POS\LA GRACE POS.exe"

# Attendre 5 secondes
# Vérifier
Test-Path "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db"  # ✅ Doit être true
```

### Test 4: Vérifier l'Interface
```
1. Window doit s'ouvrir (~2 sec)
2. UI doit charger
3. Tester /api/health
4. Socket.IO doit se connecter
5. No console errors
```

---

## ⚡ RÉSOLUTION DES PROBLÈMES

### Problem: Backend se ferme en dev
```
Before:
  dev:backend: "cross-env ELECTRON_RUN_AS_NODE=1 electron ./src/api/server.js"
  → electron quitte après initialisation

After:
  dev:backend: "node src/api/server.js"
  → node continue à tourner
```

### Problem: Port 3030 conflictuel
```powershell
# Trouver le processus
Get-NetTCPConnection -LocalPort 3030

# Tuer si nécessaire
Stop-Process -Id <PID> -Force
```

### Problem: BD ne se crée pas en prod
```
1. Vérifier permissions AppData
2. Vérifier que process.resourcesPath existe
3. Vérifier logs: %APPDATA%\Glowflixprojet\logs\
```

---

## 📋 MODES SUPPLÉMENTAIRES

### dev:backend:electron (sans UI)
```powershell
npm run dev:backend:electron

# Lance uniquement le backend Electron (sans Vite)
# Utile pour tester Electron seul
```

### start
```powershell
npm start

# Lance: node src/api/server.js
# CLI mode - utile pour démarrer serveur standalone
```

### electron
```powershell
npm run electron

# Lance Electron en standalone
# Charge: http://localhost:3030
# Assume que le backend tourne déjà
```

---

## 🎯 QUAND UTILISER QUOI

### Utilisez DEV si:
- ✅ Vous développez activement
- ✅ Vous avez besoin du hot reload
- ✅ Vous debuggez (console logs)
- ✅ Vous testez des changements rapides

### Utilisez PROD si:
- ✅ Vous testez la version finale
- ✅ Vous validez l'installer
- ✅ Vous mesurez la performance
- ✅ Vous simulez une vraie installation
- ✅ Vous testez l'accès LAN

---

## ✅ CHECKLIST

- [x] npm run dev: works ✅
- [x] npm run build: works ✅
- [x] setup.exe: created ✅
- [x] setup.exe: installs correctly ✅
- [x] LA GRACE POS.exe: launches ✅
- [x] Database created in AppData ✅
- [x] Interface loads correctly ✅
- [x] No npm calls in prod ✅
- [x] 0 MB of npm dependencies ✅
- [x] Offline mode works ✅

---

**Status:** ✅ BOTH DEV & PROD WORKING
