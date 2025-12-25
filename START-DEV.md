# Guide de Démarrage - LA GRACE POS

## 🚀 Lancer l'application en mode développement

### Option 1 : Application Desktop (Electron) - RECOMMANDÉ

```powershell
npm run dev:app
```

Cette commande va :
1. ✅ Démarrer le backend (port 3030)
2. ✅ Démarrer le serveur Vite (port 5173)
3. ✅ Ouvrir automatiquement une fenêtre Electron

### Option 2 : Navigateur Web

```powershell
npm run dev:all
```

Puis ouvrir dans le navigateur : http://localhost:5173

### Option 3 : Backend seulement

```powershell
npm run dev
```

### Option 4 : Frontend seulement (Vite)

```powershell
npm run dev:ui
```

## 📝 Notes importantes

- La première fois, installer les dépendances : `npm install`
- Si Electron ne s'ouvre pas, vérifier que `electron` est installé : `npm list electron`
- Pour créer un exécutable : `npm run build:ui && npm run build:electron`

