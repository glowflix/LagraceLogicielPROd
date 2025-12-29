# 🎯 Guide Simple : Où Coller la Configuration MCP dans Cursor

## ⚡ RÉSUMÉ EN 3 ÉTAPES (Méthode la Plus Rapide)

1. **Exécutez cette commande** dans le dossier du projet :
   ```bash
   npm run setup:mcp-config
   ```

2. **Répondez "O"** si le script vous demande d'ouvrir le fichier

3. **Redémarrez Cursor** complètement (fermez toutes les fenêtres)

**C'est tout !** ✅

---

## 🎯 RÉPONSE RAPIDE : Où Coller ?

**Vous devez coller la configuration dans ce fichier :**

```
C:\Users\Jeariss Director\.cursor\mcp.json
```

**Ce fichier est dans votre dossier utilisateur Windows, PAS dans le projet !**

---

## 📝 Explication Simple

1. **Fichier source** (dans votre projet) : `.cursor-mcp-config.json` ← Vous copiez depuis ici
2. **Fichier destination** (dans Windows) : `C:\Users\Jeariss Director\.cursor\mcp.json` ← Vous collez ici

**C'est comme copier un fichier de votre projet vers un autre endroit sur votre ordinateur.**

### 🖼️ Visualisation du Chemin

```
Votre Projet (D:\logiciel\La Grace pro\v1\)
│
├── .cursor-mcp-config.json  ← COPIER LE CONTENU D'ICI
│
└── ...

Votre Ordinateur (C:\Users\Jeariss Director\)
│
└── .cursor\                 ← CRÉER CE DOSSIER SI N'EXISTE PAS
    │
    └── mcp.json            ← COLLER LE CONTENU ICI
```

**Important :** Le fichier `mcp.json` doit être dans votre dossier utilisateur Windows, pas dans le projet !

---

## ⚡ MÉTHODE LA PLUS SIMPLE : Script Automatique

### Option 1 : Via npm (Recommandé)

**Depuis le dossier du projet, exécutez :**

```bash
npm run setup:mcp-config
```

### Option 2 : Via PowerShell directement

**Depuis le dossier du projet, exécutez :**

```powershell
powershell -ExecutionPolicy Bypass -File copier-config-mcp.ps1
```

**OU si vous êtes déjà dans PowerShell :**

```powershell
.\copier-config-mcp.ps1
```

Ce script va :
- ✅ Copier automatiquement la configuration au bon endroit
- ✅ Créer le dossier `.cursor` s'il n'existe pas
- ✅ Ouvrir le fichier pour vérification si vous le souhaitez

**Ensuite, redémarrez Cursor et c'est tout !**

---

## ✅ Méthode Alternative 1 : Via la Palette de Commandes Cursor

### Étape 1 : Ouvrir les Paramètres MCP dans Cursor
1. Dans Cursor, appuyez sur **`Ctrl + Shift + P`** (palette de commandes)
2. Tapez : **`MCP`** ou **`mcp`**
3. Sélectionnez : **`MCP: Open MCP Settings`** ou **`View: Ouvrir les paramètres MCP`**

### Étape 2 : Ajouter le Serveur MCP
1. Le fichier `mcp.json` s'ouvre automatiquement dans l'éditeur
2. **Copiez** le contenu du fichier `.cursor-mcp-config.json` de votre projet
3. **Collez-le** dans le fichier `mcp.json` qui vient de s'ouvrir
4. **Enregistrez** le fichier (`Ctrl + S`)
5. **Redémarrez Cursor** pour que la configuration soit prise en compte

**💡 Astuce :** Si le fichier est vide ou contient déjà du contenu, remplacez tout le contenu par celui du fichier `.cursor-mcp-config.json`

---

## ✅ Méthode Alternative 2 : Éditer le Fichier Manuellement

### 📍 Étape 1 : Trouver le Fichier de Configuration

Le fichier de configuration MCP se trouve à cet emplacement sur Windows :

```
C:\Users\VotreNomUtilisateur\.cursor\mcp.json
```

**Pour votre cas spécifique :**
```
C:\Users\Jeariss Director\.cursor\mcp.json
```

**🔍 Comment trouver ce fichier rapidement :**

1. Appuyez sur **`Windows + R`**
2. Tapez exactement : `%USERPROFILE%\.cursor\mcp.json`
3. Appuyez sur **Entrée**
4. Si le fichier n'existe pas, Windows vous demandera de le créer → Cliquez sur **Oui**

### 📂 Étape 2 : Ouvrir le Fichier

**Option A : Via PowerShell (Recommandé)**
1. Ouvrez PowerShell (n'importe où)
2. Exécutez cette commande :
```powershell
notepad "$env:USERPROFILE\.cursor\mcp.json"
```

**Option B : Via l'Explorateur Windows**
1. Appuyez sur **`Windows + R`**
2. Tapez : `%USERPROFILE%\.cursor`
3. Appuyez sur **Entrée**
4. **Important :** Activez l'affichage des fichiers cachés si nécessaire :
   - Onglet **Affichage** → Cochez **"Éléments masqués"**
5. Si le fichier `mcp.json` existe, double-cliquez dessus
6. Si le fichier n'existe pas, créez un nouveau fichier texte nommé `mcp.json`

**Option C : Via Cursor directement**
1. Dans Cursor, appuyez sur **`Ctrl + O`** (ouvrir un fichier)
2. Collez ce chemin : `%USERPROFILE%\.cursor\mcp.json`
3. Appuyez sur **Entrée**

### 📋 Étape 3 : Coller la Configuration

1. **Ouvrez** le fichier `.cursor-mcp-config.json` de votre projet dans Cursor
2. **Sélectionnez tout** le contenu (`Ctrl + A`)
3. **Copiez** (`Ctrl + C`)
4. **Allez** dans le fichier `mcp.json` que vous avez ouvert
5. **Collez** (`Ctrl + V`) - remplacez tout le contenu existant si nécessaire
6. **Enregistrez** le fichier (`Ctrl + S`)
7. **Redémarrez Cursor** complètement (fermez toutes les fenêtres)

---

## 📋 Contenu à Coller

Voici exactement ce que vous devez coller dans le fichier `mcp.json` :

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

---

## ✅ Vérification

Après avoir collé la configuration et redémarré Cursor :

1. Ouvrez les paramètres Cursor (`Ctrl + ,`)
2. Recherchez "MCP"
3. Vous devriez voir "chrome-devtools" dans la liste des serveurs MCP
4. Le statut devrait être "Connected" ou "Disconnected" (c'est normal si Chrome n'est pas ouvert)

---

## 🆘 Dépannage

### Le fichier mcp.json n'existe pas
- C'est normal ! Créez-le vous-même dans le dossier `.cursor`
- Le dossier `.cursor` se trouve dans votre dossier utilisateur : `C:\Users\VotreNomUtilisateur\.cursor`

### Je ne trouve pas le dossier .cursor
- C'est un dossier caché
- Dans l'Explorateur Windows, activez l'affichage des fichiers cachés :
  - Onglet **Affichage** → Cochez **"Éléments masqués"**

### La configuration ne fonctionne pas
- Vérifiez que le JSON est valide (pas de virgule en trop à la fin)
- Redémarrez Cursor complètement (fermez toutes les fenêtres)
- Vérifiez que Node.js est installé : `node --version` dans PowerShell

---

## 📝 Note Importante

Le fichier `.cursor-mcp-config.json` dans votre projet est juste un **modèle de référence**. 
Vous devez copier son contenu dans le fichier de configuration réel de Cursor qui se trouve dans votre dossier utilisateur.

