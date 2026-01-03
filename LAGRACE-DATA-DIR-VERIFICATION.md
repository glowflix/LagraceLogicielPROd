# 🔐 Vérifications Critiques — LAGRACE_DATA_DIR

## Point 1: LAGRACE_DATA_DIR défini AVANT startBackendInProcess()

**Localisation: electron/main.cjs, dans app.whenReady()**

✅ **VÉRIFIÉ - Ligne 765:**
```javascript
process.env.LAGRACE_DATA_DIR = app.getPath('userData');
```

Cette ligne est exécutée **AVANT** les appels à:
- `startBackendInProcess()` (ligne 827)
- `startServer()` (ligne 833)

**Ordre d'exécution en production:**

```
1. app.whenReady() → ligne 750 commence
2. LAGRACE_DATA_DIR défini → ligne 765 ✅
3. startBackendInProcess() appelé → ligne 827
4. server.js importé et startBackend() exécuté
5. paths.js utilise process.env.LAGRACE_DATA_DIR ✅
6. ensureDirs() crée dans le bon dossier (APPDATA)
```

**Impact:**
- ✅ getDataRoot() dans paths.js retourne `process.env.LAGRACE_DATA_DIR`
- ✅ Database créée dans AppData, pas en C:\Glowflixprojet
- ✅ Aucun problème de permission Windows

---

## Point 2: LAGRACE_DATA_DIR passé dans env du spawn

**Localisation: electron/main.cjs, fonction startServer()**

✅ **CORRECTION APPLIQUÉE - Ligne ~451:**
```javascript
spawn(process.execPath, [serverPath], {
  cwd,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: app.isPackaged ? 'production' : 'development',
    PORT: PORT.toString(),
    HOST: '127.0.0.1',
    APP_ROOT: resolveAppRoot(),
    RESOURCES_ROOT: resolveResourcesRoot(),
    LAGRACE_DATA_DIR: app.getPath('userData'),  // ✅ AJOUTÉ
    AI_LAGRACE_AUTOSTART: 'false',
  },
});
```

**Impact (fallback spawn):**
- ✅ Même si startBackendInProcess() échoue, le fallback spawn aura LAGRACE_DATA_DIR
- ✅ Pas de retombée sur C:\Glowflixprojet 
- ✅ Database/printer/logs créés dans APPDATA

---

## Flux Complet (Production EXE)

### Scénario 1: startBackendInProcess() réussit ✅

```
main.cjs:750  app.whenReady()
     ↓
main.cjs:765  LAGRACE_DATA_DIR = app.getPath('userData')
     ↓ (défini)
main.cjs:827  startBackendInProcess()
     ↓
server.js    import() → startBackend({ isElectron: true })
     ↓
server.js    startBackend() lit process.env.LAGRACE_DATA_DIR ✅
     ↓
paths.js     getDataRoot() → process.env.LAGRACE_DATA_DIR ✅
     ↓
     ensureDirs() → AppData\LA GRACE POS\db ✅
```

### Scénario 2: startBackendInProcess() échoue → fallback spawn ✅

```
main.cjs:827  startBackendInProcess() fails
     ↓
main.cjs:833  startServer() (spawn)
     ↓
spawn env    LAGRACE_DATA_DIR: app.getPath('userData') ✅
     ↓
server.js    import() → startBackend()
     ↓
paths.js     getDataRoot() → process.env.LAGRACE_DATA_DIR ✅
     ↓
     ensureDirs() → AppData\LA GRACE POS\db ✅
```

**Dans les DEUX cas**: Database et runtime files vont en AppData ✅

---

## Checklist Finale (Avant Build)

- [x] main.cjs ligne 765: `process.env.LAGRACE_DATA_DIR = app.getPath('userData')`
- [x] main.cjs startServer() env: `LAGRACE_DATA_DIR: app.getPath('userData')`
- [x] server.js: Ne pas écraser si déjà défini (protection ligne 531)
- [x] paths.js: Utilise process.env.LAGRACE_DATA_DIR en priorité
- [x] electron-builder.json: Extrait src/ et print/ (asarUnpack, extraResources)

✅ **TOUS LES POINTS VÉRIFIÉS ET CORRIGÉS**

---

## Test Diagnostic (Log dans EXE)

Après rebuild et lancement EXE:

```
[PATHS] DATA_ROOT=C:\Users\<user>\AppData\Local\LA GRACE POS
[PATHS] RESOURCES_ROOT=C:\Program Files\LA GRACE POS\resources
[PATHS] DB_PATH=C:\Users\<user>\AppData\Local\LA GRACE POS\db\glowflixprojet.db
[PATHS] PRINT_DIR=C:\Users\<user>\AppData\Local\LA GRACE POS\printer
```

✅ **Si tu vois ça**: tout est correct  
❌ **Si DATA_ROOT = resources/**: LAGRACE_DATA_DIR non défini (bug)

---

## Documentation Complète

Voir: [PATCH-CRITICAL-FIXES.md](PATCH-CRITICAL-FIXES.md) pour détails complets
