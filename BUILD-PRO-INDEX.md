# 📚 INDEX - BUILD PRO COMPLET

## 🎯 Par Où Commencer?

### 1️⃣ **Lecture rapide** (5 min)
→ [BUILD-QUICK-START.md](BUILD-QUICK-START.md)  
Les commandes essentielles, c'est tout.

### 2️⃣ **Comprendre l'architecture** (15 min)
→ [BUILD-PRO-RESUME.md](BUILD-PRO-RESUME.md)  
Quoi a changé, comment ça marche, checklist.

### 3️⃣ **Guide complet détaillé** (30 min)
→ [BUILD-PRO-COMPLETE.md](BUILD-PRO-COMPLETE.md)  
Tout en détail: phases, structure, troubleshooting.

---

## 🛠️ Fichiers Exécutables

### Windows PowerShell (Recommandé)
```powershell
.\BUILD-PRO.ps1
```
- Vérifications automatiques
- Phasing explicite
- Options avancées: `-Clean`, `-SkipAI`

### Windows CMD (Simple)
```cmd
BUILD-PRO.bat
```
- Interface basique
- Fonctionnel partout

---

## 📋 Étapes Essentielles

### ✅ Setup (Une seule fois)

```bash
# 1. Aller au projet
cd "D:\logiciel\La Grace pro\v1"

# 2. Créer Python venv
python -m venv .venv

# 3. Activer et installer PyInstaller
.\.venv\Scripts\activate
pip install pyinstaller
npm install
```

### ✅ Build (À chaque release)

```bash
# Commande unique
npm run build

# OU avec le script
.\BUILD-PRO.ps1
```

### ✅ Test

```bash
# Lancer l'installateur
dist-electron\LA GRACE POS Setup 1.0.0.exe
```

---

## 📦 Résultat Final

```
dist-electron/LA GRACE POS Setup 1.0.0.exe  ← C'est tout!
```

Cet installateur contient:
- ✅ UI React complète
- ✅ Backend Express + SQLite
- ✅ IA Python (compilée)
- ✅ Aucune dépendance externe

---

## 🚀 Commandes Principales

```bash
# Build complet (recommandé)
npm run build

# Build par étapes
npm run build:ui       # Vite
npm run build:ai       # PyInstaller
npm run build:electron # Electron-builder

# Développement
npm run dev            # Tous les services

# Preview
npm run preview:ui     # UI seulement
```

---

## 📖 Documentation Détaillée

### Fichiers de Configuration Modifiés

- **package.json** → build scripts + electron-builder config
- **electron/main.cjs** → Mode dev/prod pour IA, userData init
- **src/core/paths.js** → Database paths stables en prod

### Fichiers Nouveaux

- **BUILD-PRO.ps1** → Script PowerShell professionnel
- **BUILD-PRO.bat** → Script Batch simple
- **BUILD-PRO-COMPLETE.md** → Guide complet
- **BUILD-PRO-RESUME.md** → Résumé des modifications
- **BUILD-QUICK-START.md** → Commandes rapides
- **BUILD-PRO-INDEX.md** → Ce fichier

---

## 🎓 Concepts Clés

### PyInstaller --onedir
L'IA Python est compilée en:
```
dist/ai-lagrace/
├── ai-lagrace.exe      ← Exécutable
├── piper/              ← TTS
├── models/             ← Modèles vocaux
└── [autres dépendances]
```

Embarquée dans l'installateur Electron via `extraResources`.

### asarUnpack
Les fichiers `.node` (better-sqlite3, bcrypt) sont déballés hors du bundle ASAR pour accès direct.

### userData en Production
Chemin stable pour la base de données:
- **Prod:** `C:\Users\<User>\AppData\Roaming\Glowflixprojet`
- **Dev:** `C:\Glowflixprojet`

---

## ⚠️ Checklist Avant Build

- [ ] `.venv` existe et contient Python 3.9+
- [ ] PyInstaller installé: `pip list | findstr pyinstaller`
- [ ] `npm install` exécuté
- [ ] `ai-lagrace/main.py` teste en local:
  ```bash
  .\.venv\Scripts\python ai-lagrace/main.py
  # (Ctrl+C après vérification)
  ```

---

## 🐛 Troubleshooting Rapide

| Problème | Solution |
|----------|----------|
| `build:ai failed` | `npm run build:ai` (debug seul) |
| `node_modules error` | `rm -r node_modules && npm install` |
| `.exe not found` | Vérifier que `build:ai` a marché |
| `better-sqlite3 error` | Vérifier `asarUnpack` dans package.json |

Voir [BUILD-PRO-COMPLETE.md](BUILD-PRO-COMPLETE.md#🔴-problèmes-connus--solutions) pour détails.

---

## 🎯 Workflow Recommandé

```
1. Setup (première fois):
   python -m venv .venv
   .\.venv\Scripts\activate
   pip install pyinstaller
   npm install

2. Développement:
   npm run dev

3. Build release:
   npm run build
   OU
   .\BUILD-PRO.ps1

4. Test installation:
   dist-electron\LA GRACE POS Setup 1.0.0.exe

5. Distribuer:
   Copier le .exe
```

---

## 📞 Support & Questions

### Documentation
- **Détails complets:** [BUILD-PRO-COMPLETE.md](BUILD-PRO-COMPLETE.md)
- **Modifications appliquées:** [BUILD-PRO-RESUME.md](BUILD-PRO-RESUME.md)
- **Commandes rapides:** [BUILD-QUICK-START.md](BUILD-QUICK-START.md)

### Vérifications
```bash
# Tout fonctionne?
npm run build

# Vérifier le résultat
dir dist-electron\*.exe
```

---

## 📊 État Actuel

```
✅ Package.json: Scripts + config
✅ electron/main.cjs: Mode dev/prod
✅ src/core/paths.js: userData
✅ Scripts PowerShell & Batch fournis
✅ Documentation complète

Status: 🟢 READY FOR PRODUCTION
```

---

**Date:** Janvier 2026  
**Version:** 1.0.0  
**Status:** ✅ COMPLET

---

### Navigation Rapide

- **Je veux juste builder:** [BUILD-QUICK-START.md](BUILD-QUICK-START.md)
- **Je veux comprendre:** [BUILD-PRO-RESUME.md](BUILD-PRO-RESUME.md)
- **Je veux tous les détails:** [BUILD-PRO-COMPLETE.md](BUILD-PRO-COMPLETE.md)
- **J'ai un problème:** Voir "Troubleshooting" ci-dessus

**TL;DR:** `npm run build` → `dist-electron/LA GRACE POS Setup.exe` → Done! 🎉
