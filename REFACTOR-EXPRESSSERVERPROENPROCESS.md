# ✅ REFACTORISATION PRO - RÉSUMÉ DES CHANGEMENTS

## 🎯 Architecture Nouvelle (Express in-process + LAN)

### 1. **Vite** → dist/ui/
```javascript
// vite.config.js
build: {
  outDir: 'dist/ui',    // ✅ UI compilée ici
  emptyOutDir: true,
}
```

### 2. **PyInstaller** → dist/ai/
```bash
# package.json
"build:ai": "... --distpath dist/ai ..."
```

### 3. **Electron-builder** → dist/electron/
```json
{
  "directories": { "output": "dist/electron" },
  "files": ["dist/ui/**/*"],
  "extraResources": [{ "from": "dist/ai/ai-lagrace", "to": "ai" }]
}
```

### 4. **Structure Finale**
```
dist/
├── ui/              (Vite build)
├── ai/ai-lagrace/   (PyInstaller)
└── electron/        (NSIS installer)
    ├── LA GRACE POS Setup.exe
    └── win-unpacked/
```

---

## 🚀 Serveur Express

### ✅ CHANGEMENT: startBackend() exportable

Avant:
```javascript
// src/api/server.js
httpServer.listen(3030, () => { ... });
```

Après:
```javascript
// src/api/server.js
export async function startBackend({
  port = 3030,
  host = '0.0.0.0',      // ✅ LAN
  staticDir = null,      // ✅ dist/ui
  isElectron = false,    // ✅ Coupe IA côté serveur
} = {}) {
  // Serve staticDir
  app.use(express.static(staticDir));
  
  // Listen
  return new Promise((resolve) => {
    httpServer.listen(port, host, resolve);
  });
}
```

**Bénéfices:**
- ✅ Pas de spawn en production
- ✅ Même process = partage de ressources
- ✅ Socket.IO stable (same origin)
- ✅ LAN accessible (0.0.0.0:3030)

---

## ⚛️ Electron (main.cjs)

### ✅ CHANGEMENT: Import dynamique + startBackendInProcess()

Avant:
```javascript
// Spawn process.execPath avec server-entry.cjs
serverProcess = spawn(process.execPath, [serverPath], { ... });
```

Après:
```javascript
// electron/main.cjs
async function startBackendInProcess() {
  const serverJs = path.join(app.getAppPath(), 'src', 'api', 'server.js');
  const staticDir = path.join(app.getAppPath(), 'dist', 'ui');

  const mod = await import(pathToFileURL(serverJs).href);
  
  backendHandle = await mod.startBackend({
    port: 3030,
    host: '0.0.0.0',
    staticDir,
    isElectron: true,
  });
}

app.whenReady().then(async () => {
  await startBackendInProcess();
  createWindow();
});
```

**Bénéfices:**
- ✅ Pas de spawn = pas d'ENOENT
- ✅ ESM importé directement (plus de server-entry.cjs)
- ✅ Gestion d'erreur simplifiée
- ✅ Code 100 lignes au lieu de 800

---

## 🌐 Frontend (React)

### ✅ CHANGEMENT: Same-origin API + Socket.IO

Avant:
```javascript
const API_URL = "http://localhost:3030";
axios.get(API_URL + "/api/health");
io("http://localhost:3030");
```

Après:
```javascript
// ✅ Same origin (LAN compatible)
axios.get("/api/health");
io(); // Pas d'URL = même origin
```

**Avantage:**
- ✅ Compatible LAN (http://IP:3030)
- ✅ Pas de CORS issues
- ✅ Socket.IO stable

---

## 📦 Build Scripts

```json
{
  "scripts": {
    "clean": "rimraf dist",
    "build:ui": "vite build",
    "build:ai": "... --distpath dist/ai ...",
    "build:electron": "electron-builder",
    "build": "npm run clean && npm run build:ui && npm run build:ai && npm run build:electron"
  }
}
```

---

## 🔐 Accès LAN

### Utilisateur Final:

1. **Installer** sur PC serveur:
   ```
   dist/electron/LA GRACE POS Setup.exe
   ```

2. **Trouver l'IP du serveur:**
   ```powershell
   ipconfig
   ```
   Ex: 192.168.1.100

3. **Sur d'autres PC, ouvrir:**
   ```
   http://192.168.1.100:3030
   ```

4. **Temps réel via Socket.IO** ✅ (même origin)

### Important: Windows Firewall
- Autoriser port 3030 (TCP entrée)
- Ou: Autoriser LA GRACE POS.exe dans pare-feu

---

## ✨ Résumé des Changements

| Aspect | Avant | Après | Raison |
|--------|-------|-------|--------|
| **Backend** | Spawn process | Import ESM direct | Pas d'ENOENT, meilleure intégration |
| **Static files** | app.use(express.static('dist')) | app.use(express.static(staticDir)) | Chemins dynamiques en prod |
| **API calls** | Hardcoded localhost:3030 | Relative paths /api | LAN compatible |
| **Structure dist** | dist/ + dist-electron/ | dist/ui/ + dist/ai/ + dist/electron/ | Organisation propre |
| **Serveur entry** | server-entry.cjs | Pas besoin | ESM direct en process |

---

## 🎯 Statut Final

✅ **Express in-process** (pas de spawn)
✅ **LAN accessible** (0.0.0.0:3030)
✅ **Socket.IO stable** (same origin)
✅ **Structure dist propre** (ui/ai/electron)
✅ **Zéro dépendances externes** (Electron embarque Node)

**Build:** `npm run build`
**Distribution:** `dist/electron/LA GRACE POS Setup.exe`
