# ✅ RÉSUMÉ EXÉCUTIF: Synchronisation "kloo" → Google Sheets

## 🎯 Le problème en 1 phrase

Le produit **"kloo"** n'a jamais été synchronisé vers Google Sheets (synced_at = NULL).

---

## 🔍 Diagnostic rapide

Vérifiez ces 3 choses **maintenant**:

### 1️⃣ Le produit "kloo" existe?
```bash
node VERIFY-KLOO-SYNC.js
```
**Attendez:** ✅ TROUVÉ: "kloo"

### 2️⃣ GOOGLE_SHEETS_WEBAPP_URL est configurée?
```powershell
echo $env:GOOGLE_SHEETS_WEBAPP_URL
```
**Attendez:** Une URL longue qui commence par `https://script.google.com/...`

### 3️⃣ "kloo" existe en Google Sheets?
```
Allez à Google Sheets → Cherchez "kloo" dans Carton/Milliers/Pièce
```
**Attendez:** Une ligne avec "kloo" trouvée

---

## 🚀 Correction immédiate (5 min)

### Option A: Si "kloo" n'existe PAS en Sheets

```
1. Ouvrez Google Sheets
2. Cliquez sur l'onglet "Carton"
3. Allez en bas
4. Ajoutez une ligne:
   - Code produit: kloo
   - Nom du produit: kloo
   - Stock initial: 44396
   - Prix d'achat (USD): 9.2
   - Prix ventes (USD): 10
5. Sauvegardez
6. Attendez 10 secondes
```

### Option B: Si GOOGLE_SHEETS_WEBAPP_URL est vide

```powershell
# 1. Allez à Google Sheets
# 2. Tools → Apps Script
# 3. Deploy → New deployment → Web app
# 4. Copiez l'URL (elle ressemble à):
#    https://script.google.com/macros/d/AKfycb.../userweb

# 5. Exécutez:
$env:GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/d/AKfycb.../userweb"

# 6. Redémarrez le serveur:
npm start
```

### Option C: Si tout existe mais ne se synchronise pas

```bash
# 1. Modifiez "kloo" (changez le prix par exemple)
# 2. Attendez 10 secondes
# 3. Vérifiez:
sqlite3 database.db "SELECT synced_at FROM product_units WHERE product_id=1;"

# Si synced_at est TOUJOURS NULL:
tail -f logs/sync.log | grep -E "kloo|PRODUCT_PATCH"
# Cherchez des erreurs
```

---

## 📋 Fichiers d'aide créés

| Fichier | Utilité | Quand l'utiliser |
|---------|---------|---|
| **[ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md)** | Plan 7 étapes détaillé | Vous êtes bloqué |
| **[VERIFY-KLOO-SYNC.js](VERIFY-KLOO-SYNC.js)** | Test Node.js | Diagnostic rapide |
| **[SIMULATE-KLOO-SYNC.js](SIMULATE-KLOO-SYNC.js)** | Simule le push | Tester la connexion Sheets |
| **[GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md)** | Guide complet | Vous avez un problème spécifique |
| **[TECHNICAL-GUIDE-KLOO-SYNC.md](TECHNICAL-GUIDE-KLOO-SYNC.md)** | Expliquer le code | Vous voulez comprendre |
| **[INDEX-VERIFICATION-KLOO.md](INDEX-VERIFICATION-KLOO.md)** | Index de tous les guides | Vous avez besoin de navigation |

---

## ✅ Ce qui doit se passer (étapes)

```
1. Vous modifiez "kloo" en base
        ↓
2. Le système crée une opération OUTBOX
        ↓ (attendre 10 secondes)
3. Le worker pousse vers Sheets
        ↓
4. Sheets reçoit et met à jour la ligne
        ↓
5. La base marque comme "synced"
        ↓
✅ synced_at = date/heure actuelle
```

---

## 🔧 3 commandes essentielles

### Pour déboguer
```bash
node VERIFY-KLOO-SYNC.js
```

### Pour simuler
```bash
node SIMULATE-KLOO-SYNC.js
```

### Pour consulter les logs
```bash
tail -f logs/sync.log | grep kloo
```

---

## ⚠️ Erreurs courantes

| Erreur | Cause | Fix |
|-------|-------|-----|
| "kloo NOT FOUND" | Produit n'existe pas en DB | Créer via l'app |
| GOOGLE_SHEETS_WEBAPP_URL vide | Pas configuré | Voir Option B ci-dessus |
| "kloo" introuvable en Sheets | Produit pas en Sheets | Créer manuellement (Option A) |
| synced_at reste NULL | Push échoue | Vérifier connexion Internet |
| UUID ne correspond pas | Valeurs différentes | Corriger en Sheets |

---

## 🎯 Success indicators

Quand c'est "OK":

✅ `node VERIFY-KLOO-SYNC.js` affiche "✅ TROUVÉ: kloo"  
✅ Google Sheets contient "kloo" dans Carton  
✅ UUID en Sheets = `96a8387d-b9ff-4bf0-bd9a-e5568e81e190`  
✅ `synced_at` n'est pas NULL  
✅ Aucun message d'erreur dans `logs/sync.log`  

---

## 🚨 Si ça ne fonctionne pas après 10 min

1. **Redémarrez tout:**
   ```bash
   # Arrêtez le serveur (Ctrl+C)
   # Attendez 5 secondes
   npm start
   ```

2. **Relisez la section "Correction immédiate"** ci-dessus

3. **Consultez le [GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md)** pour votre symptôme spécifique

4. **Exécutez les tests Google Sheets:**
   - Allez à Google Sheets
   - Tools → Apps Script
   - Exécutez: `testKlooSyncComplete()`
   - Vérifiez Tools → Logs pour les erreurs

---

## 📊 Vue d'ensemble du système

```
┌─────────────────────────────────────────────────┐
│ VOTRE APP                                       │
│ (Crée/modifie le produit "kloo")               │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ BD LOCALE (SQLite)                              │
│ - products                                      │
│ - product_units (contient synced_at)           │
│ - outbox (queue de synchronisation)            │
└────────────────────┬────────────────────────────┘
                     │
                     ▼ (toutes les 10 secondes)
┌─────────────────────────────────────────────────┐
│ WORKER NODE.JS                                  │
│ - Détecte les opérations "pending" en OUTBOX   │
│ - Construit le payload                         │
│ - POST vers Google Sheets (Apps Script)        │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ GOOGLE SHEETS (Apps Script - Code.gs)          │
│ - Reçoit le produit "kloo"                      │
│ - Cherche par UUID                             │
│ - Met à jour la ligne                          │
│ - Retourne { success: true }                   │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ BD LOCALE (Suite)                               │
│ - Marque l'opération OUTBOX comme "acked"      │
│ - Met à jour synced_at = maintenant            │
│ ✅ SYNCHRONISATION COMPLÈTE                    │
└─────────────────────────────────────────────────┘
```

---

## 📞 Prochaines étapes

1. ✅ Exécutez `node VERIFY-KLOO-SYNC.js`
2. ✅ Vérifiez que "kloo" existe en Google Sheets
3. ✅ Vérifiez que GOOGLE_SHEETS_WEBAPP_URL est configurée
4. ✅ Exécutez `node SIMULATE-KLOO-SYNC.js`
5. ✅ Modifiez "kloo" pour créer une opération
6. ✅ Attendez 10 secondes
7. ✅ Vérifiez que `synced_at` est mis à jour

---

## 🎓 Pour en savoir plus

- **Vous voulez comprendre le code?** → Lire [TECHNICAL-GUIDE-KLOO-SYNC.md](TECHNICAL-GUIDE-KLOO-SYNC.md)
- **Vous êtes bloqué?** → Lire [GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md)
- **Vous voulez des étapes détaillées?** → Lire [ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md)

---

**🚀 Bonne chance! La synchronisation devrait marcher après ces étapes.**
