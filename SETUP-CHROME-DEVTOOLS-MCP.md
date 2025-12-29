# Configuration Chrome DevTools MCP pour le débogage

Ce guide explique comment configurer Chrome DevTools MCP dans Cursor pour améliorer le débogage de votre application.

## Qu'est-ce que Chrome DevTools MCP ?

Chrome DevTools MCP est un connecteur (serveur MCP) qui permet à Cursor d'interroger Chrome DevTools (Console, Network, Performance, etc.). Cela permet à l'IA d'analyser les erreurs, les requêtes réseau et les problèmes de performance directement depuis Chrome.

## Avantages

Avec cette configuration, vous pouvez demander à l'IA dans Cursor :

- "Liste les dernières erreurs Console"
- "Explique ce stack trace"
- "Montre la requête réseau qui échoue et sa réponse"
- "Donne-moi un plan de correction pour l'erreur la plus fréquente"

## Prérequis

- Node.js récent (Node 20+ recommandé)
- Cursor installé et configuré
- Chrome ou Chromium installé

## Configuration dans Cursor

### Option 1 : Configuration standard (recommandée pour débuter)

1. Ouvrez Cursor Settings (Paramètres)
2. Allez dans **MCP** → **New MCP Server**
3. Utilisez la configuration suivante :

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

**Note** : Le navigateur peut démarrer automatiquement seulement quand un outil en a besoin. Se connecter au serveur ne lance pas forcément Chrome tout de suite.

### Option 2 : Utiliser une instance Chrome déjà ouverte (pour développement)

Si vous avez déjà Chrome ouvert avec Remote Debugging activé, vous pouvez pointer le serveur MCP vers cette instance :

1. Lancez Chrome avec Remote Debugging activé :
   - Ouvrez Chrome
   - Allez sur `chrome://inspect/#remote-debugging`
   - Activez "Discover network targets" ou configurez le port (par défaut : 9222)

2. Dans Cursor Settings → MCP → New MCP Server, utilisez :

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

### Option 3 : Configuration complète avec fichier de référence

Vous pouvez copier le contenu du fichier `.cursor-mcp-config.json` (voir ci-dessous) dans vos paramètres Cursor.

## Utilisation

Une fois configuré, vous pouvez utiliser les commandes suivantes dans Cursor :

### Exemples de requêtes

1. **Analyser les erreurs console** :
   ```
   Lis les 20 derniers messages console et dis-moi la cause principale.
   ```

2. **Trouver les erreurs réseau** :
   ```
   Trouve la requête réseau qui retourne 500 et montre payload + réponse.
   ```

3. **Plan de correction** :
   ```
   Donne-moi un plan de correction (frontend + backend) pour l'erreur la plus fréquente.
   ```

4. **Analyser un stack trace** :
   ```
   Explique ce stack trace et propose une solution.
   ```

## Configuration pour votre application Electron

Pour déboguer votre application Electron avec Chrome DevTools MCP :

1. **En mode développement** :
   - Votre application Electron ouvre déjà DevTools automatiquement (`electron/main.cjs`)
   - Chrome DevTools MCP peut se connecter à cette instance

2. **Pour le frontend Vite** :
   - Le serveur de développement Vite tourne sur `http://localhost:5173`
   - Ouvrez cette URL dans Chrome et utilisez Chrome DevTools MCP pour la déboguer

3. **Pour le backend Node.js** :
   - Le serveur API tourne sur `http://localhost:3030`
   - Les erreurs backend apparaissent dans la console Node.js, pas dans Chrome DevTools

## Dépannage

### Le serveur MCP ne se connecte pas

- Vérifiez que Node.js est installé et accessible (`node --version`)
- Vérifiez que Chrome est installé
- Redémarrez Cursor après avoir ajouté la configuration MCP

### Chrome ne démarre pas automatiquement

- C'est normal, Chrome démarre seulement quand nécessaire
- Pour forcer le démarrage, utilisez l'Option 2 avec Remote Debugging

### Les outils MCP ne sont pas disponibles

- Vérifiez que la configuration MCP est correctement enregistrée dans Cursor Settings
- Redémarrez Cursor
- Vérifiez les logs de Cursor pour les erreurs de connexion MCP

## Ressources

- [GitHub chrome-devtools-mcp](https://github.com/modelcontextprotocol/servers/tree/main/src/chrome-devtools-mcp)
- [Documentation MCP](https://modelcontextprotocol.io/)
- [Chrome Remote Debugging](https://developer.chrome.com/docs/devtools/remote-debugging/)

## Notes importantes

- Le serveur MCP utilise `npx` pour télécharger et exécuter `chrome-devtools-mcp@latest` automatiquement
- La première utilisation peut prendre quelques secondes pour télécharger le package
- Les outils MCP sont disponibles uniquement quand Chrome DevTools est accessible

