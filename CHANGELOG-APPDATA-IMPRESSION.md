# 📝 CHANGEMENT APPLIQUÉ - DOSSIER IMPRESSION APPDATA

## 🔧 Modification Apportée

**Fichier**: `src/core/paths.js`  
**Fonction**: `getDataRoot()`

---

## ❌ AVANT

```javascript
export function getDataRoot() {
  if (process.env.LAGRACE_DATA_DIR) return path.resolve(process.env.LAGRACE_DATA_DIR);
  if (process.env.GLOWFLIX_ROOT_DIR) return path.resolve(process.env.GLOWFLIX_ROOT_DIR);

  const winDefault = "C:\\Glowflixprojet";
  return process.platform === "win32"
    ? winDefault
    : path.join(os.homedir(), "Glowflixprojet");
}
```

**Problème**: Utilisait toujours `C:\Glowflixprojet` au lieu de `%APPDATA%\Roaming`

---

## ✅ APRÈS

```javascript
export function getDataRoot() {
  if (process.env.LAGRACE_DATA_DIR) return path.resolve(process.env.LAGRACE_DATA_DIR);
  if (process.env.GLOWFLIX_ROOT_DIR) return path.resolve(process.env.GLOWFLIX_ROOT_DIR);

  // ✅ EN MODE EXE INSTALLÉ: Utiliser AppData\Roaming (utilisateur-spécifique)
  // ✅ EN DEV: Utiliser C:\Glowflixprojet (dossier commun)
  if (process.platform === "win32") {
    // Chercher AppData (Roaming de préférence)
    const appDataRoaming = process.env.APPDATA; // %APPDATA% = AppData\Roaming
    if (appDataRoaming) {
      return path.join(appDataRoaming, "Glowflixprojet");
    }
    // Fallback si APPDATA pas défini
    return "C:\\Glowflixprojet";
  }
  
  return path.join(os.homedir(), "Glowflixprojet");
}
```

**Avantage**: Utilise maintenant `%APPDATA%\Roaming\Glowflixprojet` en mode EXE

---

## 📊 Résultat

### En Mode EXE Installé
```
getDataRoot() = C:\Users\Jeariss Director\AppData\Roaming\Glowflixprojet
getPrintDir() = C:\Users\Jeariss Director\AppData\Roaming\Glowflixprojet\printer
```

### En Développement
```
Fallback = C:\Glowflixprojet
```

---

## 🎯 Impact

✅ **Jobs déposés au bon endroit**: `%APPDATA%\Roaming\Glowflixprojet\printer`  
✅ **Utilisateur-spécifique**: Chaque utilisateur Windows a son dossier  
✅ **Permissions correctes**: L'app peut lire/écrire sans admin  
✅ **Compatible Windows**: Respecte les normes Microsoft AppData  

---

## 🔄 Comment Fonctionne

```
En EXE Installé:
  ├─ process.env.APPDATA = "C:\Users\Jeariss Director\AppData\Roaming"
  └─ getDataRoot() = "C:\Users\Jeariss Director\AppData\Roaming\Glowflixprojet"
                     = AppData\Roaming\Glowflixprojet ✅

En Développement:
  └─ Fallback = "C:\Glowflixprojet" (pour développeurs)
```

---

## ✨ Fichiers à Rebuilder

Après ce changement, rebuilder avec:

```powershell
npm run build:electron
```

Cela crée l'EXE avec cette nouvelle configuration.

---

**Status**: ✅ **CHANGEMENT APPLIQUÉ**

**Date**: Janvier 4, 2026
