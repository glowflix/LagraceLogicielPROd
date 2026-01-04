# 🖨️ DOSSIERS IMPRESSION EN MODE EXE - EXPLICATIONS

## 📍 Question
**"Pour l'impression il dans l'exe il utiliser quelle adresse dossier pour déposer le job?"**

---

## ✅ Réponse Rapide

En mode EXE, les jobs d'impression sont déposés dans:

```
%APPDATA%\LA GRACE POS\printer
```

**Ou plus précisément:**
```
C:\Users\<USERNAME>\AppData\Local\LA GRACE POS\printer
```

---

## 🔍 Détails Techniques

### Fonction `getPrintDir()` (src/core/paths.js)

```javascript
export function getPrintDir() {
  // Priorité 1: Variable d'environnement
  if (process.env.GLOWFLIX_PRINT_DIR) 
    return path.resolve(process.env.GLOWFLIX_PRINT_DIR);
  
  // Priorité 2: Dossier par défaut dans DATA_ROOT
  return path.join(getDataRoot(), "printer");
}
```

### Dossier DATA_ROOT en Mode EXE

```javascript
export function getDataRoot() {
  // Priorité 1: Variable d'environnement
  if (process.env.LAGRACE_DATA_DIR) 
    return path.resolve(process.env.LAGRACE_DATA_DIR);
  
  // Priorité 2: Variable Windows
  if (process.env.GLOWFLIX_ROOT_DIR) 
    return path.resolve(process.env.GLOWFLIX_ROOT_DIR);
  
  // Priorité 3: Dossier AppData (EN MODE EXE)
  const winDefault = "C:\\Glowflixprojet";
  return process.platform === "win32"
    ? winDefault
    : path.join(os.homedir(), "Glowflixprojet");
}
```

---

## 📁 Structure Complète du Dossier Impression

```
%APPDATA%\LA GRACE POS\
├── printer/
│   ├── job-1234567890.json         ← Jobs d'impression (créés)
│   ├── job-1234567891.json
│   ├── job-1234567892.json
│   │
│   ├── ok/                         ← Jobs réussis
│   │   ├── job-1234567890.json
│   │   └── job-1234567891.json
│   │
│   ├── err/                        ← Jobs échoués
│   │   └── job-1234567892.json
│   │
│   ├── tmp/                        ← Fichiers temporaires
│   │   └── ticket-*.pdf
│   │
│   ├── templates/                  ← Templates de tickets
│   │   ├── receipt-80.html
│   │   └── ...
│   │
│   └── assets/                     ← Assets (logos, fonts)
│       ├── logo.png
│       └── ...
│
├── db/
│   └── glowflixprojet.db
│
├── logs/
│   ├── main.log
│   ├── ai-stdout.log
│   └── ai-stderr.log
│
└── config/
    └── ...
```

---

## 🔄 Cycle de Vie d'un Job d'Impression

```
1. Utilisateur clique "Imprimer"
   ↓
2. Système crée job-<timestamp>.json
   Localisation: %APPDATA%\LA GRACE POS\printer\
   ↓
3. Module impression lit le job
   ↓
4. Si SUCCÈS:
   → Déplace dans: printer/ok/
   → Génère ticket.pdf
   → Envoie à l'imprimante
   ↓
5. Si ERREUR:
   → Déplace dans: printer/err/
   → Écrit le log d'erreur
   → Affiche message à l'utilisateur
```

---

## 💾 Format d'un Job d'Impression

**Fichier**: `job-1704326400000.json`

```json
{
  "type": "invoice",
  "invoice_number": "INV-2026-0001",
  "timestamp": "2026-01-04T10:30:00Z",
  "template": "receipt-80",
  "data": {
    "products": [
      {
        "code": "PROD001",
        "name": "Produit 1",
        "quantity": 2,
        "unit_price": 1000,
        "total": 2000
      }
    ],
    "total_fc": 2000,
    "total_usd": 1.50
  },
  "printer_name": "Epson TM-T88",
  "retry_count": 0,
  "max_retries": 3
}
```

---

## 🛠️ Comment Changer le Dossier (Optionnel)

### Option 1: Variable d'Environnement (Priorité haute)

Avant de lancer l'EXE, définissez:

```powershell
$env:GLOWFLIX_PRINT_DIR = "D:\Impression\Jobs"
```

Ou dans le fichier `.env` / `config.env`:

```dotenv
GLOWFLIX_PRINT_DIR=D:\Impression\Jobs
```

### Option 2: Variable Windows (Persistant)

```powershell
[Environment]::SetEnvironmentVariable(
  "GLOWFLIX_PRINT_DIR",
  "D:\Impression\Jobs",
  "User"
)
```

### Option 3: Dossier Par Défaut (Aucune config)

Laissez la valeur par défaut: `%APPDATA%\LA GRACE POS\printer`

---

## 📊 Ordre de Priorité (Lequel est utilisé?)

```
1️⃣ GLOWFLIX_PRINT_DIR (env var)
   ↓ (si non défini)
2️⃣ LAGRACE_DATA_DIR\printer (env var)
   ↓ (si non défini)
3️⃣ GLOWFLIX_ROOT_DIR\printer (env var)
   ↓ (si non défini)
4️⃣ C:\Glowflixprojet\printer (par défaut Windows)
   ↓ (si non Windows)
5️⃣ ~/Glowflixprojet/printer (par défaut Linux/Mac)
```

---

## ✅ Vérifier le Dossier en EXE

### Méthode 1: Diagnostic Automatisé

```powershell
node diagnose-print-module.js
```

Chercher la ligne:
```
[PATHS] PRINT_DIR= ...
```

### Méthode 2: Dans les Logs

```powershell
Get-Content "$env:APPDATA\LA GRACE POS\logs\main.log" | Select-String "PRINT_DIR"
```

Résultat:
```
[PATHS] PRINT_DIR= C:\Users\<user>\AppData\Local\LA GRACE POS\printer
```

### Méthode 3: Vérifier Manuellement

```powershell
# Vérifier que le dossier existe
Test-Path "$env:APPDATA\LA GRACE POS\printer"

# Lister les jobs
Get-ChildItem "$env:APPDATA\LA GRACE POS\printer" -Recurse
```

---

## 🎯 Points Importants

### ✅ Avantages du Dossier AppData
- **Utilisateur**: Chaque utilisateur Windows a son propre dossier
- **Permissions**: L'application peut lire/écrire sans admin
- **Persistant**: Les données restent après redémarrage
- **Sauvegardes**: Facile à sauvegarder (compatible Windows Backup)
- **Portable**: Si l'utilisateur change d'ordinateur, créé automatiquement

### ⚠️ Limitations
- **Caché par défaut**: Le dossier %APPDATA% est caché
  - Pour voir: Appuyez sur `Ctrl+H` dans l'explorateur Windows
- **Nettoyer**: Les jobs vieux ne sont pas automatiquement supprimés
  - À faire manuellement ou via script de maintenance

---

## 📝 Chemins Complets en Contexte

### En Développement (Dev)
```
d:\logiciel\La Grace pro\v1\
├── printer/              ← Dossier source
│   ├── module.js
│   ├── templates/
│   ├── assets/
│   └── ok/, err/, tmp/
```

### En Mode EXE (Production)
```
%APPDATA%\LA GRACE POS\
├── printer/              ← Dossier writable (données runtime)
│   ├── job-*.json
│   ├── ok/, err/, tmp/
│   ├── templates/        ← Copiés depuis resources
│   └── assets/           ← Copiés depuis resources
```

**Note Important**: 
- Templates et assets en **MODE EXE** viennent de `resources/print/` (embargqués dans l'EXE)
- Les **jobs et logs** vont dans le dossier AppData (writable)

---

## 🔐 Sécurité & Nettoyage

### Archiver les Jobs Anciens

```powershell
# Archiver les jobs > 30 jours
$printerDir = "$env:APPDATA\LA GRACE POS\printer"
$cutoffDate = (Get-Date).AddDays(-30)

Get-ChildItem "$printerDir\ok", "$printerDir\err" |
  Where-Object { $_.LastWriteTime -lt $cutoffDate } |
  Move-Item -Destination "$printerDir\archive" -Force
```

### Nettoyer les Fichiers Temporaires

```powershell
# Supprimer les PDF temporaires > 24h
$tmpDir = "$env:APPDATA\LA GRACE POS\printer\tmp"

Get-ChildItem "$tmpDir\*.pdf" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-24) } |
  Remove-Item -Force
```

---

## 📊 Résumé Rapide

| Aspect | Valeur |
|--------|--------|
| **Dossier Jobs** | `%APPDATA%\LA GRACE POS\printer` |
| **Dossier OK** | `%APPDATA%\LA GRACE POS\printer\ok` |
| **Dossier Erreurs** | `%APPDATA%\LA GRACE POS\printer\err` |
| **Format Job** | `job-<timestamp>.json` |
| **Proprietaire** | Utilisateur Windows courant |
| **Permissions** | Lecture/Écriture (utilisateur) |
| **Visible** | Non (Ctrl+H pour voir) |

---

## 🆘 Troubleshooting

### Erreur: "Permission Denied"
```powershell
# Vérifier les permissions
icacls "$env:APPDATA\LA GRACE POS\printer"

# Accorder les permissions
icacls "$env:APPDATA\LA GRACE POS\printer" /grant:r "$env:USERNAME:F" /T
```

### Erreur: "Directory Not Found"
```powershell
# Créer le dossier manuellement
New-Item -Path "$env:APPDATA\LA GRACE POS\printer" -ItemType Directory -Force
```

### Dossier Plein
```powershell
# Voir la taille
(Get-ChildItem "$env:APPDATA\LA GRACE POS\printer" -Recurse | 
  Measure-Object -Property Length -Sum).Sum / 1MB
```

---

**Status**: ✅ **DOCUMENTATION COMPLÈTE**

**Date**: Janvier 4, 2026
