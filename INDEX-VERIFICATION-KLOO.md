# 📑 INDEX: Vérification de la synchronisation "kloo" → Google Sheets

## 📌 Problème

Le produit "kloo" avec UUID `96a8387d-b9ff-4bf0-bd9a-e5568e81e190` ne se synchronise pas vers Google Sheets.

**Status:** `synced_at: null` (jamais synchronisé)

---

## 🎯 Fichiers de diagnostic créés

### 1. **[ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md)** ⚡ START HERE
   - **Description:** Plan d'action étape par étape (7 étapes)
   - **Temps:** ~20 minutes
   - **Public:** Non-technique + techniques
   - **À faire:** Suivez les étapes dans l'ordre

### 2. **[GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md)** 📚
   - **Description:** Guide complet avec tous les détails techniques
   - **Contient:**
     - Flux de synchronisation complet (diagramme)
     - Points de défaillance courants
     - Solutions pour chaque problème
     - Commandes SQL et shell
   - **À consulter:** Quand vous avez un problème spécifique

### 3. **[VERIFY-KLOO-SYNC.js](VERIFY-KLOO-SYNC.js)** 🔍
   - **Description:** Script Node.js de diagnostic
   - **À exécuter:** `node VERIFY-KLOO-SYNC.js`
   - **Teste:**
     - ✅ Produit "kloo" existe en DB
     - ✅ UUID généré/trouvé
     - ✅ Unités créées
     - ✅ Opérations OUTBOX
     - ✅ synced_at status
   - **Output:** Rapport détaillé + recommandations

### 4. **[SIMULATE-KLOO-SYNC.js](SIMULATE-KLOO-SYNC.js)** 🔬
   - **Description:** Simulation complète du flux de synchronisation
   - **À exécuter:** `node SIMULATE-KLOO-SYNC.js`
   - **Teste:**
     - Construire le payload Sheets
     - Vérifier GOOGLE_SHEETS_WEBAPP_URL
     - Simuler un POST vers Sheets
     - Afficher la réponse
   - **Simule:** Chaque étape du processus

### 5. **[tools/apps-script/TEST-KLOO-SYNC.gs](tools/apps-script/TEST-KLOO-SYNC.gs)** 📊
   - **Description:** Tests Google Apps Script pour Sheets
   - **À exécuter:** Via Google Sheets → Tools → Apps Script
   - **Fonction:** `testKlooSyncComplete()`
   - **Teste:**
     - ✅ "kloo" existe en Sheets
     - ✅ UUID correspond
     - ✅ doProPush fonctionne
     - ✅ synced_at est mis à jour

### 6. **[tools/apps-script/TEST-SEARCH-LOGIC.gs](tools/apps-script/TEST-SEARCH-LOGIC.gs)** 🔤
   - **Description:** Tests de la logique de recherche de produit
   - **Fonction:** `testProductSearchLogic()`
   - **Teste:**
     - Recherche par UUID (priorité)
     - Recherche par code + mark
     - Auto-génération UUID
     - Normalisation du code
   - **Utilité:** Déboguer pourquoi "kloo" n'est pas trouvé

---

## 🚀 Flux de test rapide

```
1️⃣  Lire ACTION-PLAN-KLOO-SYNC.md (2 min)
    ↓
2️⃣  Exécuter VERIFY-KLOO-SYNC.js (2 min)
    node VERIFY-KLOO-SYNC.js
    ↓
3️⃣  Vérifier Google Sheets manuellement (3 min)
    - Cherchez "kloo" 
    - Vérifiez UUID
    ↓
4️⃣  Exécuter SIMULATE-KLOO-SYNC.js (3 min)
    node SIMULATE-KLOO-SYNC.js
    ↓
5️⃣  Tester depuis Google Sheets (3 min)
    - Exécutez testKlooSyncComplete()
    - Vérifiez Tools → Logs
    ↓
6️⃣  Forcer une synchronisation (5 min)
    - Modifiez "kloo" ou insérez en OUTBOX
    - Attendez 10 secondes
    - Vérifiez synced_at
    ↓
7️⃣  Consulter GUIDE-VERIFICATION-KLOO-SYNC.md si problème
    - Cherchez le symptôme
    - Suivez la solution
```

---

## 📊 Checklist - Ce qui doit fonctionner

Après avoir exécuté tous les tests:

- [ ] `VERIFY-KLOO-SYNC.js` affiche "kloo" trouvé en DB ✅
- [ ] `SIMULATE-KLOO-SYNC.js` se connecte à Sheets (HTTP 200)
- [ ] Google Sheets contient "kloo" dans Carton/Milliers/Pièce
- [ ] UUID en Sheets = `96a8387d-b9ff-4bf0-bd9a-e5568e81e190`
- [ ] `testKlooSyncComplete()` passe sans erreurs ✅
- [ ] Une opération OUTBOX existe après modification
- [ ] Les logs montrent `[PUSH-SYNC]` toutes les 10 secondes
- [ ] Après 10 secondes, l'opération OUTBOX passe à "acked"
- [ ] `synced_at` dans product_units = date/heure actuelle

**Résultat:** ✅ "kloo" est synchronisé vers Sheets!

---

## 🔧 Commandes essentielles

### Vérifier la configuration
```powershell
echo $env:GOOGLE_SHEETS_WEBAPP_URL
echo $env:DATABASE_URL
```

### Lancer les diagnostics
```bash
# Diagnostic Node.js
node VERIFY-KLOO-SYNC.js

# Simulation de synchronisation
node SIMULATE-KLOO-SYNC.js

# Consulter les logs
tail -f logs/sync.log | grep -E "kloo|PRODUCT_PATCH"
```

### Requêtes SQL
```bash
# Vérifier le produit
sqlite3 database.db "SELECT * FROM products WHERE name='kloo';"

# Vérifier les opérations OUTBOX
sqlite3 database.db "SELECT * FROM outbox WHERE entity_code='kloo' ORDER BY created_at DESC;"

# Vérifier synced_at
sqlite3 database.db "SELECT synced_at FROM product_units WHERE product_id=1;"
```

---

## 🚨 Problèmes courants

| Symptôme | Cause probable | Solution |
|----------|---|---|
| "kloo NOT FOUND" en VERIFY-KLOO-SYNC.js | Produit n'existe pas en DB | Créer le produit d'abord |
| synced_at = NULL après SIMULATE | Pas de push vers Sheets | Vérifier GOOGLE_SHEETS_WEBAPP_URL |
| SIMULATE retourne 404 | URL Sheets incorrecte | Re-déployer Apps Script |
| PUSH-SYNC ne s'affiche pas dans logs | Worker ne tourne pas | Redémarrer: npm start |
| "kloo" introuvable en Sheets | Produit non créé en Sheets | Créer manuellement |
| UUID MISMATCH | UUID différent entre DB et Sheets | Corriger UUID en Sheets |

---

## 📖 Ordre de lecture recommandé

1. **[ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md)** (obligatoire)
   - Suivez les 7 étapes
   - Exécutez les scripts mentionnés

2. **[VERIFY-KLOO-SYNC.js](VERIFY-KLOO-SYNC.js)** (étape 2)
   - `node VERIFY-KLOO-SYNC.js`
   - Vérifiez l'output

3. **[SIMULATE-KLOO-SYNC.js](SIMULATE-KLOO-SYNC.js)** (étape 4)
   - `node SIMULATE-KLOO-SYNC.js`
   - Vérifiez la connexion à Sheets

4. **[TEST-KLOO-SYNC.gs](tools/apps-script/TEST-KLOO-SYNC.gs)** (étape 4)
   - Exécutez `testKlooSyncComplete()` dans Google Sheets
   - Vérifiez Tools → Logs

5. **[GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md)** (si problème)
   - Cherchez votre symptôme
   - Suivez la solution

6. **[TEST-SEARCH-LOGIC.gs](tools/apps-script/TEST-SEARCH-LOGIC.gs)** (si toujours bloqué)
   - Testez la logique de recherche
   - Vérifiez normalizeCode()

---

## 🎯 Résumé du flux correct

```
┌──────────────────────────────────────────────┐
│ 1. Produit "kloo" créé/modifié en BD        │
│    synced_at = NULL                         │
└────────────┬─────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│ 2. Opération PRODUCT_PATCH/UNIT_PATCH       │
│    créée en OUTBOX                          │
│    status = 'pending'                       │
└────────────┬─────────────────────────────────┘
             │
             ▼ (toutes les 10s)
┌──────────────────────────────────────────────┐
│ 3. Worker push détecte opérations pending  │
│    POST vers GOOGLE_SHEETS_WEBAPP_URL       │
│    action = 'batchPush'                     │
└────────────┬─────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│ 4. Google Sheets (Code.gs)                  │
│    - Cherche produit par UUID               │
│    - Sinon: cherche par code+mark           │
│    - Auto-génère UUID si absent             │
│    - Met à jour la ligne                    │
│    - Retourne: { success: true }            │
└────────────┬─────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│ 5. BD marquée synced                        │
│    - Opération OUTBOX = 'acked'             │
│    - synced_at = maintenant                 │
│    ✅ SYNCHRONISATION COMPLÈTE              │
└──────────────────────────────────────────────┘
```

---

## ❓ Questions fréquentes

### Q: Pourquoi synced_at est NULL?
**A:** Le produit n'a jamais été envoyé vers Sheets. Suivez le [ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md).

### Q: Où trouver GOOGLE_SHEETS_WEBAPP_URL?
**A:** 
1. Allez à Google Sheets
2. Tools → Apps Script
3. Deploy → New deployment (Web app)
4. Copiez l'URL complète

### Q: Pourquoi "kloo" n'est pas trouvé en Sheets?
**A:** Cherchez dans les 3 onglets (Carton, Milliers, Pièce). Si absent, créez manuellement.

### Q: Combien de temps pour la synchronisation?
**A:** 10 secondes en moyenne (cycle du worker).

### Q: Puis-je forcer la synchronisation?
**A:** Oui, modifiez le produit ou insérez une opération en OUTBOX.

---

## 📞 Support

Si après tous les tests rien ne fonctionne:

1. **Vérifiez les logs:**
   ```bash
   tail -f logs/sync.log
   tail -f logs/error.log
   ```

2. **Vérifiez les permissions:**
   - Google Sheets: êtes-vous propriétaire?
   - Database.db: fichier accessible?

3. **Testez la connexion Internet:**
   ```bash
   ping google.com
   ping script.google.com
   ```

4. **Redémarrez:**
   ```bash
   npm start
   ```

5. **Consultez le [GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md)** pour des solutions détaillées.

---

**🎉 Bonne chance! La synchronisation devrait fonctionner après avoir suivi tous ces tests.**
