# ✅ VALIDATION CHECKLIST - Architecture PRO

## Phase 1: Vérification des Fichiers

- [ ] `src/main/paths.js` existe et exporte `getPaths()`, `getDataRoot()`, `initializePaths()`
- [ ] `src/main/db.js` existe et exporte `openDb()`, `closeDb()`, `initializeSchema()`
- [ ] `src/main/printJobQueue.js` existe et exporte job functions
- [ ] `src/main/logger.js` existe et exporte `mainLogger`, `backendLogger`, etc.
- [ ] `src/main/templateManager.js` existe et exporte `TemplateManager`
- [ ] `src/main/init.js` existe et exporte `initializeApp()`
- [ ] `electron/init-bridge.cjs` existe et exporte async wrappers
- [ ] `electron/ipc-handlers.cjs` existe et exporte `initializeIpcHandlers()`
- [ ] `electron/preload.cjs` amélioré avec toutes les APIs

```bash
# Vérifier
node scripts/test-architecture.js
```

## Phase 2: Vérification du Code

- [ ] `electron/main.cjs` appelle `initializeApp()` au startup
- [ ] `electron/main.cjs` appelle `initializeIpcHandlers(appContext)`
- [ ] `package.json` a `"type": "module"`
- [ ] `package.json` a `better-sqlite3` dans dependencies
- [ ] `package.json` a `electron` dans devDependencies

```bash
grep -n "initializeApp\|initializeIpcHandlers" electron/main.cjs
```

## Phase 3: Test en Mode Dev

### 3.1 Démarrer l'app
```bash
npm run dev
```

### 3.2 Vérifier la création de C:\Glowflixprojet\
```powershell
# PowerShell
dir C:\Glowflixprojet\

# Devrait afficher:
# Mode                 LastWriteTime         Length Name
# ----                 --------            ------  ----
# d-----          [date]                       cache
# d-----          [date]                       db
# d-----          [date]                       logs
# d-----          [date]                       printer
```

- [ ] `C:\Glowflixprojet\` créé
- [ ] `C:\Glowflixprojet\db\` créé
- [ ] `C:\Glowflixprojet\db\migrations\` créé
- [ ] `C:\Glowflixprojet\db\backups\` créé
- [ ] `C:\Glowflixprojet\cache\` créé
- [ ] `C:\Glowflixprojet\cache\http\` créé
- [ ] `C:\Glowflixprojet\cache\images\` créé
- [ ] `C:\Glowflixprojet\cache\ai\` créé
- [ ] `C:\Glowflixprojet\logs\` créé
- [ ] `C:\Glowflixprojet\printer\` créé
- [ ] `C:\Glowflixprojet\printer\assets\` créé
- [ ] `C:\Glowflixprojet\printer\templates\` créé
- [ ] `C:\Glowflixprojet\printer\tmp\` créé
- [ ] `C:\Glowflixprojet\printer\ok\` créé
- [ ] `C:\Glowflixprojet\printer\err\` créé

### 3.3 Vérifier la BD SQLite
```powershell
# Vérifier le fichier existe
Test-Path C:\Glowflixprojet\db\lagrace.sqlite
# Devrait afficher: True

# Voir la taille (ne doit pas être vide)
(Get-Item C:\Glowflixprojet\db\lagrace.sqlite).Length
```

- [ ] `C:\Glowflixprojet\db\lagrace.sqlite` créé
- [ ] Fichier > 0 bytes
- [ ] Fichier WAL créé aussi (`.sqlite-wal`)

### 3.4 Vérifier les logs
```powershell
# Afficher les logs
Get-Content C:\Glowflixprojet\logs\main.log | Select-Object -Last 20

# Chercher les points clés
# "✓ Répertoire données: C:\Glowflixprojet"
# "✓ SQLite: C:\Glowflixprojet\db\lagrace.sqlite"
# "✓ Schéma BD initialisé"
# "✓ Template manager initialisé"
```

- [ ] `C:\Glowflixprojet\logs\main.log` créé et contient les logs Electron
- [ ] `C:\Glowflixprojet\logs\backend.log` créé et contient les logs Node
- [ ] Pas d'erreurs critiques dans les logs
- [ ] Message "Répertoire données:" visible

## Phase 4: Test des APIs

### 4.1 Tester window.electronAPI depuis le Console DevTools

```javascript
// Dans la console navigateur (DevTools)

// Test 1: getPaths()
window.electronAPI.getPaths().then(p => console.log(p));
// Devrait afficher l'objet paths avec tous les chemins

// Test 2: getAppInfo()
window.electronAPI.getAppInfo().then(info => console.log(info));
// Devrait afficher info de l'app

// Test 3: getPaths printer
window.electronAPI.getPaths().then(p => console.log(p.printerDir));
// Devrait afficher: C:\Glowflixprojet\printer

// Test 4: Template list
window.electronAPI.template.list().then(r => console.log(r));
// Devrait afficher { success: true, templates: [...] }
```

- [ ] `window.electronAPI.getPaths()` fonctionne
- [ ] `window.electronAPI.getAppInfo()` fonctionne
- [ ] `window.electronAPI.template.list()` fonctionne
- [ ] `window.electronAPI.printer` objet accessible

### 4.2 Tester les jobs d'impression
```javascript
// Dans la console

// Créer un job
window.electronAPI.printer.enqueueJob({
  template: 'test',
  data: { name: 'Test Invoice' }
}).then(r => {
  console.log('Job created:', r.id);
});

// Voir les jobs en attente
window.electronAPI.printer.getPendingJobs().then(r => {
  console.log('Pending jobs:', r.jobs);
});
```

- [ ] Job créé avec succès
- [ ] Fichier JSON créé dans `C:\Glowflixprojet\printer\tmp\`
- [ ] `getPendingJobs()` retourne le job créé

### 4.3 Tester les logs depuis Electron
```bash
# Terminal Node.js
node
> import { mainLogger } from './src/main/logger.js'
> mainLogger.initialize()
> mainLogger.info('Test message')

# Vérifier le fichier
# Get-Content C:\Glowflixprojet\logs\main.log | Select-Object -Last 1
# Devrait contenir "Test message"
```

- [ ] Logger fonctionne
- [ ] Messages apparaissent dans les fichiers log

## Phase 5: Test Backend

### 5.1 Tester getPaths() depuis le backend
```bash
# Terminal Node.js
node
> import { getPaths } from './src/main/paths.js'
> const p = getPaths()
> console.log(p.dbFile)
# Devrait afficher: C:\Glowflixprojet\db\lagrace.sqlite
```

- [ ] Backend peut accéder à `getPaths()`
- [ ] `getPaths()` retourne les bons chemins

### 5.2 Tester openDb() depuis le backend
```bash
node
> import { openDb } from './src/main/db.js'
> const db = openDb()
> const result = db.prepare('SELECT 1 as test').get()
> console.log(result)
# Devrait afficher: { test: 1 }
```

- [ ] Backend peut ouvrir la BD
- [ ] Query simples fonctionnent

## Phase 6: Test Print Job System

### 6.1 Créer et traiter un job
```bash
node
> import { enqueuePrintJob, markJobOk, getPendingJobs } from './src/main/printJobQueue.js'
> const j = enqueuePrintJob({ template: 'invoice-a4', data: {} })
> console.log('Created:', j.id)
> console.log('Pending:', getPendingJobs())
> markJobOk(j.id, { pdfPath: 'test.pdf' })
> console.log('After OK:', getPendingJobs())
```

- [ ] Job créé avec UUID valide
- [ ] Job visible dans `getPendingJobs()`
- [ ] Fichier déplacé de `tmp/` à `ok/` après `markJobOk()`
- [ ] Fichier supprimé de `tmp/` après traitement

### 6.2 Vérifier structure fichiers
```powershell
# Après les tests ci-dessus
ls C:\Glowflixprojet\printer\tmp\  # Devrait être vide
ls C:\Glowflixprojet\printer\ok\   # Devrait contenir le job
```

- [ ] Jobs déplacés correctement
- [ ] Pas de jobs orphelins

## Phase 7: Test Templates

### 7.1 Charger un template embarqué
```bash
node
> import { TemplateManager } from './src/main/templateManager.js'
> const tm = new TemplateManager('./print')
> const content = tm.loadTemplate('invoice-a4')
> console.log(content.substring(0, 100))
```

- [ ] Template manager peut charger les templates
- [ ] Contenu n'est pas vide

### 7.2 Sauvegarder un template custom
```bash
node
> const tm = new TemplateManager('./print')
> tm.saveTemplate('test-custom', '<h1>Test</h1>')
> console.log(tm.listTemplates())
```

- [ ] Nouveau template créé dans `C:\Glowflixprojet\printer\templates\`
- [ ] Visible dans `listTemplates()`

- [ ] Template sauvegardé avec succès
- [ ] Fichier créé dans `C:\Glowflixprojet\printer\templates\`

## Phase 8: Test Electron Builder (Production)

### 8.1 Build la UI
```bash
npm run build:ui
```

- [ ] `dist/` créé sans erreurs
- [ ] `dist/index.html` existe
- [ ] `dist/assets/` contient CSS/JS

### 8.2 Créer l'installeur
```bash
npm run build:exe
```

- [ ] Pas d'erreurs de build
- [ ] `dist/installers/` créé
- [ ] Fichier `.exe` créé (Glowflixprojet-1.0.0.exe)
- [ ] Taille > 200MB (bundle complet)

### 8.3 Tester l'installeur
```powershell
# Lancer l'exe
.\dist\installers\Glowflixprojet-1.0.0.exe

# Parcourir l'installation
# Next → Next → Install

# Après installation:
Test-Path "C:\Users\$($env:USERNAME)\AppData\Local\Programs\Glowflixprojet"
# Devrait afficher: True

Test-Path C:\Glowflixprojet\
# Devrait afficher: True
```

- [ ] Installeur démarre sans erreurs
- [ ] App installée dans AppData
- [ ] `C:\Glowflixprojet\` créé par l'installeur
- [ ] App se lance après installation

## Phase 9: Checklist Finale

### Documentation
- [ ] ARCHITECTURE-PRO.md explique la structure
- [ ] BUILD-INSTALLATION.md explique le build
- [ ] BACKEND-INTEGRATION.md explique l'intégration backend
- [ ] QUICK-START.md accessible aux développeurs

### Code Quality
- [ ] Pas d'imports cassés
- [ ] Pas d'erreurs dans la console
- [ ] Loggers structurés (info, warn, error)
- [ ] Gestion d'erreurs cohérente

### Performance
- [ ] Démarrage Electron < 5 secondes
- [ ] BD queries réactives
- [ ] Pas de fuites mémoire observées (DevTools Memory)

## Phase 10: Déploiement

- [ ] Versioning Git avec tags (v1.0.0, etc.)
- [ ] README mis à jour
- [ ] CHANGELOG créé
- [ ] Binaire `.exe` signé (optionnel)
- [ ] Versioning Auto-Update (optionnel)

---

## ✨ Résultat Final

Si toutes les cases sont cochées:

✅ Architecture PRO complète et fonctionnelle
✅ Données persistantes en C:\Glowflixprojet\
✅ Installation propre via executable
✅ APIs Electron/React exposées
✅ Logging centralisé
✅ Job printing robuste
✅ Templates modifiables
✅ Prêt pour la production

**Vous pouvez déployer en production! 🎉**

---

**Date de validation**: [Aujourd'hui]
**Validé par**: [Votre nom]
**Version**: 1.0.0

