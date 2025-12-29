# 🎯 Où Coller la Configuration MCP - Guide Simple

## ✅ Solution Rapide

**Exécutez cette commande pour ouvrir automatiquement le bon fichier :**

```bash
npm run open:mcp-config
```

Ce script va :
1. Trouver le fichier de configuration MCP
2. L'ouvrir dans Cursor
3. Vous montrer exactement où coller la configuration

## 📍 Emplacement du Fichier

Sur votre système, le fichier se trouve probablement ici :

```
C:\Users\Jeariss Director\AppData\Roaming\Cursor\User\settings.json
```

## 📝 Instructions Manuelles

### Méthode 1 : Via la Palette de Commandes (Recommandée)

1. **Appuyez sur `Ctrl + Shift + P`** dans Cursor
2. **Tapez** : `Preferences: Open User Settings (JSON)`
3. **Sélectionnez** cette option
4. **Un fichier JSON s'ouvrira** - c'est là que vous devez coller la configuration

### Méthode 2 : Ouvrir le Fichier Directement

1. **Appuyez sur `Win + R`**
2. **Tapez** : `%APPDATA%\Cursor\User\`
3. **Appuyez sur Entrée**
4. **Ouvrez** le fichier `settings.json` avec Cursor

### Méthode 3 : Via le Script Automatique

```bash
npm run open:mcp-config
```

## 🔧 Configuration à Coller

Une fois le fichier ouvert, **ajoutez** cette section :

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

### ⚠️ Important

- Si le fichier contient déjà d'autres configurations, **ajoutez** juste la section `mcpServers` sans supprimer le reste
- Assurez-vous que le JSON est valide (pas de virgule après le dernier élément)
- Sauvegardez avec `Ctrl + S`
- **Redémarrez Cursor** après avoir sauvegardé

## 📋 Exemple de Fichier Complet

Si votre fichier `settings.json` ressemble à ça :

```json
{
  "editor.fontSize": 14,
  "editor.wordWrap": "on"
}
```

Ajoutez la section `mcpServers` pour obtenir :

```json
{
  "editor.fontSize": 14,
  "editor.wordWrap": "on",
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

## ✅ Vérification

Après avoir ajouté la configuration :

1. ✅ Sauvegardez le fichier (`Ctrl + S`)
2. ✅ Fermez complètement Cursor
3. ✅ Rouvrez Cursor
4. ✅ Testez en demandant à l'IA : "Lis les messages console de Chrome"

## 🆘 Besoin d'Aide ?

Si vous avez des problèmes :

1. Exécutez : `npm run open:mcp-config`
2. Consultez : [GUIDE-CONFIGURATION-MCP-VISUEL.md](./GUIDE-CONFIGURATION-MCP-VISUEL.md)

