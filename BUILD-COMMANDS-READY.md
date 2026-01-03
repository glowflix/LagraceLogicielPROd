# 🚀 COMMANDES BUILD - PRÊTES À EXÉCUTER

## Option 1: Script Automatisé (RECOMMANDÉ)

```powershell
# Exécuter le script complet de build
.\BUILD-PRO-FINAL.ps1
```

Le script:
- ✅ Vérifie tous les fichiers requis
- ✅ Nettoie les anciens builds
- ✅ Installe les dépendances
- ✅ Configure Python/venv
- ✅ Compile UI (Vite)
- ✅ Compile IA (PyInstaller)
- ✅ Package Electron
- ✅ Valide le build

---

## Option 2: Commandes Manuelles (Étape par Étape)

### Étape 1: Nettoyer

```powershell
Remove-Item dist, dist-electron -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Nettoyage done"
```

### Étape 2: Installer dépendances

```powershell
npm install
```

### Étape 3: Préparer Python

```powershell
# Créer venv si absent
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}

# Activer
& ".venv\Scripts\Activate.ps1"

# Installer packages
pip install -r requirements.txt
```

### Étape 4: Build UI

```powershell
npm run build:ui
```

### Étape 5: Build IA

```powershell
npm run build:ai
```

### Étape 6: Désactiver venv et build Electron

```powershell
deactivate
npm run build:electron
```

---

## Option 3: Une Seule Ligne (Rapide)

```powershell
rm dist, dist-electron -r -Force; npm install; & ".venv\Scripts\Activate.ps1"; npm run build:ui; npm run build:ai; deactivate; npm run build:electron
```

---

## 📋 Checklist Pré-Build

Avant d'exécuter le build, vérifier:

- [ ] Tous les fichiers modifiés sont présents:
  - `src/api/server-entry.cjs` (nouveau)
  - `electron/main.cjs` (modifié)
  - `src/api/server.js` (modifié)
  - `src/core/paths.js` (modifié)

- [ ] Dépendances npm à jour:
  ```powershell
  npm outdated
  ```

- [ ] Python disponible:
  ```powershell
  python --version  # Doit être 3.8+
  ```

- [ ] PyInstaller installé:
  ```powershell
  & ".venv\Scripts\Activate.ps1"
  pip list | findstr PyInstaller
  deactivate
  ```

---

## ⏱️ Temps Estimé

- Nettoyer: **10 sec**
- Dépendances npm: **30-60 sec** (si absent)
- Venv + packages Python: **1-2 min** (si absent)
- Build:ui (Vite): **2-3 min**
- Build:ai (PyInstaller): **3-5 min**
- Build:electron (packaging): **2-3 min**

**Total: ~10-15 minutes**

---

## ✅ Validation Post-Build

Après le build, vérifier l'existence:

```powershell
# UI
Test-Path "dist\index.html"                           # ✅ Doit être $true

# IA compilée
Test-Path "dist\ai-lagrace\ai-lagrace.exe"            # ✅ Doit être $true

# Installateur
(Get-ChildItem "dist-electron\*.exe" -ErrorAction SilentlyContinue).Count  # ✅ Doit être > 0

# Dossier unpacked (pour tests)
Test-Path "dist-electron\win-unpacked"                # ✅ Doit être $true
```

---

## 🧪 Tester (AVANT Installation)

### Test 1: Lancer l'unpacked

```powershell
# Cela ne remplira pas le registre Windows
Start-Process "dist-electron\win-unpacked\LA GRACE POS.exe"

# Attendre que le serveur démarre (~3-5 sec)
# Vérifier que la fenêtre Electron s'ouvre
```

### Test 2: Vérifier le serveur

```powershell
# Ouvrir un navigateur et aller à:
# http://localhost:3030/api/health

# Doit retourner quelque chose comme:
# {"status":"ok","message":"Server is running"}
```

### Test 3: Vérifier les logs

```powershell
# Ouvrir DevTools (F12 dans l'app)
# Vérifier la console pour les erreurs
# Chercher "[SERVER] API server running on http://localhost:3030"
```

---

## 📦 Installer (APRÈS Tests Réussis)

```powershell
# Double-cliquer sur:
# dist-electron\LA GRACE POS Setup 1.0.0.exe

# OU en ligne de commande:
& "dist-electron\LA GRACE POS Setup 1.0.0.exe"
```

---

## 🔍 Dépannage Rapide

| Problème | Solution |
|----------|----------|
| "Module not found" | `npm install` |
| "Python not found" | Installer Python 3.8+ |
| "PyInstaller error" | `pip install --upgrade pyinstaller` |
| "venv not found" | `python -m venv .venv` |
| "Port 3030 déjà utilisé" | `netstat -ano \| findstr :3030` puis kill le process |
| "ASAR read error" | Vérifier que electron-builder s'est exécuté complètement |

---

## 🎯 Quand le Build Est Prêt

✅ **Fichiers Complétés:**
- `dist/` - UI React compilée
- `dist/ai-lagrace/` - IA PyInstaller
- `dist-electron/` - Electron packagé
- `dist-electron/LA GRACE POS Setup*.exe` - Installateur NSIS

✅ **Zéro Dépendances Externes:**
- Electron runtime: Embarqué ✅
- Node.js: Embarqué ✅
- Python: Compilé en exe ✅
- SQLite: Bundlé ✅

✅ **Production Ready:**
- Paths: Résolus correctement ✅
- ESM/CJS: Lanceur compatible ✅
- Permissions: AppData au lieu de C:\ ✅
- Electron detection: Robuste ✅

---

**Dernière vérification:** TOUTES LES FIXES APPLIQUÉES

1. ✅ server-entry.cjs créé
2. ✅ main.cjs: dataRoot, APP_ROOT, server-entry.cjs
3. ✅ server.js: IS_ELECTRON, DIST_DIR, APP_ROOT
4. ✅ paths.js: userData integration
5. ✅ package.json: scripts et config electron-builder

**Status: 🟢 PRÊT À BUILDER**
