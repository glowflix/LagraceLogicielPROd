# 🔧 Patches Critiques Appliqués — Serveur Backend

## Résumé des Corrections (Production-Ready)

### 1. ✅ Import Dynamique du Module Impression (CRITICAL)

**Problème:**
```javascript
// ❌ ANCIEN: Import statique qui échoue silencieusement
await import('../../print/module.js');
printerModule.start(); // crash si import failed
```

**Cause Réelle:**
- En EXE, `../../print/module.js` ne pointe pas vers `resources/print/module.js`
- L'import échoue silencieusement (pas d'erreur visible)
- Ensuite `printerModule.start()` crash avec "TypeError: printerModule is null"
- Backend meurt sans message utile → fenêtre UI vide

**Solution Appliquée (server.js):**
```javascript
import { pathToFileURL } from 'url';
import { getResourcesRoot, getPrintDir } from '../core/paths.js';

// Dans startBackend():
try {
  const resourcesRoot = getResourcesRoot();
  const printModuleFile = path.join(resourcesRoot, 'print', 'module.js');

  if (!existsSync(printModuleFile)) {
    throw new Error(`print/module.js introuvable: ${printModuleFile}`);
  }

  const mod = await import(pathToFileURL(printModuleFile).href);
  const createPrinterModule = mod.createPrinterModule;

  if (!createPrinterModule) {
    throw new Error('createPrinterModule() introuvable');
  }

  printerModule = createPrinterModule({
    io,
    logger,
    printDir,        // APPDATA (writable)
    templatesDir,    // resources/print (read-only)
    assetsDir,       // resources/print (read-only)
  });

  printerModuleReady = true;
  logger.info('✅ Printer module chargé');
} catch (error) {
  printerModuleReady = false;
  printerModule = null;
  logger.error('❌ Erreur chargement printer module:', error);
  logger.warn('⚠️  Impression indisponible (le backend continue)');
}
```

**Clés:**
- ✅ Utilise `getResourcesRoot()` pour le chemin correct en prod
- ✅ Affiche le chemin exact en cas d'erreur
- ✅ Backend continue même si printer échoue (pas de crash)
- ✅ Utilise `pathToFileURL()` pour ESM import correct

---

### 2. ✅ Protection du Démarrage du Printer Module

**Problème:**
```javascript
// ❌ ANCIEN: Assume que printerModule existe
printerModule.start(); // crash si module non chargé
```

**Solution Appliquée (server.js):**
```javascript
// ✅ Protégé avec vérification
if (printerModuleReady && printerModule?.start) {
  printerModule.start();
  logger.info('🖨️  Module d\'impression démarré');
  logger.info(`📁 Dossier impression: ${getPrintDir()}`);
} else {
  logger.warn('🖨️  Module d\'impression non démarré (module absent ou non initialisé)');
}
```

**Clés:**
- ✅ Vérifie que `printerModuleReady` est true
- ✅ Utilise optional chaining `printerModule?.start`
- ✅ Backend continue si printer non disponible

---

### 3. ✅ Script ESM Marker pour src/ ET print/

**Problème:**
- En prod (EXE), `resources/print/module.js` pouvait être vu comme CommonJS
- Résultat: "Cannot use import statement outside a module"

**Solution Appliquée (scripts/ensure-esm-marker.js):**
```bash
# Avant le build, le script vérifie:
npm run prebuild  # Exécute ensure-esm-marker.js

# Garantit que:
✅ src/package.json = { "type": "module" }
✅ print/package.json = { "type": "module" }
```

**Fichiers Créés:**
- `src/package.json` → ✅ Existe, contient `"type":"module"`
- `print/package.json` → ✅ Créé avec `"type":"module"`

**Configuration electron-builder.json:**
```json
{
  "asarUnpack": ["**/*.node", "node_modules/better-sqlite3/**", "**/*.js"]
}
```
Cela garantit que src/ et print/ sont extraits hors de app.asar en prod.

---

### 4. ✅ Diagnostics Path Logging (Temporaire)

Ajouté dans `startBackend()` après `ensureDirs()`:
```javascript
console.log('[PATHS] DATA_ROOT=', getProjectRoot());
console.log('[PATHS] RESOURCES_ROOT=', getResourcesRoot());
console.log('[PATHS] DB_PATH=', getDbPath());
console.log('[PATHS] PRINT_DIR=', getPrintDir());
```

**Utilité:**
- Si tu vois `DATA_ROOT=...Program Files.../resources` → LAGRACE_DATA_DIR non défini dans main.cjs
- Sinon tout est bon (devrait être AppData/...)

---

## Résultat Attendu (Symptômes Éliminés)

Après rebuild + test en EXE:

✅ Backend démarre sans crash  
✅ Module printer charge correctement (ou log erreur gracieuse)  
✅ UI s'affiche (pas de fenêtre vide)  
✅ Base de données se crée dans `AppData/LA GRACE POS/db/`  
✅ Logs détaillés indiquent tous les chemins  

---

## Checklist Avant Build

- [ ] `ensure-esm-marker.js` exécuté (via `npm run prebuild`)
- [ ] `src/package.json` = `{ "type": "module" }`
- [ ] `print/package.json` = `{ "type": "module" }`
- [ ] `main.cjs` définit `LAGRACE_DATA_DIR` avant `startBackend()`
- [ ] `paths.js` utilise `getDataRoot()` pour les fichiers writable
- [ ] `server.js` utilise `getResourcesRoot()` pour les ressources packagées

---

## Test Rapide (Après Build)

```bash
# Voir les logs de chemin
npm start  # ou EXE directement

# Chercher dans console:
[PATHS] DATA_ROOT= ...
[PATHS] RESOURCES_ROOT= ...
[PATHS] DB_PATH= ...

# Si DATA_ROOT ≠ resources/ → bon ✅
# Si on voit "❌ Erreur chargement printer module" → c'est gracieux, backend continue
```

---

## Références Fichiers Modifiés

1. **src/api/server.js**
   - Ajout: `import { pathToFileURL, getResourcesRoot, getPrintDir }`
   - Modifié: Bloc printer module import (try/catch robuste)
   - Modifié: Protection `printerModule.start()` (vérification)
   - Ajouté: Diagnostics path logging

2. **scripts/ensure-esm-marker.js**
   - Réécrit: Gère maintenant `src/` ET `print/`
   - Exécuté via `npm run prebuild`

3. **src/package.json**
   - Contient: `{ "type": "module" }`
   - Packagé via electron-builder `extraResources`

4. **print/package.json**
   - Créé: `{ "type": "module" }`
   - Packagé via electron-builder `asarUnpack`

---

✅ **Tous les patchs appliqués. Prêt pour build final!**
