# ✅ CHECKLIST - Structure EXE pour éviter ERR_FILE_NOT_FOUND

Après build EXE, dans le dossier d'installation, vérifier :

## 🎯 Structure requise :

```
Gracepos.exe
resources/
  app.asar/
    src/
      api/
        server.js          ✅ CRITIQUE - code backend ESM
        server-entry.cjs   ✅ CRITIQUE - wrapper CommonJS→ESM
        routes/
        ...
    package.json
    ...
  ui/                      ✅ CRITIQUE - servie au client
    index.html
    assets/
      index-xxxxx.js       ✅ CRITIQUE - le JS du frontend
      index-xxxxx.css      ✅ CRITIQUE - le CSS du frontend
      (autres assets)
  config.env               (optionnel, extraResources)
  print/
    module.js
    templates/
    assets/
```

## 🔴 Erreurs possibles :

### 1️⃣ ERR_FILE_NOT_FOUND `index-*.js`
**Cause** : Le dossier `resources/ui/assets/` n'existe pas ou est incomplet

**Solutions** :
- Vérifier `electron-builder.json` → `extraResources` :
  ```json
  "extraResources": [
    {
      "from": "dist/ui",
      "to": "ui"
    },
    {
      "from": ".",
      "to": ".",
      "filter": ["config.env", ".env"]
    }
  ]
```
- Vérifier que `dist/ui/assets/` existe après build Vite
- Rebuild EXE après Vite build

### 2️⃣ Backend ne démarre pas
**Cause** : `server.js` dans le mauvais dossier

**Solutions** :
- `server.js` doit être dans `app.asar/src/api/`, pas `resources/src/api/`
- Vérifier `asar.unpack` pour les fichiers volumineux

### 3️⃣ Voir les logs en EXE
**Fichier de log** :
```
%APPDATA%\LA GRACE POS\logs\main.log
```

Consulter ce fichier pour diagnostiquer les vrais problèmes !

---

## 🛠️ Commandes diagnostiques Windows

### Vérifier la structure EXE :
```powershell
# Localiser l'EXE
$exe = "C:\Program Files\La Grace Pro\Gracepos.exe"
$appDir = Split-Path $exe

# Lister les dossiers importants
Get-ChildItem "$appDir\resources" -Recurse | Where-Object { $_.Name -match "^(ui|app\.asar|server)" }
```

### Vérifier les assets :
```powershell
Get-ChildItem "C:\Program Files\La Grace Pro\resources\ui\assets" -Filter "index-*"
```

### Lire les logs :
```powershell
$logFile = "$env:APPDATA\LA GRACE POS\logs\main.log"
Get-Content $logFile -Tail 100
```

---

## ✅ Checklist avant livraison

- [ ] `npm run build` OK (vérifier dist/ui existe)
- [ ] `npm run build:exe` OK (pas d'erreur)
- [ ] EXE créé : `dist/installers/Gracepos-X.Y.Z.exe`
- [ ] Lancer EXE, ouvrir DevTools (F12 en dev)
- [ ] Lancer EXE, vérifier `%APPDATA%\LA GRACE POS\logs\main.log` pour erreurs
- [ ] Vérifier que les assets se chargent (Network tab du DevTools)
- [ ] Tester une vente complète (vérifier la DB)
- [ ] Tester l'impression
- [ ] Vérifier les performances

---

## 🚀 Debug rapide en production

Si erreur "ERR_FILE_NOT_FOUND index-*", faire :

1. Ouvrir `%APPDATA%\LA GRACE POS\logs\main.log`
2. Chercher `[STATIC]` et `[CHECK]` pour voir où il cherche les assets
3. Vérifier que `resources/ui/assets/` existe réellement
4. Si manquant, refaire le build :
   ```
   npm run build
   npm run build:exe
   ```
5. Tester l'EXE

---

**Si tout échoue** : C'est soit la structure du build, soit les chemins en prod.
Lire le log principal !
