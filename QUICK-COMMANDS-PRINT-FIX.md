# 🚀 COMMANDES RAPIDES - FIX IMPRESSION

Copier-coller ces commandes dans PowerShell pour appliquer et tester le fix.

---

## 📌 ÉTAPE 1: Diagnostic (optionnel mais recommandé)

```powershell
# Vérifier que tout est correct AVANT de builder
node diagnose-print-module.js
```

Résultat attendu: Tous les chemins `✅`

---

## 📌 ÉTAPE 2: Nettoyer et Rebuilder

```powershell
# 1. Nettoyer les anciens builds
Remove-Item dist, dist-electron -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "✅ Nettoyage fait"

# 2. Installer les dépendances (CRUCIAL!)
npm install

# 3. Builder l'UI
npm run build:ui

# 4. Builder l'IA (optionnel, ~2-3 min)
npm run build:ai

# 5. Builder Electron (crée l'EXE)
npm run build:electron

Write-Host "`n✅ Build complet!" -ForegroundColor Green
```

**Durée estimée**: 5-10 minutes  
**Résultat**: `dist-electron/` créé avec l'EXE

---

## 📌 ÉTAPE 3: Tester Automatiquement

```powershell
# Lancer le script de test complet
.\TEST-PRINT-FIX.ps1
```

**Faire**:
1. Laisser l'app démarrer (5-10s)
2. Ouvrir http://localhost:3030
3. Créer une vente
4. Aller à "Historique des ventes"
5. Cliquer 🖨️ pour imprimer
6. Vérifier le message de succès

**Résultat attendu**: "Ticket envoyé à l'impression" ✅

---

## 📌 ÉTAPE 4: Installer l'EXE (optionnel)

```powershell
# Lancer l'installateur
Start-Process ".\dist-electron\LA GRACE POS Setup*.exe"

# Suivre l'installation (next, next, finish)
# Puis relancer depuis le menu Démarrer
```

---

## 🆘 Si Erreur

### Erreur: "Cannot find module 'pdf-to-printer'"

```powershell
# Solution: npm install manquait ou a échoué
npm install
npm run build:electron
```

### Erreur: "print/module.js introuvable"

```powershell
# Vérifier que le dossier print existe
Test-Path .\print\module.js

# Si pas trouvé, le dossier manque!
# Vérifier: VALIDATION-PRINT-FIX.md phase 1.2
```

### Diagnostic complet

```powershell
# Si vous êtes bloqué
node diagnose-print-module.js

# Vérifier les logs
Get-Content "$env:APPDATA\LA GRACE POS\logs\main.log" -Tail 50
```

---

## 📊 Résumé des Commandes

| Étape | Commande | Temps |
|-------|----------|-------|
| Diagnostic | `node diagnose-print-module.js` | 5s |
| Nettoyer | `Remove-Item dist, dist-electron -Recurse -Force` | 10s |
| npm install | `npm install` | 2-3 min |
| Build UI | `npm run build:ui` | 1-2 min |
| Build IA | `npm run build:ai` | 2-3 min (optionnel) |
| Build Electron | `npm run build:electron` | 2-3 min |
| Test | `.\TEST-PRINT-FIX.ps1` | 3-5 min |

**Total**: ~10-15 minutes (avec tout)  
**Minimal**: ~5 minutes (sans IA)

---

## ✅ Validation Finale

Après le test, vous devez voir:

```
✅ Fichier EXE créé: dist-electron\win-unpacked\LA GRACE POS.exe
✅ Print module chargé: "[PRINT] Printer module chargé avec succès"
✅ Impression OK: Message "Ticket envoyé à l'impression"
```

Si tout est ✅, le fix est validé!

---

## 💡 Points de Rappel

- ⚠️ **npm install DOIT réussir** sinon node_modules sera vide
- 📦 L'EXE sera **plus gros** (~150-200 MB, c'est normal)
- ⏱️ Premier démarrage **10-15s** (charge node_modules)
- 📝 Voir les logs pour **les problèmes**: `%APPDATA%/LA GRACE POS/logs/main.log`

---

## 📚 Documentation

Si vous avez besoin d'aide:
- **Résumé rapide**: `PRINT-FIX-QUICK-SUMMARY.md`
- **Techniquement**: `FIX-PRINT-EXE-BUILD.md`
- **Validation**: `VALIDATION-PRINT-FIX.md`
- **Index**: `00-FIX-IMPRESSION-INDEX.md`

---

**Ready?** Copier-coller la **ÉTAPE 2** maintenant! 🚀
