# 📦 Configuration electron-builder pour Installation Pro

## Ajouter à `package.json`

```json
{
  "build": {
    "appId": "com.glowflixprojet.lagrace",
    "productName": "Glowflixprojet",
    "directories": {
      "buildResources": "public/asset/image/icon",
      "output": "dist/installers"
    },
    "files": [
      "dist/**/*",
      "electron/**/*.cjs",
      "src/**/*.js",
      "print/**/*",
      "public/**/*",
      "package.json",
      "node_modules/**/*"
    ],
    "extraMetadata": {
      "main": "electron/main.cjs"
    },
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": [
            "x64"
          ]
        },
        {
          "target": "portable",
          "arch": [
            "x64"
          ]
        }
      ],
      "certificateFile": null,
      "signingHashAlgorithms": [
        "sha256"
      ],
      "icon": "public/asset/image/icon/photo.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": false,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Glowflixprojet",
      "installerIcon": "public/asset/image/icon/photo.ico",
      "uninstallerIcon": "public/asset/image/icon/photo.ico",
      "installerHeaderIcon": "public/asset/image/icon/photo.ico",
      "include": "build/installer.nsh"
    },
    "portable": {
      "artifactName": "${productName}-${version}-portable.exe"
    }
  }
}
```

## Créer `build/installer.nsh` (Script NSIS)

```nsi
; Custom NSIS installer script
; Crée C:\Glowflixprojet\ avec droits d'écriture

!include "MUI2.nsh"

; Variables personnalisées
!define APPDATA_PATH "$APPDATA\Glowflixprojet"
!define GLOWFLIX_PATH "C:\Glowflixprojet"

Section "Create Glowflixprojet Data Directory"
  ; Créer C:\Glowflixprojet\ avec sous-dossiers
  CreateDirectory "${GLOWFLIX_PATH}"
  CreateDirectory "${GLOWFLIX_PATH}\db"
  CreateDirectory "${GLOWFLIX_PATH}\db\backups"
  CreateDirectory "${GLOWFLIX_PATH}\db\migrations"
  CreateDirectory "${GLOWFLIX_PATH}\cache"
  CreateDirectory "${GLOWFLIX_PATH}\cache\http"
  CreateDirectory "${GLOWFLIX_PATH}\cache\images"
  CreateDirectory "${GLOWFLIX_PATH}\cache\ai"
  CreateDirectory "${GLOWFLIX_PATH}\logs"
  CreateDirectory "${GLOWFLIX_PATH}\printer"
  CreateDirectory "${GLOWFLIX_PATH}\printer\assets"
  CreateDirectory "${GLOWFLIX_PATH}\printer\templates"
  CreateDirectory "${GLOWFLIX_PATH}\printer\tmp"
  CreateDirectory "${GLOWFLIX_PATH}\printer\ok"
  CreateDirectory "${GLOWFLIX_PATH}\printer\err"

  ; (Optionnel) Donner les droits au groupe Users
  ; AccessControl::GrantOnFile "${GLOWFLIX_PATH}" "(S-1-5-32-545)" "FullAccess"
SectionEnd
```

## Scripts NPM

Ajouter à `package.json`:

```json
{
  "scripts": {
    "build:exe": "npm run build:ui && electron-builder",
    "build:exe:dev": "npm run build:ui && electron-builder --publish=never --win --x64",
    "build:portable": "npm run build:ui && electron-builder --targets portable",
    "dist:check": "electron-builder --dir"
  }
}
```

## Checklist Build

```bash
# 1. Compiler la UI
npm run build:ui

# 2. Vérifier la config
npm run dist:check

# 3. Créer l'installeur
npm run build:exe

# 4. Résultat dans dist/installers/
```

## Ce que fait l'installeur

✅ Installe l'app dans `C:\Users\<User>\AppData\Local\Programs\Glowflixprojet\`
✅ Crée les dossiers `C:\Glowflixprojet\` avec sous-dossiers
✅ Ajoute un raccourci au menu Démarrer
✅ Ajoute un raccourci sur le Bureau
✅ Permet la désinstallation propre

## Mode Production vs Dev

### Dev (`npm run dev`)
- Accès direct à `C:\Glowflixprojet\`
- Templates modifiables en temps réel
- Logs détaillés
- Pas besoin de build

### Production (`.exe`)
- Installation complète
- Création auto des dossiers
- Vérification des droits
- Bundle complet (Node, app, etc.)

## ⚙️ Configuration Avancée

### Variables d'environnement pour installer ailleurs

Dans `electron/main.cjs`:
```javascript
// Avant: DATA_ROOT_WIN = "C:\Glowflixprojet"

// Après: lire depuis env (installer peut passer via registry)
const DATA_ROOT_WIN = process.env.GLOWFLIX_DATA_PATH || "C:\\Glowflixprojet";
```

### Signer l'exécutable (optionnel, pour les certificats)

```json
{
  "win": {
    "certificateFile": "./cert.pfx",
    "certificatePassword": "${CERT_PASSWORD}",
    "signingHashAlgorithms": ["sha256"]
  }
}
```

## Troubleshooting

**Problème**: Erreur "C:\ accès refusé" au démarrage
- **Solution**: L'app va fallback vers `%LOCALAPPDATA%\Glowflixprojet` (voir paths.js)

**Problème**: Installer freeze
- **Solution**: Vérifier antivirus bloque `build/`

**Problème**: App ne trouve pas les ressources après install
- **Solution**: Vérifier `files` dans la config electron-builder

---

✓ Configuration prête pour la production
✓ Installation simple (next, next, finish)
✓ Données persistantes en C:\
✓ Logs, templates, etc. modifiables par l'utilisateur
