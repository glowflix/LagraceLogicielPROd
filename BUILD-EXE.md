# Guide de Build pour Exécutable Windows (.exe)

## Option 1 : Utiliser pkg (Recommandé - Simple)

### Installation
```bash
npm install --save-dev pkg
```

### Configuration
Le fichier `package.json` contient déjà la configuration `pkg` :
- Scripts à inclure
- Assets à copier
- Chemin de sortie

### Build
```bash
npm run build:exe
```

L'exécutable sera créé dans `dist/LaGrace-POS.exe`

### Limitations
- `better-sqlite3` nécessite des binaires natifs
- Il faut inclure les fichiers `.node` dans le build
- Peut nécessiter des ajustements pour SQLite

## Option 2 : Electron (Recommandé pour app complète)

### Installation
```bash
npm install --save-dev electron electron-builder
```

### Créer `electron/main.js`
```javascript
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let serverProcess;
let mainWindow;

function startServer() {
  const serverPath = path.join(__dirname, '../src/api/server.js');
  serverProcess = spawn('node', [serverPath], {
    cwd: __dirname,
    stdio: 'inherit'
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Attendre que le serveur démarre
  setTimeout(() => {
    mainWindow.loadURL('http://localhost:3030');
  }, 2000);
}

app.whenReady().then(() => {
  startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
```

### Configuration electron-builder
Ajouter dans `package.json` :
```json
{
  "main": "electron/main.js",
  "build": {
    "appId": "com.lagrace.pos",
    "productName": "LA GRACE POS",
    "win": {
      "target": "nsis",
      "icon": "asset/image/icon/photo.ico"
    },
    "files": [
      "src/**/*",
      "asset/**/*",
      "node_modules/**/*",
      "package.json"
    ]
  }
}
```

### Build
```bash
npm run build:electron
```

## Option 3 : Nexe (Alternative)

```bash
npm install -g nexe
nexe src/api/server.js -o LaGrace-POS.exe -t windows-x64-18.0.0
```

## Notes importantes

1. **SQLite natif** : `better-sqlite3` nécessite des binaires compilés
   - Solution : Utiliser Electron qui inclut Node.js
   - Ou : Utiliser `sql.js` (pure JS, plus lent)

2. **Assets** : S'assurer que tous les assets sont inclus
   - Images, templates, schéma SQL

3. **Dépendances** : Toutes les dépendances doivent être packagées

## Scripts disponibles

- `npm run dev` : Démarre le serveur en mode watch
- `npm run dev:ui` : Démarre l'UI React
- `npm run dev:all` : Démarre les deux en parallèle
- `npm run build:exe` : Build l'exécutable avec pkg
- `npm run build:ui` : Build l'UI React pour production

