# 🖥️ GUIDE COMPLET D'INSTALLATION - NOUVEAU PC

## 📋 ÉTAPES PRINCIPALES

### 1️⃣ PRÉREQUIS SYSTÈME
Avant tout, installer sur ton nouveau PC:

**Logiciels à installer manuellement:**

| Logiciel | Version | Lien | Raison |
|----------|---------|------|--------|
| **Node.js** | 18+ | https://nodejs.org | Backend + frontend + Electron |
| **Python** | 3.10+ | https://www.python.org | Module AI LaGrace |
| **Git** | Latest | https://git-scm.com | Cloner le projet |
| **Visual Studio Code** | Latest | https://code.visualstudio.com | Éditeur (optionnel) |

---

### 🔧 APRÈS TÉLÉCHARGER PYTHON - ÉTAPES IMPORTANTES

**ATTENTION:** Lors de l'installation de Python, **COCHER CETTE CASE:**
```
☑️ "Add Python to PATH"
```

Puis ouvrir **PowerShell** et vérifier:

```powershell
# Vérifier que Python est bien installé
python --version

# Vérifier que pip fonctionne
pip --version

# Résultat attendu:
# Python 3.10.x (ou plus récent)
# pip 23.x.x
```

Si ça ne marche pas:
```powershell
# Essayer avec python3
python3 --version

# Ou sur Windows
py --version
```

---

### 🔧 APRÈS TÉLÉCHARGER NODE.JS - VÉRIFIER

```powershell
# Vérifier Node.js
node --version

# Vérifier npm
npm --version

# Résultat attendu:
# v18.x.x (ou plus récent)
# 9.x.x (ou plus récent)
```

---

### 2️⃣ CLONER LE PROJET

```powershell
# Ouvrir PowerShell (cmd ou PowerShell)
cd D:\logiciel

# Cloner le repository
git clone <URL-DU-REPO> "La Grace pro\v1"

# Aller dans le dossier
cd "La Grace pro\v1"
```

---

### 3️⃣ INSTALLER LES DÉPENDANCES NODE.JS

```powershell
# Installer les packages npm
npm install

# ✅ Cela installe automatiquement:
#   - Express.js (backend)
#   - React + Vite (frontend)
#   - Electron (app desktop)
#   - Better-SQLite3 (base de données)
#   - Et toutes les autres dépendances
```

**Durée estimée:** 3-5 minutes (dépend de la connexion)

---

### 4️⃣ CONFIGURER PYTHON (POUR L'IA)

```powershell
# ✅ ÉTAPE 1: Vérifier que Python fonctionne
python --version

# ✅ ÉTAPE 2: Aller dans le dossier du projet
cd "D:\logiciel\La Grace pro\v1"

# ✅ ÉTAPE 3: Créer l'environnement virtuel Python
python -m venv .venv

# ✅ ÉTAPE 4: Activer l'environnement virtuel
.\.venv\Scripts\Activate.ps1

# ✅ ÉTAPE 5: Installer les dépendances Python
pip install -r requirements.txt

# ✅ Vérifier que ça marche
python --version
```

**Résultat attendu:**
```
(.venv) PS D:\logiciel\La Grace pro\v1>
Python 3.10.x
```

Le `(.venv)` au début signifie que l'environnement Python est activé ✅

---

### 5️⃣ CRÉER LA BASE DE DONNÉES

```powershell
# La BD est créée automatiquement au premier démarrage
# Mais tu peux la créer manuellement:

npm run migrate

# ✅ Cela exécute les migrations SQL depuis:
#    src/db/migrations/
```

---

### 6️⃣ CONFIGURER LES VARIABLES D'ENVIRONNEMENT

Créer le fichier `.env` à la racine du projet:

```env
# .env
NODE_ENV=development
PORT=3000
ELECTRON_ENV=development

# Google Sheets (optionnel)
GOOGLE_SHEET_ID=votre_id_sheets
GOOGLE_SHEETS_API_KEY=votre_clé_api

# Device ID
DEVICE_ID=POS-1

# AI LaGrace (optionnel)
AI_PORT=5000
```

---

### 7️⃣ LANCER L'APPLICATION

**Option 1: Développement (Mode Dev)**
```powershell
npm run dev

# ✅ Lance:
#    - Backend (Express) sur port 3000
#    - Frontend (Vite) sur port 5173
#    - IA LaGrace (Python)
#    - Electron (App Desktop)
```

**Option 2: Backend seulement**
```powershell
npm start

# ✅ Lance juste le serveur Express sur port 3000
# Accès: http://localhost:3000
```

**Option 3: Frontend seulement**
```powershell
npm run dev:ui

# ✅ Lance Vite sur port 5173
# Accès: http://localhost:5173
```

---

## 🗄️ STRUCTURE DE LA BASE DE DONNÉES

La base de données **SQLite** est créée automatiquement:

```
src/db/gestion_magasin.db
```

**Tables principales:**
- `products` - Liste des produits
- `product_units` - Unités de vente (PIECE, CARTON, MILLIER)
- `sales` - Factures
- `sale_items` - Détails des ventes
- `debts` - Dettes clients
- `users` - Utilisateurs/Vendeurs
- `stock_moves` - Historique des mouvements de stock

---

## 📦 DÉPENDANCES PRINCIPALES

### Backend (Node.js)
```json
{
  "better-sqlite3": "Database SQLite",
  "express": "Web framework",
  "bcrypt": "Hash passwords",
  "cors": "CORS support",
  "dotenv": "Environment variables",
  "electron": "Desktop app",
  "vite": "Frontend bundler"
}
```

### Frontend (React)
```json
{
  "react": "UI framework",
  "zustand": "State management",
  "axios": "HTTP client",
  "lucide-react": "Icons"
}
```

### Python (IA)
```
torch==2.0.0
transformers==4.30.0
flask==2.3.0
```

---

## ✅ CHECKLIST D'INSTALLATION

```
☐ Node.js installé (node --version)
☐ Python installé (python --version)
☐ Dossier du projet cloné
☐ npm install terminé
☐ .venv Python créé
☐ pip install requirements.txt terminé
☐ .env configuré
☐ npm run dev lancé avec succès
☐ Interface accessible sur http://localhost:5173
☐ Backend fonctionnel (vérifier console)
```

---

## 🔧 COMMANDES UTILES

```powershell
# Nettoyer et réinstaller
npm run clean

# Reconstruire le frontend
npm run build:ui

# Vérifier la base de données
sqlite3 src/db/gestion_magasin.db ".tables"

# Voir les logs
npm run dev 2>&1 | Tee-Object -FilePath debug.log

# Killer le processus (si bloqué)
Get-Process node | Stop-Process -Force
```

---

## 🚨 ERREURS COURANTES

### Erreur: "Python not found" ou "python: command not found"
```powershell
# ❌ Problem: Python n'est pas dans le PATH

# ✅ Solution 1: Réinstaller Python avec "Add Python to PATH"
# https://www.python.org → Télécharger → Installer
# ☑️ Cocher "Add Python to PATH" au début de l'installation

# ✅ Solution 2: Vérifier l'installation manuelle
# Aller à: C:\Users\[TON_NOM]\AppData\Local\Programs\Python\Python310\
# Copier ce chemin dans les Variables d'Environnement Windows

# ✅ Solution 3: Utiliser le chemin complet
"C:\Users\[TON_NOM]\AppData\Local\Programs\Python\Python310\python.exe" --version
```

### Erreur: "PowerShell cannot be loaded because running scripts is disabled"
```powershell
# Exécuter cette commande DANS PowerShell (admin)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Puis réessayer:
.\.venv\Scripts\Activate.ps1
```

### Erreur: "requirements.txt not found"
```powershell
# ❌ Vérifier que tu es dans le bon dossier
# ✅ Doit être: D:\logiciel\La Grace pro\v1

cd "D:\logiciel\La Grace pro\v1"
ls requirements.txt  # Doit afficher le fichier
```

### Erreur: "pip install -r requirements.txt" ne marche pas
```powershell
# ✅ Solution: Utiliser pip3 au lieu de pip
pip3 install -r requirements.txt

# Ou vérifier que l'environnement virtuel est activé
# (.venv) PS > = ✅ activé
# PS > = ❌ pas activé

# Réactiver:
.\.venv\Scripts\Activate.ps1
```

### Erreur: "better-sqlite3 not found"
```powershell
npm install --build-from-source
# Ou réinstaller:
npm install
```

### Erreur: Python pas trouvé
```powershell
# Vérifier l'installation
python --version

# Ajouter à PATH si nécessaire
# Rechercher "Variables d'environnement" dans Windows
# Ajouter le chemin Python
```

### Erreur: "Port 3000 already in use"
```powershell
# Trouver le processus
Get-Process | Where-Object {$_.Port -eq 3000}

# Ou changer le PORT dans .env
# PORT=3001
```

### Base de données vide/corrompue
```powershell
# Supprimer l'ancienne BD
Remove-Item src/db/gestion_magasin.db

# Recréer
npm run migrate
```

---

## 📞 SUPPORT

Si problème avec l'installation:
1. Vérifier logs: `npm run dev`
2. Vérifier les versions: `node -v`, `npm -v`, `python --version`
3. Nettoyer cache: `npm cache clean --force`
4. Réinstaller: `npm install`

---

## 🎯 RÉSUMÉ RAPIDE (TL;DR)

```powershell
# 1. Clone
git clone <URL> "D:\logiciel\La Grace pro\v1"
cd "La Grace pro\v1"

# 2. Node.js
npm install

# 3. Python
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 4. BD
npm run migrate

# 5. Lancer
npm run dev

# ✅ DONE! Accès: http://localhost:5173
```

---

**Version:** 2026-01-10  
**Dernière mise à jour:** Janvier 2026
