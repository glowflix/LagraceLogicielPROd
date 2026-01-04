# 📍 DOSSIER IMPRESSION EXE - RÉPONSE RAPIDE

## 🎯 Votre Question
**"Pour l'impression il dans l'exe il utiliser quelle adresse dossier pour déposer le job?"**

---

## ✅ Réponse

### Dossier Principal
```
%APPDATA%\LA GRACE POS\printer
```

**Chemin Complet Windows**:
```
C:\Users\<USERNAME>\AppData\Local\LA GRACE POS\printer
```

**Exemple Réel**:
```
C:\Users\Jean\AppData\Local\LA GRACE POS\printer
```

---

## 📁 Sous-Dossiers

```
%APPDATA%\LA GRACE POS\printer\
├── job-1704326400000.json     ← Jobs d'impression (créés)
├── job-1704326500000.json
├── job-1704326600000.json
│
├── ok/                         ← Jobs RÉUSSIS
│   ├── job-1704326400000.json
│   └── job-1704326500000.json
│
├── err/                        ← Jobs ÉCHOUÉS
│   └── job-1704326600000.json
│
├── tmp/                        ← Fichiers TEMPORAIRES
│   ├── ticket-001.pdf
│   └── ticket-002.pdf
│
├── templates/                  ← Templates (lus depuis EXE)
│   └── receipt-80.html
│
└── assets/                     ← Assets (logos, etc.)
    └── logo.png
```

---

## 🔄 Cycle de Vie

```
User clique "Imprimer"
           ↓
Création: job-<timestamp>.json
           ↓
Localisation: %APPDATA%\LA GRACE POS\printer\
           ↓
Succès? →  Déplace dans: printer/ok/
Échec?  →  Déplace dans: printer/err/
```

---

## 🛠️ Comment le Changer (Optionnel)

### Méthode: Variable d'Environnement

Avant de lancer l'EXE:
```powershell
$env:GLOWFLIX_PRINT_DIR = "D:\Mes Dossiers\Impression"
```

Ou dans `config.env`:
```
GLOWFLIX_PRINT_DIR=D:\Mes Dossiers\Impression
```

---

## ✅ Vérifier le Dossier

### Commande Diagnostic
```powershell
node diagnose-print-module.js
```

Chercher:
```
[PATHS] PRINT_DIR= ...
```

### Ou Voir les Logs
```powershell
Get-Content "$env:APPDATA\LA GRACE POS\logs\main.log" | Select-String "PRINT_DIR"
```

---

## 📊 Dossiers Relatifs

| Dossier | Localisation |
|---------|--------------|
| **Jobs** | `%APPDATA%\LA GRACE POS\printer\` |
| **OK** | `%APPDATA%\LA GRACE POS\printer\ok\` |
| **Erreurs** | `%APPDATA%\LA GRACE POS\printer\err\` |
| **Temp** | `%APPDATA%\LA GRACE POS\printer\tmp\` |
| **Logs** | `%APPDATA%\LA GRACE POS\logs\` |
| **DB** | `%APPDATA%\LA GRACE POS\db\` |

---

## 🎯 Points Clés

✅ **Chaque utilisateur** a son propre dossier (dans son APPDATA)  
✅ **Caché par défaut** (Ctrl+H pour voir dans l'explorateur)  
✅ **Writable** (l'app peut lire/écrire sans admin)  
✅ **Persistant** (reste après redémarrage)  
✅ **Personnalisable** (via GLOWFLIX_PRINT_DIR)  

---

## 📚 Pour Plus de Détails

Voir: [`DOSSIER-IMPRESSION-EXE.md`](DOSSIER-IMPRESSION-EXE.md)

---

**Status**: ✅ **EXPLIQUÉ**

**Date**: Janvier 4, 2026
