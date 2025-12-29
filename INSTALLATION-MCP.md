# 🚀 Installation Rapide - Chrome DevTools MCP

Guide d'installation rapide en 5 minutes pour configurer Chrome DevTools MCP dans Cursor.

## ⚡ Installation Express (Recommandée)

### Étape 1 : Vérifier les prérequis

```bash
npm run check:mcp
```

Ce script vérifie automatiquement :
- ✅ Node.js 20+ installé
- ✅ npm et npx disponibles
- ✅ Chrome installé
- ✅ Fichiers de configuration présents

### Étape 2 : Configuration dans Cursor

**Option A : Script PowerShell interactif (Windows)**

```bash
npm run setup:mcp
```

Ce script vous guide pas à pas et ouvre les fichiers nécessaires.

**Option B : Configuration manuelle**

1. **Ouvrez Cursor Settings**
   - Appuyez sur `Ctrl+,` (Windows/Linux) ou `Cmd+,` (Mac)
   - Ou : `File` → `Preferences` → `Settings`

2. **Recherchez "MCP"** dans la barre de recherche

3. **Cliquez sur "New MCP Server"** ou "Add MCP Server"

4. **Copiez cette configuration** :

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

5. **Collez dans Cursor Settings** et sauvegardez

6. **Redémarrez Cursor** (important !)

### Étape 3 : Tester la configuration

Une fois Cursor redémarré, testez avec ces commandes dans le chat :

```
Lis les 20 derniers messages console de Chrome
```

```
Trouve les requêtes réseau qui échouent
```

```
Explique les erreurs JavaScript les plus fréquentes
```

## 📋 Configuration Alternative : Chrome Remote Debugging

Si vous voulez utiliser une instance Chrome déjà ouverte :

1. **Lancez Chrome avec Remote Debugging** :
   ```bash
   chrome.exe --remote-debugging-port=9222
   ```
   
   Ou configurez dans Chrome :
   - Allez sur `chrome://inspect/#remote-debugging`
   - Activez "Discover network targets"

2. **Utilisez cette configuration dans Cursor** :

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--browser-url=http://127.0.0.1:9222"]
    }
  }
}
```

## 🔧 Dépannage

### Le serveur MCP ne démarre pas

**Problème** : "Command not found" ou erreur npx

**Solution** :
```bash
# Vérifiez que Node.js est installé
node --version

# Vérifiez que npx fonctionne
npx --version

# Si npx ne fonctionne pas, réinstallez Node.js
```

### Chrome DevTools MCP ne répond pas

**Problème** : Les outils MCP ne sont pas disponibles

**Solutions** :
1. Redémarrez Cursor complètement
2. Vérifiez les logs Cursor (View → Output → MCP)
3. Testez manuellement :
   ```bash
   npx -y chrome-devtools-mcp@latest
   ```

### Chrome ne démarre pas automatiquement

**C'est normal !** Chrome démarre seulement quand nécessaire. Pour tester :
- Ouvrez Chrome manuellement
- Allez sur une page avec des erreurs console
- Demandez à l'IA : "Lis les messages console"

## 📚 Documentation Complète

Pour plus de détails, consultez :
- **Guide complet** : [SETUP-CHROME-DEVTOOLS-MCP.md](./SETUP-CHROME-DEVTOOLS-MCP.md)
- **Fichiers de config** :
  - `.cursor-mcp-config.json` (configuration standard)
  - `.cursor-mcp-config-with-browser-url.json` (avec Remote Debugging)

## ✅ Vérification Finale

Après configuration, vous devriez pouvoir :

- ✅ Demander à l'IA d'analyser les erreurs console
- ✅ Obtenir des explications sur les stack traces
- ✅ Identifier les requêtes réseau qui échouent
- ✅ Recevoir des plans de correction automatiques

## 🎯 Exemples d'Utilisation

Une fois configuré, essayez ces requêtes dans Cursor :

```
Analyse les 50 derniers messages console et groupe-les par type d'erreur
```

```
Montre-moi toutes les requêtes réseau qui retournent un code d'erreur (4xx ou 5xx)
```

```
Explique cette erreur : [collez votre stack trace]
```

```
Donne-moi un plan de correction pour l'erreur la plus fréquente dans la console
```

## 💡 Astuces

1. **Pour votre application Electron** :
   - En mode dev, DevTools s'ouvre automatiquement
   - Chrome DevTools MCP peut se connecter à cette instance

2. **Pour le frontend Vite** :
   - Ouvrez `http://localhost:5173` dans Chrome
   - Utilisez Chrome DevTools MCP pour déboguer

3. **Performance** :
   - La première utilisation peut prendre quelques secondes (téléchargement du package)
   - Les utilisations suivantes sont instantanées

---

**Besoin d'aide ?** Consultez [SETUP-CHROME-DEVTOOLS-MCP.md](./SETUP-CHROME-DEVTOOLS-MCP.md) pour la documentation complète.

