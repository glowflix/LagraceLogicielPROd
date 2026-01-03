# 🚀 COMMANDES RAPIDES - BUILD PRO

## Commande Unique (Recommandée)

```bash
npm run build
```

Cela exécute en séquence:
1. `npm run build:ui` → Compile Vite
2. `npm run build:ai` → Compile Python → EXE
3. `npm run build:electron` → Crée l'installateur

**Temps:** ~10-15 minutes (PyInstaller est lent)

---

## Utiliser les Scripts Fournis

### PowerShell (Professionnel)

```powershell
# Build complet
.\BUILD-PRO.ps1

# Build avec nettoyage (complet)
.\BUILD-PRO.ps1 -Clean

# Skip compilation IA
.\BUILD-PRO.ps1 -SkipAI

# Skip packaging electron
.\BUILD-PRO.ps1 -NoPack
```

### Batch/CMD (Simple)

```cmd
BUILD-PRO.bat
```

---

## Build par Étapes (Déboguer)

```bash
# 1. UI uniquement
npm run build:ui

# Vérifier: dist/index.html existe?
dir dist\

# 2. IA uniquement
npm run build:ai

# Vérifier: dist/ai-lagrace/ai-lagrace.exe existe?
dir dist\ai-lagrace\

# 3. Electron uniquement
npm run build:electron

# Vérifier: dist-electron/*.exe existe?
dir dist-electron\
```

---

## Avant le Build (Setup Unique)

**Une seule fois:**

```bash
# 1. Créer venv
python -m venv .venv

# 2. Activer
.\.venv\Scripts\activate

# 3. Installer PyInstaller
pip install pyinstaller

# 4. Installer deps npm
npm install
```

**Puis:** `npm run build` (sans refaire setup)

---

## Vérifications Rapides

### Vérifier que tout est prêt

```bash
# Python + venv?
.\.venv\Scripts\python --version

# PyInstaller?
pyinstaller --version

# Node + npm?
node --version
npm --version

# Main.py compilable?
.\.venv\Scripts\python ai-lagrace/main.py
# (Appuyer Ctrl+C après 3-4 secondes)
```

### Vérifier le résultat du build

```bash
# Fichiers générés?
dir dist\
dir dist\ai-lagrace\
dir dist-electron\

# Installateur .exe?
dir dist-electron\*.exe
```

---

## Mode Développement (Test)

```bash
# Lancer dev complet
npm run dev
# OU
npm run dev:app
```

Lance:
- Backend Express (port 3030)
- UI Vite (port 5173)
- IA Python
- Electron

Accéder à: `http://localhost:5173` (si juste UI)

---

## Test de Production (Sans Installer)

```bash
# Simuler l'environnement packagé
electron-builder --dir --publish=never
```

Crée un dossier `unpacked/` simulant l'installation.

---

## Après le Build

### Installer et Tester

```cmd
# Exécuter l'installateur
dist-electron\LA GRACE POS Setup 1.0.0.exe

# Suivre l'assistant d'installation
# Puis lancer l'app depuis le menu Démarrer
```

### Vérifier l'Installation

```cmd
# Vérifier que la DB est créée
dir "%APPDATA%\Glowflixprojet\db\"

# Vérifier que ça répond
start http://localhost:3030/api/health
```

---

## Nettoyer / Réinitialiser

```bash
# Supprimer les builds (recommencé du zéro)
rm -r dist dist-electron build

# Réinstaller les packages
rm -r node_modules
npm install

# Relancer le build
npm run build
```

### Nettoyer les données utilisateur (TEST)

```cmd
# Supprimer la DB de test
rmdir /S /Q "%APPDATA%\Glowflixprojet"

# Relancer l'app → DB recréée
```

---

## Distribuer

```bash
# L'installateur est ici:
dist-electron\LA GRACE POS Setup 1.0.0.exe

# Envoyer ce fichier à l'utilisateur
# C'est tout ce qu'il faut!
```

---

## Troubleshoot Rapide

### ❌ "build:ai failed"

```bash
# Tester PyInstaller manuellement
pyinstaller --noconfirm --clean --onedir --name ai-lagrace ai-lagrace/main.py

# Vérifier le résultat
dir dist\ai-lagrace\
```

### ❌ "build:electron failed"

```bash
# Vérifier que dist/ existe
dir dist\
dir dist\ai-lagrace\

# Nettoyer et recommencer
rm -r dist-electron
npm run build:electron
```

### ❌ "node_modules errors"

```bash
# Réinstaller
rm -r node_modules
npm install
npm rebuild  # Pour les .node natives
```

### ❌ ".exe not found after installation"

```bash
# Vérifier que build:ai a marché
npm run build:ai
ls -la dist/ai-lagrace/ai-lagrace.exe

# Sinon, nettoyer et relancer tout
rm -r dist dist-electron
npm run build
```

---

## Status Workflow

```
npm run build
  ↓
  ├─ build:ui ✅ (2-3 min)
  │   └─ dist/index.html créé
  ├─ build:ai ✅ (3-5 min)
  │   └─ dist/ai-lagrace/ai-lagrace.exe créé
  └─ build:electron ✅ (2-3 min)
      └─ dist-electron/LA GRACE POS Setup.exe créé
  ↓
✅ Build complet réussi!
```

---

## Cheats Sheet

| Task | Commande |
|------|----------|
| Build complet | `npm run build` |
| Dev complet | `npm run dev` |
| UI uniquement | `npm run build:ui` |
| IA uniquement | `npm run build:ai` |
| Électron uniquement | `npm run build:electron` |
| Prévisualiser UI | `npm run preview:ui` |
| Nettoyer | `rm -r dist dist-electron` |
| Tester manuellement IA | `.\.venv\Scripts\python ai-lagrace/main.py` |
| Ajouter package npm | `npm install <package>` |
| Ajouter package Python | `.\.venv\Scripts\pip install <package>` |

---

**💡 Conseil:** Mettez en favori le script `BUILD-PRO.ps1`, c'est tout ce que vous devez faire pour un build pro complet.

```powershell
.\BUILD-PRO.ps1
```

Done! 🎉
