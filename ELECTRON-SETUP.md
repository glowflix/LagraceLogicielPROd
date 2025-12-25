# Configuration Electron - LA GRACE POS

## 🚀 Installation

### 1. Installer les dépendances

```bash
npm install
```

Cela installera Electron, electron-builder et les autres dépendances nécessaires.

### 2. Build de l'UI React (requis avant de lancer Electron)

```bash
npm run build:ui
```

## 📦 Utilisation

### Mode développement

```bash
# Option 1 : Lancer Electron avec le serveur déjà démarré
# Terminal 1 : Démarrer le serveur
npm run dev

# Terminal 2 : Lancer Electron
npm run electron:dev

# Option 2 : Tout lancer ensemble (avec Vite pour le hot-reload UI)
npm run dev:electron
```

### Mode production

```bash
# 1. Build de l'UI React
npm run build:ui

# 2. Lancer Electron
npm run electron
```

## 🔨 Build d'installation (Installer Windows/Mac/Linux)

### Windows (NSIS Installer)

```bash
npm run build:ui
npm run build:electron
```

L'installer sera créé dans `dist-electron/`.

### Structure de l'application Electron

```
electron/
  └── main.cjs          # Point d'entrée Electron (CommonJS)

src/
  └── api/
      └── server.js     # Serveur Node.js (ES Modules)
```

### Fonctionnement

1. **Electron démarre** → `electron/main.cjs`
2. **Serveur Node.js lancé** → `src/api/server.js` (processus séparé)
3. **Fenêtre Electron** → Charge `http://localhost:3030`
4. **UI React** → Servie depuis le serveur Express

### Avantages

- ✅ Application desktop native
- ✅ Serveur Node.js intégré (SQLite, impression, etc.)
- ✅ UI React moderne
- ✅ Accessible aussi via navigateur web (http://localhost:3030)
- ✅ Mode offline-first garanti

### Configuration

L'application utilise :
- **Port** : 3030 (configurable via `process.env.PORT`)
- **Base de données** : `C:\Glowflixprojet\db\glowflixprojet.db`
- **Impression** : `C:\Glowflixprojet\printer\`

### Dépannage

**Erreur : "Serveur non trouvé"**
- Vérifiez que `src/api/server.js` existe
- Build de l'UI : `npm run build:ui`

**L'application ne se charge pas**
- Vérifiez que le serveur démarre (logs dans la console)
- Vérifiez le port 3030 (pas déjà utilisé)
- Ouvrez DevTools : `Ctrl+Shift+I` (Windows) ou `Cmd+Option+I` (Mac)

**Mode développement**
- Utilisez `npm run dev:electron` pour avoir le hot-reload de Vite
- DevTools s'ouvre automatiquement en mode dev

