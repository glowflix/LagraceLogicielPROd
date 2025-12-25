# Guide de Démarrage Rapide

## 🔧 Correction des erreurs

Les erreurs suivantes ont été corrigées :
1. ✅ Suppression de `bonjour` (package inexistant)
2. ✅ Création du fichier `src/api/server.js`
3. ✅ Configuration du serveur Express + Socket.io

## 📦 Installation

### 1. Installer les dépendances

```bash
npm install
```

Cela installera toutes les dépendances nécessaires, y compris Vite pour l'UI React.

### 2. Créer le fichier `.env`

Créez un fichier `.env` à la racine du projet :

```env
# Configuration Glowflixprojet
GLOWFLIX_ROOT_DIR=C:\Glowflixprojet
GLOWFLIX_PRINT_DIR=C:\Glowflixprojet\printer

# Serveur
PORT=3030
APP_BASE_URL=http://localhost:3030
NODE_ENV=development

# Base de données
DB_PATH=C:\Glowflixprojet\db\glowflixprojet.db

# Sécurité
JWT_SECRET=your-secret-key-change-in-production
LICENSE_KEY=0987654321

# Google Sheets Synchronisation
GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec
SYNC_INTERVAL_MS=10000
```

### 3. Créer le fichier `.env` pour l'UI React

Créez un fichier `src/ui/.env` :

```env
VITE_API_URL=http://localhost:3030
```

## 🚀 Démarrage

### Option 1 : Démarrer le backend et l'UI séparément

**Terminal 1 - Backend :**
```bash
npm start
```
Le serveur démarre sur `http://localhost:3030`

**Terminal 2 - UI React :**
```bash
npm run dev:ui
```
L'interface démarre sur `http://localhost:5173`

### Option 2 : Mode développement avec watch (backend)

```bash
npm run dev
```

## ✅ Vérification

1. **Backend** : Ouvrez http://localhost:3030/api/health
   - Vous devriez voir : `{"status":"ok","timestamp":"..."}`

2. **UI React** : Ouvrez http://localhost:5173
   - L'écran de démarrage (SplashScreen) devrait s'afficher
   - Puis la page de licence
   - Entrez la clé : `0987654321`

## 🐛 Résolution des problèmes

### Erreur : "vite n'est pas reconnu"
```bash
# Réinstaller les dépendances
npm install
```

### Erreur : "Cannot find module"
```bash
# Vérifier que tous les fichiers existent
# Le serveur devrait être dans : src/api/server.js
```

### Erreur : Port déjà utilisé
```bash
# Changer le port dans .env
PORT=3031
```

## 📝 Prochaines étapes

1. ✅ Backend de base créé
2. ⏳ Créer les routes API complètes (auth, products, sales, etc.)
3. ⏳ Créer la connexion SQLite
4. ⏳ Implémenter les repositories
5. ⏳ Ajouter la synchronisation Google Sheets

## 📚 Structure créée

```
src/
├── api/
│   └── server.js          ✅ Serveur Express + Socket.io
├── core/
│   ├── paths.js           ✅ Gestion des chemins
│   └── logger.js          ✅ Système de logs
├── db/
│   └── schema.sql         ✅ Schéma SQLite
└── ui/                    ✅ Application React complète
    ├── pages/             ✅ Toutes les pages
    ├── components/        ✅ Composants réutilisables
    └── store/             ✅ State management
```

Tout est prêt ! 🎉

