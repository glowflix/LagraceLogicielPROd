#!/bin/bash

# 🚀 QUICK START - Architecture PRO Glowflixprojet

## Installation & Démarrage Rapide

### 1️⃣ Installer dépendances
```bash
npm install
```

### 2️⃣ Tester l'architecture
```bash
node scripts/test-architecture.js
```
✓ Vérifie que tous les fichiers core sont en place

### 3️⃣ Démarrer en mode dev
```bash
npm run dev
```
✓ Cela va:
- Démarrer le backend (port 3030)
- Démarrer Vite UI (port 5173)
- Démarrer Electron
- Créer C:\Glowflixprojet\ automatiquement
- Lancer l'IA Python (si activée)

### 4️⃣ Vérifier que C:\Glowflixprojet\ est créé
```powershell
# Windows PowerShell
dir C:\Glowflixprojet\

# Devrait afficher:
# cache\
# db\
# logs\
# printer\
```

### 5️⃣ Consulter les logs
```bash
# Main Electron
Get-Content C:\Glowflixprojet\logs\main.log -Tail 20

# Backend API
Get-Content C:\Glowflixprojet\logs\backend.log -Tail 20

# Impression
Get-Content C:\Glowflixprojet\logs\print.log -Tail 20
```

---

## 📁 Explorer les Fichiers Clés

### `src/main/paths.js` - Les chemins
```bash
# Voir comment sont créés les chemins
code src/main/paths.js
```

### `src/main/db.js` - La BD
```bash
# Voir comment SQLite est configurée
code src/main/db.js

# Consulter la BD en dev
# C:\Glowflixprojet\db\lagrace.sqlite
```

### `electron/main.cjs` - Point d'entrée Electron
```bash
code electron/main.cjs
# Voir comment l'initialisation est appelée
```

### `src/ui/hooks/useElectronAPI.js` - APIs React
```bash
# Voir les hooks et services disponibles
code src/ui/hooks/useElectronAPI.js
```

---

## 🛠️ Tâches Courantes

### Adapter une route existante au nouveau modèle

**Avant:**
```javascript
// src/api/routes/invoices.js
app.get('/api/invoices', (req, res) => {
  // accès DB direct...
});
```

**Après:**
```javascript
import { openDb } from '../main/db.js';
import { backendLogger } from '../main/logger.js';

app.get('/api/invoices', (req, res) => {
  try {
    const db = openDb();
    const invoices = db.prepare('SELECT * FROM invoices').all();
    backendLogger.info('Fetched invoices', { count: invoices.length });
    res.json(invoices);
  } catch (err) {
    backendLogger.error('Get invoices error', err);
    res.status(500).json({ error: err.message });
  }
});
```

### Utiliser les chemins dans le backend

```javascript
import { getPaths } from '../main/paths.js';

const paths = getPaths();

// Lire depuis cache
const cachePath = paths.cacheDir;
const logsPath = paths.logsDir;
const printerPath = paths.printerDir;
```

### Créer un job d'impression

```javascript
import { enqueuePrintJob } from '../main/printJobQueue.js';
import { printLogger } from '../main/logger.js';

app.post('/api/print/invoice', async (req, res) => {
  const result = enqueuePrintJob({
    template: 'invoice-a4',
    data: req.body,
    format: 'A4',
  });
  
  printLogger.info('Print job created', result);
  res.json(result);
});
```

### Charger un template modifiable

```javascript
import { templateManager } from '../main/templateManager.js';

// Charger le contenu du template
const invoiceTemplate = templateManager.loadTemplate('invoice-a4');

// Sauvegarder une version modifiée
templateManager.saveTemplate('invoice-a4-custom', newContent);

// Lister tous les templates
const allTemplates = templateManager.listTemplates();
```

---

## 🎨 Utiliser les APIs depuis React

### Charger les chemins au mount

```javascript
import { useAppPaths } from '@/hooks/useElectronAPI';

export function MyComponent() {
  const { paths, loading } = useAppPaths();
  
  if (loading) return <div>Loading...</div>;
  
  return <div>{paths.root}</div>;
}
```

### Créer un job d'impression

```javascript
import { printerService } from '@/hooks/useElectronAPI';

async function handlePrint() {
  const result = await printerService.enqueue({
    template: 'invoice-a4',
    data: { /* ... */ },
  });
  
  if (result.success) {
    console.log('Job created:', result.id);
  }
}
```

### Gérer les templates

```javascript
import { templateService } from '@/hooks/useElectronAPI';

// Lister
const result = await templateService.list();
console.log(result.templates);

// Charger
const content = await templateService.load('invoice-a4');

// Modifier et sauvegarder
await templateService.save('invoice-a4', newContent);

// Supprimer
await templateService.delete('custom-template');

// Réinitialiser
await templateService.reset();
```

---

## 🧪 Tester une fonction

### Tester getPaths()
```bash
# Terminal Node
node
> import { getPaths } from './src/main/paths.js'
> const p = getPaths()
> console.log(p.root)
C:\Glowflixprojet
```

### Tester openDb()
```bash
# Terminal Node
node
> import { openDb, initializeSchema } from './src/main/db.js'
> const db = openDb()
> initializeSchema()
> const invoices = db.prepare('SELECT COUNT(*) as count FROM invoices').get()
> console.log(invoices)
```

### Tester printJobQueue
```bash
# Terminal Node
node
> import { enqueuePrintJob, getPendingJobs } from './src/main/printJobQueue.js'
> const result = enqueuePrintJob({ template: 'test', data: {} })
> console.log(result)
> console.log(getPendingJobs())
```

---

## 🔍 Déboguer

### Voir tous les logs en temps réel
```bash
# Main
tail -f C:\Glowflixprojet\logs\main.log

# Backend
tail -f C:\Glowflixprojet\logs\backend.log

# Print
tail -f C:\Glowflixprojet\logs\print.log
```

### Vérifier l'état des dossiers d'impression
```powershell
# Jobs en cours
ls C:\Glowflixprojet\printer\tmp\

# Jobs réussis
ls C:\Glowflixprojet\printer\ok\

# Jobs échoués
ls C:\Glowflixprojet\printer\err\
```

### Accéder à la BD en mode dev
```bash
# Avec sqlite3 (si installé)
sqlite3 C:\Glowflixprojet\db\lagrace.sqlite

# Ou depuis Node
node
> import { openDb } from './src/main/db.js'
> const db = openDb()
> db.prepare('SELECT * FROM sqlite_master WHERE type="table"').all()
```

---

## 🏗️ Build pour Production

### 1. Compiler la UI
```bash
npm run build:ui
```
✓ Crée `dist/` avec le HTML/JS/CSS

### 2. Créer l'installeur
```bash
npm run build:exe
```
✓ Crée `dist/installers/Glowflixprojet-1.0.0.exe`

### 3. Tester l'installeur
```bash
# Lancer l'exe
.\dist\installers\Glowflixprojet-1.0.0.exe

# Vérifier que C:\Glowflixprojet\ a été créé
dir C:\Glowflixprojet\
```

---

## 📚 Documentation

- **ARCHITECTURE-PRO.md** - Vue d'ensemble complète
- **BUILD-INSTALLATION.md** - Détails du build Electron
- **BACKEND-INTEGRATION.md** - Adapter le backend
- **IMPLEMENTATION-COMPLETE.md** - Résumé final

---

## ⚡ Commandes Essentielles

```bash
# Développement
npm run dev                 # Démarrer complètement
npm run dev:ui             # UI seulement
npm run start              # Backend seulement

# Build
npm run build:ui           # Vite build
npm run build:exe          # Créer installeur
npm run build:all          # UI + exe

# Test
node scripts/test-architecture.js    # Vérifier setup

# Nettoyage
npm run clean:cache        # Nettoyer cache (si défini)
```

---

## ✨ Vous êtes prêt!

- Backend: Utilise `openDb()`, `getPaths()`, loggers
- Frontend: Utilise `window.electronAPI` et hooks
- Installation: `npm run build:exe`
- Données: Toujours dans `C:\Glowflixprojet\`

**Commencez par: `npm run dev`**
