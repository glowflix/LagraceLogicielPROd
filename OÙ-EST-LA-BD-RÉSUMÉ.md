# 📍 OÙ EST LA BASE DE DONNÉES? (Résumé rapide)

## ✅ Réponses à vos questions

### 1. **Où est stockée la BD SQL?**

```
C:\Users\<VOTRE_NOM_UTILISATEUR>\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
```

**Exemple:**
```
C:\Users\john\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
```

### 2. **Est-elle embarquée?**

✅ **NON** - Elle est créée dynamiquement dans AppData au premier démarrage

```
Installation:           C:\Program Files\LA GRACE POS\       ← Supprimée à la désinstallation
           ↓
Données utilisateur:    C:\Users\<user>\AppData\Roaming\Glowflixprojet\   ← PERSISTE
                        └── db/glowflixprojet.db
```

### 3. **Pas de npm lors de l'installation?**

✅ **CONFIRMÉ** - Zéro npm lancé

```
Installation:    Copie fichiers uniquement (0 npm)
Démarrage:       Serveur démarre in-process (0 npm)
Utilisation:     App fonctionne offline (0 npm)
```

---

## 🗺️ Comment accéder à la BD

### Méthode 1: File Explorer (facile)
```
1. Appuyez sur: Windows + R
2. Tapez: %APPDATA%
3. Ouvrir: Glowflixprojet\db\
4. Fichier: glowflixprojet.db
```

### Méthode 2: Ligne de commande
```powershell
explorer "$env:APPDATA\Glowflixprojet\db"
```

### Méthode 3: Chemin direct
```
C:\Users\john\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
```

---

## 🛡️ Sauvegarder la BD

```powershell
# Créer une sauvegarde
Copy-Item "$env:APPDATA\Glowflixprojet" `
  -Destination "D:\Backups\Glowflixprojet-$(Get-Date -Format 'yyyy-MM-dd')" `
  -Recurse
```

---

## 🗑️ Supprimer la BD (si nécessaire)

```powershell
# ATTENTION: Cela supprime TOUTES les données!
Remove-Item "$env:APPDATA\Glowflixprojet" -Recurse -Force

# L'app créera une nouvelle BD au prochain démarrage
```

---

## 🚀 Cycle de vie de la BD

```
1. INSTALLATION:
   LA GRACE POS Setup 1.0.0.exe
   → Copie C:\Program Files\LA GRACE POS\
   → 0 npm lancé

2. PREMIER DÉMARRAGE:
   LA GRACE POS.exe
   → Crée C:\Users\<user>\AppData\Roaming\Glowflixprojet\
   → Initialise BD: glowflixprojet.db

3. UTILISATION:
   BD stockée en AppData
   → Persiste même après fermeture app

4. DÉSINSTALLATION:
   Remove Programs → Uninstall
   → Supprime C:\Program Files\LA GRACE POS\
   → C:\Users\<user>\AppData\Roaming\Glowflixprojet\ PERSISTE ✅

5. RÉINSTALLATION:
   LA GRACE POS Setup (nouvelle version)
   → Se connecte à la MÊME BD en AppData
   → Données intactes ✅
```

---

## 📊 Résumé

| Question | Réponse |
|----------|---------|
| **Où?** | `%APPDATA%\Glowflixprojet\db\glowflixprojet.db` |
| **Embarquée?** | ❌ Non - créée dynamiquement |
| **Persiste après désinstallation?** | ✅ Oui |
| **npm en production?** | ❌ 0 npm |
| **Accessible sans app?** | ✅ Oui (c'est un fichier SQLite normal) |

---

## 📁 Structure complète

```
C:\Users\john\AppData\Roaming\Glowflixprojet\
│
├── db/
│   ├── glowflixprojet.db              ← BD SQLite (IMPORTANTE)
│   ├── glowflixprojet.db-shm          ← Fichier temp
│   └── glowflixprojet.db-wal          ← Log temporaire
│
├── data/
│   ├── cache/
│   ├── imports/
│   ├── exports/
│   ├── backups/
│   └── attachments/
│
├── logs/                              ← Fichiers log
├── config/                            ← Configuration
└── printer/                           ← Templates d'impression
```

---

## ✅ Vérification après installation

```powershell
# Vérifier que la BD a été créée
$dbPath = "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db"
if (Test-Path $dbPath) {
  Write-Host "BD créée avec succès!"
  Get-Item $dbPath | Format-Table Name, Length, LastWriteTime
}
```

---

## 🆘 Dépannage rapide

**Q: La BD n'est pas créée?**
```
1. Vérifier que l'app a démarré (http://localhost:3030)
2. Vérifier les permissions AppData
3. Redémarrer l'app
```

**Q: Où sont les logs?**
```
%APPDATA%\Glowflixprojet\logs\
```

**Q: Comment restaurer une sauvegarde?**
```powershell
Remove-Item "$env:APPDATA\Glowflixprojet" -Recurse -Force
Copy-Item "D:\Backups\Glowflixprojet-2024-01-01" `
  -Destination "$env:APPDATA\Glowflixprojet" `
  -Recurse
# Redémarrer l'app
```

---

## 📚 Documentation complète

Pour plus de détails, voir:
- [DATABASE-DOCS-INDEX.md](DATABASE-DOCS-INDEX.md) - Index de tous les docs
- [WHERE-IS-DATABASE.md](WHERE-IS-DATABASE.md) - Guide détaillé (English)
- [DATABASE-LOCATION-PRODUCTION.md](DATABASE-LOCATION-PRODUCTION.md) - Technique approfondie
- [POST-INSTALLATION-CHECKLIST.md](POST-INSTALLATION-CHECKLIST.md) - Checklist de vérification

---

**Status:** ✅ Production Ready
**Vérification:** RÉUSSIE
**npm en production:** 0 appels
**BD persistente:** ✅ Garantie
