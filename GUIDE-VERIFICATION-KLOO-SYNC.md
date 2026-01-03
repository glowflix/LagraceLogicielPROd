# 🔍 Guide Complet: Vérification de la Synchronisation "kloo" → Google Sheets

## 📋 Vue d'ensemble

Le produit "kloo" doit se synchroniser automatiquement vers Google Sheets. Ce guide vous aide à identifier le problème si la synchronisation ne fonctionne pas.

## 🔄 Flux de synchronisation (NORMAL)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. BD LOCAL (Node.js)                                           │
│    ├─ Produit créé/modifié: "kloo"                            │
│    ├─ UUID généré automatiquement (si absent)                 │
│    └─ Enregistré avec synced_at = NULL                        │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. OUTBOX (Table de synchronisation)                            │
│    ├─ Opération PRODUCT_PATCH créée                            │
│    ├─ Opération UNIT_PATCH créée                               │
│    └─ Status = 'pending' (en attente)                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼ (toutes les 10 secondes)
┌─────────────────────────────────────────────────────────────────┐
│ 3. PUSH VERS SHEETS (Via Google Apps Script)                    │
│    ├─ POST vers GOOGLE_SHEETS_WEBAPP_URL                       │
│    ├─ Contient: { action: 'batchPush', ops: [...] }           │
│    └─ Code.gs reçoit et appelle handleProductUpsert()         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. SHEETS (Google Sheets - Code.gs)                            │
│    ├─ Cherche produit par UUID (priorité)                      │
│    ├─ Sinon: cherche par code + mark                           │
│    ├─ Auto-génère UUID si absent                               │
│    ├─ Met à jour ligne Sheets                                  │
│    └─ Retourne: { success: true, applied: [...] }             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. BD LOCAL - Marquage SYNCED                                   │
│    ├─ Opération marquée "acked"                                 │
│    ├─ Récupère ID de "acked"                                   │
│    └─ Met à jour synced_at = maintenant                        │
└─────────────────────────────────────────────────────────────────┘
```

## 🚨 Points de défaillance courants

### 1️⃣ GOOGLE_SHEETS_WEBAPP_URL manquante ou incorrecte

**Symptôme:** Aucune synchronisation du tout, pas d'erreurs visibles

**Diagnostic:**
```powershell
# Vérifier la variable d'environnement
echo $env:GOOGLE_SHEETS_WEBAPP_URL

# Doit retourner quelque chose comme:
# https://script.google.com/macros/d/AKfycb...../usercontent
```

**Solution:**
```powershell
# 1. Allez dans Google Sheets
# 2. Tools → Apps Script
# 3. Deploy → New deployment (Type: Web app)
# 4. Copiez l'URL générée
# 5. Créez la variable d'environnement:
$env:GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/d/..."

# 6. Redémarrez le serveur Node.js
```

### 2️⃣ Le produit "kloo" n'existe pas en Sheets

**Symptôme:** "kloo" est en BD mais ne peut pas être trouvé en Sheets

**Diagnostic:**
```
1. Allez dans Google Sheets
2. Cherchez "kloo" dans les onglets:
   - Carton
   - Milliers  
   - Pièce
```

**Solution:** Créer manuellement en Sheets:
```
1. Allez dans l'onglet "Carton"
2. Ajoutez une ligne avec:
   - Code produit: kloo
   - Nom du produit: kloo
   - Les autres colonnes: remplissez comme dans le payload
3. Sauvegardez
```

### 3️⃣ UUID manquant ou incorrect

**Symptôme:** Produit créé mais jamais synchronisé, ou mauvaise correspondance UUID

**Diagnostic:**
```
Payload BD: UUID = 96a8387d-b9ff-4bf0-bd9a-e5568e81e190
Sheets:    UUID = (vide) ou différent
```

**Solution:**
```
1. En Sheets, trouvez la ligne "kloo"
2. Colonne "_uuid": entrez l'UUID attendu
3. Colonne "_updated_at": entrez une date ISO (ex: 2026-01-01T12:00:00.000Z)
4. Sauvegardez
5. Attendez 10 secondes pour la synchro
```

### 4️⃣ Worker de synchronisation ne tourne pas

**Symptôme:** Les opérations s'accumulent en OUTBOX sans être envoyées

**Diagnostic:**
```
1. Vérifiez le fichier sync.log:
   tail -f logs/sync.log | grep -E "PUSH|kloo|product"

2. Cherchez des messages comme:
   ✅ [PUSH-SYNC] ou
   ❌ [PUSH-SYNC] ou
   📤 [PUSH-SYNC]
```

**Solution:**
```powershell
# 1. Redémarrez le serveur
npm start

# 2. Vérifiez que le worker démarre
# Vous devriez voir dans les logs:
# 🚀 Démarrage du worker de synchronisation

# 3. Si rien ne s'affiche, vérifiez:
#    - PORT disponible
#    - DATABASE_URL valide
#    - Permissions sur le fichier database.db
```

### 5️⃣ Erreur 404 ou authentification vers Sheets

**Symptôme:** Les requêtes vers Google Sheets retournent 404 ou erreur

**Diagnostic:**
```
Vérifiez dans logs/sync.log:
❌ push ERROR 404 ou
❌ batchPush ERROR ou
❌ Erreur d'authentification
```

**Solution:**
```
1. Re-déployez le Apps Script:
   - Google Sheets → Tools → Apps Script
   - Deploy → New deployment (Web app)
   - Copy new URL
   
2. Mettez à jour .env:
   GOOGLE_SHEETS_WEBAPP_URL=https://...

3. Redémarrez Node.js
```

## 📊 Vérification étape par étape

### ÉTAPE 1: Vérifier la BD locale

```bash
node VERIFY-KLOO-SYNC.js
```

Attendez-vous à voir:
- ✅ TROUVÉ: "kloo"
- ✅ Unit count: 1
- ✅ UUID: 96a8387d-b9ff-4bf0-bd9a-e5568e81e190

### ÉTAPE 2: Vérifier Google Sheets

1. Allez à Google Sheets
2. Cherchez "kloo" dans Carton/Milliers/Pièce
3. Vérifiez les colonnes:
   - `Code produit`: kloo
   - `Nom du produit`: kloo
   - `_uuid`: 96a8387d-b9ff-4bf0-bd9a-e5568e81e190
   - `_updated_at`: 2026-01-01...

### ÉTAPE 3: Déclencher un changement

Pour forcer la synchronisation:
```javascript
// Dans l'app, modifiez le produit "kloo" (ex: changez le prix)
// Cela crée une opération PRODUCT_PATCH/UNIT_PATCH en OUTBOX
```

Ou directement en SQL:
```sql
-- Insérez une opération manuelle d'test
INSERT INTO outbox (entity_code, entity_uuid, entity_type, op_type, payload_json, status)
VALUES ('kloo', '96a8387d-b9ff-4bf0-bd9a-e5568e81e190', 'product', 'PRODUCT_PATCH', 
        '{"name":"kloo","is_active":1}', 'pending');
```

### ÉTAPE 4: Tester depuis Google Sheets

1. Allez dans Google Sheets
2. Tools → Apps Script
3. Exécutez: `testKlooSyncComplete()`
4. Vérifiez les logs (Tools → Logs)

Attendez-vous à voir:
- ✅ TROUVÉ en "Carton"
- ✅ UUID correspond!
- ✅ doProPush SUCCESS!

## 🔧 Commandes utiles

### Vérifier les opérations en attente

```bash
# SQL SQLite
sqlite3 database.db "SELECT * FROM outbox WHERE entity_code='kloo' ORDER BY created_at DESC LIMIT 10;"
```

### Consulter les logs de synchronisation

```bash
# Terminal
tail -f logs/sync.log | grep -E "kloo|PRODUCT_PATCH|UNIT_PATCH"
```

### Forcer un push immédiat

```bash
# Redémarrez le serveur (cela relancera le cycle de push)
npm start
```

### Vérifier la configuration

```bash
# Afficher les variables critiques
echo "GOOGLE_SHEETS_WEBAPP_URL: $env:GOOGLE_SHEETS_WEBAPP_URL"
echo "DATABASE_URL: $env:DATABASE_URL"
echo "NODE_ENV: $env:NODE_ENV"
```

## ✅ Checklist finale

Avant de déclarer la synchronisation "OK":

- [ ] `GOOGLE_SHEETS_WEBAPP_URL` est configurée et valide
- [ ] "kloo" existe en Sheets (Carton/Milliers/Pièce)
- [ ] UUID en Sheets = `96a8387d-b9ff-4bf0-bd9a-e5568e81e190`
- [ ] `_updated_at` n'est pas vide
- [ ] Worker de sync tourne (`npm start` en cours)
- [ ] `testKlooSyncComplete()` passe tous les tests ✅
- [ ] Après modification du prix, l'OUTBOX contient une opération
- [ ] Après 10 secondes, l'opération OUTBOX passe de "pending" à "acked"
- [ ] `synced_at` en BD est mise à jour avec la date actuelle

## 📞 Si rien ne fonctionne

1. **Redémarrez tout:** 
   - Arrêtez Node.js (Ctrl+C)
   - Attendez 5 secondes
   - `npm start`

2. **Vérifiez les bases:**
   - GOOGLE_SHEETS_WEBAPP_URL valide
   - DATABASE_URL pointe vers le bon fichier
   - Google Sheets et Apps Script accessibles

3. **Consultez les logs:**
   - `sync.log` → vérifiez push/pull
   - `app.log` → vérifiez les erreurs applicatives
   - Google Sheets → Tools → Logs → Erreurs Apps Script

4. **Testez les connecteurs:**
   - Testez `testKlooSyncComplete()` depuis Google Sheets
   - Testez `node VERIFY-KLOO-SYNC.js` depuis terminal
   - Testez la connexion Internet (ping google.com)
