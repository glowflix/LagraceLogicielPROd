# 🔍 Diagnostic: Pourquoi "kilo" ne se synchronise pas?

**Status:** `synced_at: null` = **JAMAIS SYNCHRONISÉ**

---

## ✅ Checklist de Diagnostic

### 1️⃣ Vérifier que le produit existe en DB

**Query:**
```sql
SELECT 
  id, name, uuid, synced, synced_at, 
  COUNT(*) as unit_count 
FROM products 
LEFT JOIN product_units ON products.uuid = product_units.product_uuid
WHERE name = 'kilo'
GROUP BY products.id;
```

**Attendu:**
```
id | name  | uuid | synced | synced_at | unit_count
1  | kilo  | 96a8... | FALSE | NULL | 1
```

**Si synced = FALSE:** ❌ Pas encore poussé

---

### 2️⃣ Vérifier que la boucle de sync tourne

**Vérification:**
```bash
# Vérifier si sync manager est actif
ps aux | grep "node.*index.js"

# Vérifier les logs
tail -100 logs/sync.log

# Vérifier last sync time
curl http://localhost:3000/sync-status
```

**Attendu:**
```json
{
  "status": {
    "lastSyncTime": "2026-01-01T10:30:00.000Z",
    "status": "success"
  }
}
```

**Si NULL ou vieux:** ❌ Sync loop ne tourne pas ou s'est arrêtée

---

### 3️⃣ Vérifier la connexion à Sheets (doProPull)

**Test GET:**
```bash
curl -X GET "https://script.google.com/macros/d/[DEPLOYMENT_ID]/usercontent?action=proPull&since=2026-01-01T00:00:00Z&key=YOUR_API_KEY"
```

**Attendu:**
```json
{
  "success": true,
  "data": {
    "products": [...],
    "conflicts": [],
    "meta": { "count": X, "since": "..." }
  }
}
```

**Si erreur 404 ou timeout:** ❌ DEPLOYMENT_ID incorrect ou Sheets pas accessible

---

### 4️⃣ Vérifier doProPush (l'endpoint qui envoie)

**Test POST:**
```bash
curl -X POST "https://script.google.com/macros/d/[DEPLOYMENT_ID]/usercontent" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "proPush",
    "key": "YOUR_API_KEY",
    "updates": [
      {
        "uuid": "96a8387d-b9ff-4bf0-bd9a-e5568e81e190",
        "name": "kilo",
        "mark": "K100"
      }
    ]
  }'
```

**Attendu:**
```json
{
  "success": true,
  "applied": [{ "uuid": "96a8...", "updated": 3 }],
  "propagated": 3,
  "server_time": "2026-01-01T10:35:00Z"
}
```

**Si erreur:** 📍 **C'EST ICI LE PROBLÈME**

---

### 5️⃣ Vérifier que "kilo" existe dans Sheets

**En Sheets:**
- Ouvrir le fichier Grace
- Aller à l'onglet "Carton"
- Chercher "kilo" dans la colonne B (Nom)
- Vérifier colonnes de droite (_uuid, _updated_at, _version)

**Si UUID vide:** ❌ Faut d'abord run "🆔 Backfill All UUIDs" (Menu LaGrace Admin)

**Si UUID ≠ "96a8387d-...":** ❌ Les UUIDs ne correspondent pas (mismatch BD/Sheets)

---

### 6️⃣ Vérifier les logs du Sync Manager

**Fichier:** `logs/sync.log`

**Chercher:**
```
[Push] 📤 Sending 1 pending change(s)...
[Push] ❌ Error: ...
```

**Ou:**
```
[Apply] ❌ Error: ...
```

---

## 🚨 Problèmes les plus courants

| Problème | Diagnostic | Solution |
|----------|-----------|----------|
| **Sync loop ne tourne pas** | `lastSyncTime: null` | `npm start` ou `node index.js` |
| **DEPLOYMENT_ID incorrect** | 404 ou timeout sur doProPush | Vérifier Apps Script deployment |
| **UUID mismatch** | UUID BD ≠ UUID Sheets | Run "🆔 Backfill All UUIDs" en Sheets |
| **Colonne B/F vide en Sheets** | Pas de Nom/Mark | Remplir manuellement |
| **Sheets pas accessible** | 403 Forbidden | Vérifier API key + permissions |
| **Pas d'_updated_at en Sheets** | Column not found | Ajouter colonne tech (_updated_at, _version) |

---

## 🛠️ Résolution rapide

### Si synced_at = NULL et sync loop TOURNE:

```bash
# 1. Vérifier que doProPush répond
curl -X POST "https://script.google.com/macros/d/[ID]/usercontent" \
  -H "Content-Type: application/json" \
  -d '{"action":"proPush","key":"KEY","updates":[{"uuid":"96a8387d-b9ff-4bf0-bd9a-e5568e81e190","name":"kilo","mark":""}]}'

# 2. Si erreur: regarder Apps Script logs
# 3. Si succès: vérifier que markSynced(uuid) a été appelé
```

### Si doProPush échoue:

```bash
# Vérifier à la main que "kilo" existe en Sheets
# Colonne B doit avoir "kilo"
# Colonne du nom et mark doivent être cohérents
# Aller en Sheets > LaGrace Admin > Validate Schema
```

---

## 📋 Infos à me fournir pour debug

```
1. DEPLOYMENT_ID (Apps Script)
2. Output de curl test doProPush (erreur exacte)
3. Logs du sync manager (last 50 lines)
4. Query BD: SELECT * FROM products WHERE name='kilo'
5. Vérifier en Sheets: existe "kilo" en Carton? Colonne B remplie?
6. Health check: curl http://localhost:3000/health
```

