# ⚡ PLAN D'ACTION: Vérifier synchronisation "kloo" → Google Sheets

## 📌 Résumé du problème

Le produit **"kloo"** avec UUID `96a8387d-b9ff-4bf0-bd9a-e5568e81e190` n'est pas synchronisé vers Google Sheets.

**Payload reçu:**
```json
{
  "name": "kloo",
  "units": [
    {
      "id": 1,
      "product_id": 1,
      "unit_level": "CARTON",
      "unit_mark": "",
      "stock_initial": 44396,
      "stock_current": 44396,
      "purchase_price_usd": 9.2,
      "sale_price_usd": 10,
      "auto_stock_factor": 1,
      "uuid": "96a8387d-b9ff-4bf0-bd9a-e5568e81e190",
      "synced_at": null
    }
  ]
}
```

⚠️ `synced_at: null` → **jamais synchronisé vers Sheets**

## 🎯 Étapes d'action (dans l'ordre)

### ✅ ÉTAPE 1: Vérifier l'environnement (2 min)

```powershell
# Ouvrez PowerShell et vérifiez:
echo $env:GOOGLE_SHEETS_WEBAPP_URL
echo $env:DATABASE_URL
echo $env:NODE_ENV
```

**Attendez-vous à voir:**
- ✅ `GOOGLE_SHEETS_WEBAPP_URL` = `https://script.google.com/macros/d/...`
- ✅ `DATABASE_URL` = `sqlite:///path/to/database.db` ou similaire
- ✅ `NODE_ENV` = `production` ou `development`

**Si manquant:**
```powershell
$env:GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/d/YOUR_DEPLOYMENT_ID/userweb"
```

---

### ✅ ÉTAPE 2: Vérifier la DB locale (2 min)

```bash
# Terminal Node.js
node VERIFY-KLOO-SYNC.js
```

**Attendez-vous à voir:**
```
✅ TROUVÉ: "kloo"
   product_id: 1
   code: ...
   name: kloo
   uuid: 96a8387d-b9ff-4bf0-bd9a-e5568e81e190
   units count: 1
   
✅ 1 unité(s) trouvée(s):
   📦 CARTON/(vide)
      uuid: 96a8387d-b9ff-4bf0-bd9a-e5568e81e190
      stock_current: 44396
      sale_price_usd: 10
      synced_at: ❌ JAMAIS
```

**Si erreurs:**
- ❌ `"kloo" NOT FOUND` → Créer le produit d'abord
- ❌ `uuid: (vide)` → Généré automatiquement (pas grave)

---

### ✅ ÉTAPE 3: Vérifier Google Sheets (3 min)

1. **Allez à Google Sheets**
2. **Ouvrez le document** utilisé par le système (trouvez l'URL dans `GOOGLE_SHEETS_WEBAPP_URL`)
3. **Cherchez "kloo"** dans les onglets:
   - Carton
   - Milliers
   - Pièce
4. **Vérifiez les colonnes:**
   - `Code produit` = `kloo`
   - `_uuid` = `96a8387d-b9ff-4bf0-bd9a-e5568e81e190` (ou vide si auto-généré)
   - `_updated_at` = date ISO ou vide

**Si "kloo" existe:**
```
✅ Colonne _uuid est remplie → UUID correspond
   ou
❌ Colonne _uuid est vide → Sera auto-générée par handleProductUpsert
```

**Si "kloo" n'existe pas:** Créer manuellement
```
1. Cliquez sur l'onglet "Carton"
2. Allez en bas de la feuille
3. Nouvelle ligne:
   - Code produit: kloo
   - Nom du produit: kloo
   - Stock initial: 44396
   - Prix d'achat (USD): 9.2
   - Prix ventes (USD): 10
   - Mark: (vide)
4. Sauvegardez
```

---

### ✅ ÉTAPE 4: Tester le Push depuis Google Sheets (3 min)

1. **Allez à Google Sheets**
2. **Tools → Apps Script**
3. **Dans l'éditeur, cherchez:** `testKlooSyncComplete` ou `testDoProPushKilo`
4. **Exécutez la fonction:** Cliquez sur ▶️ (play button)
5. **Vérifiez les logs:** Tools → Logs

**Attendez-vous à voir:**
```
STEP 1️⃣: Chercher "kloo" en Sheets...
   ✅ TROUVÉ en "Carton"
      Code: kloo
      UUID: 96a8387d-b9ff-4bf0-bd9a-e5568e81e190
      
STEP 3️⃣: Tester doProPush...
   ✅ doProPush SUCCESS!
      Applied: 1
      Propagated: 1
```

**Si erreurs:**
```
❌ "kloo" NOT FOUND → Créer manuellement en Sheets
❌ UUID MISMATCH → Vérifier UUID en Sheets
❌ doProPush ERROR → Problème avec Apps Script
```

---

### ✅ ÉTAPE 5: Forcer une synchronisation (3 min)

**Option A: Modifier le produit dans l'app**
```
1. Ouvrez l'app
2. Trouvez le produit "kloo"
3. Modifiez un champ (ex: prix)
4. Sauvegardez
→ Cela crée une opération PRODUCT_PATCH/UNIT_PATCH
```

**Option B: Insérer manuelle en base**
```sql
-- Terminal avec sqlite3
sqlite3 database.db "
INSERT INTO outbox (entity_code, entity_uuid, entity_type, op_type, payload_json, status, created_at) 
VALUES ('kloo', '96a8387d-b9ff-4bf0-bd9a-e5568e81e190', 'product', 'PRODUCT_PATCH', 
        '{\"name\":\"kloo\",\"is_active\":1}', 'pending', datetime('now'));
"
```

---

### ✅ ÉTAPE 6: Vérifier le Push (5 min)

**Consulter les logs de synchronisation:**
```bash
# Terminal
tail -f logs/sync.log | grep -E "kloo|PRODUCT_PATCH|PUSH|doProPush"
```

**Attendez-vous à voir (environ tous les 10 secondes):**
```
📤 [PUSH-SYNC] Pushing batch: ops 0-1 of 1
   ✅ Batch acked: 1/1
✅ Marked 1 operations as acked
```

**Si rien:**
```
1. Vérifiez que le serveur tourne: npm start
2. Vérifiez les erreurs: tail -f logs/error.log
3. Vérifiez GOOGLE_SHEETS_WEBAPP_URL en .env
```

---

### ✅ ÉTAPE 7: Vérifier synced_at (2 min)

**En base de données:**
```bash
sqlite3 database.db "
SELECT id, product_id, unit_level, synced_at FROM product_units WHERE uuid='96a8387d-b9ff-4bf0-bd9a-e5568e81e190';
"
```

**Attendez-vous à voir:**
```
1|1|CARTON|2026-01-01 12:34:56
```

**Si `synced_at` est NULL:**
- ❌ Le push n'a pas réussi
- ❌ Vérifiez les logs step 6
- ❌ Relancez une synchronisation

---

## 🚀 Raccourcis rapides

### Redémarrer complètement
```powershell
# PowerShell
# 1. Arrêtez le serveur
# Ctrl+C

# 2. Attendez 5 secondes

# 3. Redémarrez
npm start

# 4. Vérifiez que le worker démarre
# Cherchez: "🚀 Démarrage du worker de synchronisation"
```

### Consulter les logs
```bash
# Logs de synchronisation
tail -f logs/sync.log

# Logs d'erreurs
tail -f logs/error.log

# Tout les logs
tail -f logs/*.log
```

### Requête SQL rapide
```bash
# Vérifier le produit
sqlite3 database.db "SELECT * FROM products WHERE name='kloo';"

# Vérifier les unités
sqlite3 database.db "SELECT * FROM product_units WHERE product_id=1;"

# Vérifier les opérations en attente
sqlite3 database.db "SELECT * FROM outbox WHERE entity_code='kloo' ORDER BY created_at DESC;"

# Vérifier les opérations acked
sqlite3 database.db "SELECT * FROM outbox WHERE entity_code='kloo' AND status='acked' ORDER BY created_at DESC;"
```

---

## ✅ Checklist - Qu'est-ce qui doit se passer?

Après avoir suivi toutes les étapes:

- [ ] `GOOGLE_SHEETS_WEBAPP_URL` est configurée
- [ ] "kloo" existe en Sheets (onglet Carton)
- [ ] UUID en Sheets = `96a8387d-b9ff-4bf0-bd9a-e5568e81e190`
- [ ] `testKlooSyncComplete()` passe ✅
- [ ] Une opération existe en OUTBOX après modification du produit
- [ ] Les logs montrent `[PUSH-SYNC] Pushing batch` environ tous les 10 secondes
- [ ] L'opération OUTBOX passe de `pending` → `acked`
- [ ] `synced_at` dans product_units n'est plus NULL
- [ ] `synced_at` = date/heure actuelle

**Si tout est ✅:** Le produit "kloo" est synchronisé vers Sheets! 🎉

---

## 🆘 Troubleshooting ultime

Si après tous ces tests rien ne fonctionne:

### 1. Vérifiez que le serveur est bien "online"
```powershell
# Testez la connexion Internet
ping google.com
ping script.google.com
```

### 2. Vérifiez que l'OUTBOX existe
```bash
sqlite3 database.db ".tables"
# Doit contenir: outbox product_units products etc.
```

### 3. Vérifiez les permissions
```bash
# Vérifiez que database.db n'est pas read-only
ls -la database.db
# Le fichier doit avoir les permissions rw
```

### 4. Testez la connexion à Sheets directement
```bash
# Remplacez l'URL par votre GOOGLE_SHEETS_WEBAPP_URL
curl -X POST "https://script.google.com/macros/d/.../userweb" \
  -H "Content-Type: application/json" \
  -d '{"action":"proPush","updates":[{"uuid":"96a8387d-b9ff-4bf0-bd9a-e5568e81e190","name":"kloo","mark":""}]}'
```

### 5. Vérifiez les permissions Google Sheets
```
1. Allez dans Google Sheets
2. Tools → Apps Script
3. Editor → "Logs" (vérifiez que vous avez les permissions)
4. Exécutez une fonction test
5. Si erreur: vérifiez que vous êtes propriétaire du document
```

---

## 📊 Diagramme du flux

```
┌─────────────────────────────┐
│ 1. Vérifier .env            │ ← ÉTAPE 1
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│ 2. Tester node réclamés      │ ← ÉTAPE 2
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│ 3. Vérifier Sheets existe    │ ← ÉTAPE 3
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│ 4. Tester doProPush          │ ← ÉTAPE 4
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│ 5. Forcer synchronisation    │ ← ÉTAPE 5
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│ 6. Vérifier les logs         │ ← ÉTAPE 6
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│ 7. Vérifier synced_at        │ ← ÉTAPE 7
└────────────┬────────────────┘
             │
             ▼
        ✅ SUCCÈS!
```

---

**📞 Prochaines étapes:**
1. Exécutez `node VERIFY-KLOO-SYNC.js`
2. Allez à Google Sheets et cherchez "kloo"
3. Exécutez `testKlooSyncComplete()` depuis Apps Script
4. Consultez les logs
5. Reportez les erreurs spécifiques trouvées
