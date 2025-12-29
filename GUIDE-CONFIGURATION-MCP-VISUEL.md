# 📍 Guide Visuel - Où Coller la Configuration MCP dans Cursor

## 🎯 Méthode 1 : Via l'Interface Cursor (Recommandée)

### Étape 1 : Ouvrir les Paramètres MCP

1. **Appuyez sur `Ctrl + Shift + P`** (Windows/Linux) ou `Cmd + Shift + P` (Mac)
2. **Tapez** : `MCP` ou `Model Context Protocol`
3. **Sélectionnez** : `MCP: Configure Servers` ou `MCP: Open Settings`

### Étape 2 : Ajouter le Serveur

Si une interface s'ouvre :
- Cliquez sur **"Add Server"** ou **"New Server"**
- Collez la configuration dans le champ JSON

### Étape 3 : Si vous voyez un fichier JSON s'ouvrir

Collez cette configuration dans le fichier :

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

## 🎯 Méthode 2 : Via le Fichier de Configuration Directement

### Sur Windows

1. **Ouvrez l'Explorateur de fichiers**
2. **Allez dans** : `C:\Users\VotreNomUtilisateur\.cursor\`
   - Remplacez `VotreNomUtilisateur` par votre nom d'utilisateur Windows
   - Exemple : `C:\Users\Jeariss Director\.cursor\`

3. **Cherchez un de ces fichiers** :
   - `mcp.json`
   - `config.json`
   - `settings.json`

4. **Si le fichier existe** :
   - Ouvrez-le avec Cursor ou Notepad
   - Ajoutez ou modifiez la section `mcpServers`

5. **Si le fichier n'existe pas** :
   - Créez un nouveau fichier `mcp.json`
   - Collez la configuration complète

## 🎯 Méthode 3 : Via les Paramètres JSON de Cursor

1. **Appuyez sur `Ctrl + Shift + P`**
2. **Tapez** : `Preferences: Open User Settings (JSON)`
3. **Sélectionnez** cette option
4. **Ajoutez** cette section dans le fichier JSON qui s'ouvre :

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

## 📝 Structure du Fichier

Si le fichier existe déjà avec d'autres configurations, ajoutez juste la section `mcpServers` :

```json
{
  "autre.configuration": "...",
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

1. **Sauvegardez le fichier** (`Ctrl + S`)
2. **Redémarrez Cursor complètement**
3. **Testez** en demandant à l'IA : "Lis les messages console de Chrome"

## 🔍 Où Trouver Votre Nom d'Utilisateur Windows

Pour trouver votre nom d'utilisateur Windows :

1. Ouvrez PowerShell ou CMD
2. Tapez : `echo %USERPROFILE%`
3. Vous verrez quelque chose comme : `C:\Users\VotreNom`

## ⚠️ Important

- Le fichier doit être un **JSON valide**
- Pas de virgule après le dernier élément
- Utilisez des guillemets doubles `"` pas simples `'`
- Sauvegardez avant de fermer

## 🆘 Si Rien Ne Fonctionne

Essayez cette commande dans PowerShell pour trouver le fichier :

```powershell
Get-ChildItem -Path "$env:USERPROFILE\.cursor" -Recurse -Filter "*.json" | Select-Object FullName
```

Cela vous montrera tous les fichiers JSON dans le dossier `.cursor`.

