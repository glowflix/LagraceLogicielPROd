# 🎯 QUICK START: Synchronisation "kloo" → Google Sheets

## ⚡ 5 minutes pour comprendre le problème

### Le problème
```
Produit: "kloo"
UUID: 96a8387d-b9ff-4bf0-bd9a-e5568e81e190
Payload reçu: OK ✅
Synchronisé vers Sheets: ❌ NO (synced_at = NULL)
```

### Raison = Une de ces 3 choses
1. ❌ GOOGLE_SHEETS_WEBAPP_URL pas configurée
2. ❌ "kloo" n'existe pas en Google Sheets
3. ❌ Le worker de synchronisation ne tourne pas

### Solution (2 min max)

**Test 1:** Vérifier la BD
```bash
node VERIFY-KLOO-SYNC.js
```
Si OK → passer au Test 2  
Si KO → créer le produit d'abord

**Test 2:** Vérifier GOOGLE_SHEETS_WEBAPP_URL
```powershell
echo $env:GOOGLE_SHEETS_WEBAPP_URL
```
Si vide → configuration manquante (voir ci-dessous)  
Si remplie → passer au Test 3

**Test 3:** Vérifier "kloo" en Google Sheets
```
1. Allez à Google Sheets
2. Cherchez "kloo" dans Carton/Milliers/Pièce
3. S'il existe → passer au Test 4
4. S'il n'existe pas → le créer manuellement
```

**Test 4:** Tester la synchronisation
```bash
node SIMULATE-KLOO-SYNC.js
```
Si HTTP 200 + success: true → OK ✅  
Si erreur → lire [ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md)

---

## 🔧 Si GOOGLE_SHEETS_WEBAPP_URL est manquante

```powershell
# 1. Allez à Google Sheets
# 2. Tools → Apps Script
# 3. Deploy → New deployment
# 4. Type: Web app
# 5. Copiez l'URL générée
# 6. Exécutez:

$env:GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/d/YOUR_ID/userweb"

# 7. Redémarrez
npm start
```

---

## 🎯 Si tout fonctionne

### Vérifier que synced_at est mis à jour
```bash
# 1. Modifiez "kloo" (changez le prix)
# 2. Attendez 10 secondes
# 3. Vérifiez:
sqlite3 database.db "SELECT synced_at FROM product_units WHERE product_id=1;"
```

Attendez à voir: `2026-01-01 12:34:56` (date/heure)  
Si NULL → voir les logs avec:
```bash
tail -f logs/sync.log | grep -E "kloo|PRODUCT_PATCH"
```

---

## 📚 Guides complets

| Guide | Temps | Quand |
|-------|-------|-------|
| [RESUME-KLOO-SYNC.md](RESUME-KLOO-SYNC.md) | 5 min | Vous êtes perdu |
| [ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md) | 20 min | Vous avez un problème |
| [GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md) | Ref | Vous cherchez une solution |
| [TECHNICAL-GUIDE-KLOO-SYNC.md](TECHNICAL-GUIDE-KLOO-SYNC.md) | 30 min | Vous voulez comprendre |

---

## ✅ Success = Vous voyez

```
✅ node VERIFY-KLOO-SYNC.js: "✅ TROUVÉ: kloo"
✅ Google Sheets: "kloo" existe en Carton
✅ GOOGLE_SHEETS_WEBAPP_URL: URL configurée
✅ node SIMULATE-KLOO-SYNC.js: HTTP 200
✅ synced_at: Date/heure (pas NULL)
✅ Logs: "✅ Batch acked" pour kloo
```

---

## 🚀 Prochaine étape

Lisez: **[RESUME-KLOO-SYNC.md](RESUME-KLOO-SYNC.md)**

(ou exécutez `node VERIFY-KLOO-SYNC.js` directement)

---

**Durée totale: 5-10 minutes pour que tout fonctionne! 🎉**
