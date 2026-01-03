# FIX: spawn('node') ENOENT en Production

## Problème
Dans la version packagée (`.exe`), l'application Electron échouait au démarrage du backend avec l'erreur:
```
Error: spawn ENOENT
```

**Cause**: Le code essayait d'exécuter `spawn('node', [serverPath])`, mais `node.exe` n'existe pas sur la machine client (seulement en dev).

## Solution Implémentée

### 1. **Utiliser `process.execPath` au lieu de `'node'`**
- `process.execPath` pointe vers l'exécutable Electron en production
- Avec `ELECTRON_RUN_AS_NODE=1`, Electron fonctionne comme Node.js

### 2. **Deux chemins de serveur (dev vs prod)**
Ajout d'une fonction `getBackendEntry()`:
```javascript
function getBackendEntry() {
  if (!app.isPackaged) {
    // DEV: serveur dans src/api/
    return path.join(__dirname, '../src/api/server.js');
  }
  // PROD: serveur copié dans resources/backend/
  return path.join(process.resourcesPath, 'backend', 'server.js');
}
```

### 3. **Copier le backend dans les ressources**
Dans `package.json` build config:
```json
"extraResources": [
  {
    "from": "src/api/server.js",
    "to": "backend/server.js"
  },
  ...
]
```

### 4. **Variables d'environnement essentielles**
```javascript
env: {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',      // ✅ Clé
  NODE_ENV: 'production',
  PORT: '3030',
  HOST: '127.0.0.1',              // Recommandé pour app locale
  APP_ROOT: process.resourcesPath, // Pour tes paths backend
  AI_LAGRACE_AUTOSTART: 'false',   // Electron gère l'IA
}
```

## Fichiers Modifiés

### [electron/main.cjs](electron/main.cjs)
- ✅ Ajout de `getBackendEntry()` pour déterminer le chemin du serveur
- ✅ Remplacement de `spawn('node', ...)` par `spawn(process.execPath, ...)`
- ✅ Ajout de `ELECTRON_RUN_AS_NODE: '1'` en env
- ✅ Ajout de `APP_ROOT` pointant vers `process.resourcesPath` en production

### [package.json](package.json)
- ✅ Ajout de `extraResources` pour copier `src/api/server.js` → `backend/server.js`

## Résultat

✅ **En développement**: Fonctionne comme avant (serveur lancé normalement)
✅ **En production**: Serveur démarré via Electron, sans dépendre de `node.exe`
✅ **Plus de ENOENT**: Le serveur est trouvable même sur machines sans Node.js

## Tests à Faire

1. Build la version Windows:
   ```powershell
   npm run build
   ```

2. Lancer l'app depuis `dist/release/LA GRACE POS Setup 1.0.0.exe`

3. Vérifier que le serveur démarre (logs dans console Electron)

4. Vérifier que l'app peut créer/modifier des données

## Notes

- `APP_ROOT` est maintenant disponible en tant que variable d'environnement pour que ton backend sache où trouver les fichiers
- Le timeout de 8s est un fallback au cas où le serveur ne log pas correctement
- Le host `127.0.0.1` isole l'app à la machine locale (sécurité)
