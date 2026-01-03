# Diagnostic: Synchronisation du nom du produit vers Google Sheets

## Problème rapporté
- Modification du nom d'un produit dans la page Produits (par ex: "lolos")
- La modification est confirmée localement (API retourne succès)
- **MAIS**: Le nom n'est pas mis à jour dans Google Sheets dans la colonne "Nom du produit"

## Flux de synchronisation attendu

### 1️⃣ Modification locale (Frontend → API)
```
ProductsPage.jsx
  ↓ (PUT /api/products/1)
src/api/routes/products.routes.js
  ↓ (productsRepo.upsert + enqueueProductPatch)
SQLite local
  ↓ (INSERT sync_operations avec op_type='PRODUCT_PATCH')
Table "sync_operations"
```

### 2️⃣ Synchronisation automatique (Backend → Google Sheets)
```
SyncWorker.startPushSyncLoop() [toutes les 15 secondes]
  ↓ (getPendingOperations('PRODUCT_PATCH'))
sync_operations avec status='pending'
  ↓ (pushProductPatches via sheetsClient.pushBatch)
Google Apps Script (Code.gs)
  ↓ (handleProductUpsert avec payload contenant 'name')
Google Sheets
  ↓ (Colonne "Nom du produit" mise à jour)
```

## Étapes de diagnostic

### ✅ Étape 1: Vérifier que le patch est bien ajouté à l'outbox
**Code modifié dans** `src/api/routes/products.routes.js` (ligne ~155):
```javascript
logger.info(`📤 [PATCH-ENQUEUE] Produit ${fullProduct.code}: name='${productPatch.name}', is_active=${productPatch.is_active}`);
```

**À vérifier dans les logs:**
- Après modification du nom "lolos", cherche le log:
  ```
  📤 [PATCH-ENQUEUE] Produit 1: name='lolos', is_active=1
  ```

### ✅ Étape 2: Vérifier que le patch est bien inséré dans sync_operations
**Code modifié dans** `src/db/repositories/outbox.repo.js` (ligne ~90):
```javascript
logger.info(`📦 [OUTBOX-INSERT] PRODUCT_PATCH: code='${entityCode}', uuid='${entityUuid}', op_id='${opId}'`);
logger.info(`   Payload: ${patchJson}`);
logger.info(`   Status: pending, Device: ${deviceId}`);
```

**À vérifier dans les logs:**
- Cherche:
  ```
  📦 [OUTBOX-INSERT] PRODUCT_PATCH: code='1', ...
     Payload: {"name":"lolos","is_active":1}
     Status: pending, Device: ...
  ```

### ✅ Étape 3: Vérifier que le patch est bien envoyé à Sheets (push)
**Code existant dans** `src/services/sync/sync.worker.js` (ligne ~315):
```javascript
[PRODUCT-PATCH ${idx}] entity_code='1', ...
  ✅ Parsed JSON: name='lolos', is_active=1
```

**À vérifier dans les logs:**
- Toutes les 15 secondes, cherche:
  ```
  📤 [PUSH-SYNC] ==========================================
  📤 [PUSH-SYNC] PUSH DES MODIFICATIONS LOCALES
  ...
  📦 [PRODUCT_PATCH] X patch(es) à envoyer
  [PRODUCT-PATCH 0] entity_code='1', ...
    ✅ Parsed JSON: name='lolos', is_active=1
  ```

### ✅ Étape 4: Vérifier que Code.gs reçoit et applique le changement
**À vérifier dans Google Apps Script logs** (Code.gs → Afficher → Logs):
- Cherche:
  ```
  📦 [handleProductUpsert] Début upsert: code='1', name='lolos', ...
  ✅ Parsed JSON: name='lolos'
  Nom ÉCRIT: 'lolos'
  ✅ Upsert terminé: ligne X, feuille CARTON, uuid=...
  ```

## Actions à faire immédiatement

### 1. Relancer l'application
```bash
# Terminal
npm run dev
```

### 2. Modifier un produit (changement du nom)
- Accéder à la page Produits
- Chercher le produit avec ID=1
- Changer le nom en quelque chose de visible (ex: "TEST-LOLOS-" + date)
- Cliquer "Enregistrer"

### 3. Vérifier les logs locaux
- Accéder à l'onglet "Console" du navigateur (F12)
- Vérifier que le PUT retourne succès
- Chercher les logs `📤 [PATCH-ENQUEUE]` et `📦 [OUTBOX-INSERT]`

### 4. Attendre 15 secondes maximum
- Le push automatique se déclenche toutes les 15 secondes
- Vérifier les logs pour `📤 [PUSH-SYNC]`

### 5. Accéder à Google Sheets
- Ouvrir la feuille "CARTON" (ou l'unité du produit)
- Vérifier que la colonne "Nom du produit" a été mise à jour

## Résultats attendus

### ✅ Si ça marche
- Les 4 étapes de log ci-dessus doivent être présentes
- Le nom dans Google Sheets doit correspondre au nom modifié localement
- Les colonnes `_updated_at` et `_uuid` doivent aussi être mises à jour

### ❌ Si ça ne marche pas
- **Log manquant à l'étape 1/2?** → Problème dans l'API ou l'enqueue
- **Log présent mais nom différent?** → Problème de parsing du payload
- **Logs 1-3 présents mais pas d'étape 4?** → Problème dans la transmission vers Google Sheets
- **Logs 1-4 présents mais nom pas mis à jour?** → Problème dans handleProductUpsert ou colonne inexistante

## Fichiers modifiés
1. `src/api/routes/products.routes.js` - Logs détaillés du patch produit
2. `src/db/repositories/outbox.repo.js` - Logs détaillés de l'insertion dans sync_operations
3. `src/services/sync/sync.worker.js` - Logs détaillés du push (déjà existants)
4. `tools/apps-script/Code.gs` - Logs détaillés de handleProductUpsert (déjà existants)

## Prochaines étapes après diagnostic
- Si étape 4 échoue → Vérifier Code.gs et handleProductUpsert
- Si étape 3-4 échouent → Vérifier la connexion Internet vers Google Sheets
- Si tout réussit → La synchronisation fonctionne ! 🎉
