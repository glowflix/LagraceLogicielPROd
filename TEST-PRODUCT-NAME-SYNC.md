# Test de synchronisation des noms de produits

## Problème rapporté
- Les noms de produits ne se synchronisent pas de l'app vers Google Sheets
- Les stocks se synchronisent correctement
- Les marks ne se synchronisent pas non plus

## Solution: Diagnostic avec test endpoint

### Étape 1: Déclencher un test de sync

**Option A: Via API (le plus facile)**

```bash
# Utiliser curl, Postman, ou le navigateur
# 1. Si vous avez Postman:
POST http://localhost:5000/api/products/test/sync-name
# Authorization: Bearer <your_token>

# 2. Ou via terminal PowerShell:
$headers = @{ "Authorization" = "Bearer <your_token>" }
Invoke-WebRequest -Uri http://localhost:5000/api/products/test/sync-name -Method POST -Headers $headers
```

**Option B: Via l'interface mobile**

1. Ouvrez l'app mobile
2. Allez à "Produits"
3. Cherchez le produit code "1"
4. Modifiez son nom en quelque chose de très visible comme "TEST_SYNC_NOW"
5. Sauvegardez

### Étape 2: Attendre la synchronisation

- Attendez 10-15 secondes
- Le dev server devrait afficher des logs d'synchronisation

### Étape 3: Consulter les logs Google Apps Script

1. Ouvrez Google Sheets (votre feuille avec les produits)
2. Menu `Outils` → `Éditeur de script`
3. Menu `Affichage` → `Journaux`
4. Cherchez les messages commençant par `[PRODUCT-PATCH`

**Logs attendus si tout fonctionne:**

```
[PRODUCT-PATCH 0] entity_code='1', payload_json type=string
  ✅ Parsed JSON: name='TEST_SYNC_NOW', is_active=1
  📦 Loaded 3 unit(s) from DB: CARTON, MILLIER, PIECE
    [UNIT 0] CARTON/CARTON: name='TEST_SYNC_NOW'
```

Puis:

```
📦 [handleProductUpsert] Début upsert:
   code='1', name='TEST_SYNC_NOW', unit_level='CARTON', unit_mark='CARTON'
   ✅ [handleProductUpsert] Nom ÉCRIT: 'TEST_SYNC_NOW' dans colonne 2
   📝 Mise à jour ligne 2
   ✅ Upsert terminé: ligne 2, feuille Carton
```

### Étape 4: Vérifier Google Sheets

1. Retournez à votre Google Sheets
2. Cherchez la ligne avec code produit "1"
3. Colonne "Nom du produit" devrait afficher "TEST_SYNC_NOW"

## Interprétation des résultats

### ✅ Cas 1: Logs montrent "Nom ÉCRIT" ET Sheets affiche le nouveau nom
**Verdict**: ✅ LA SYNCHRONISATION FONCTIONNE!

C'est possible que le problème vienne de:
- Un cache du navigateur (essayer F5 ou Ctrl+Shift+Del)
- Un délai dans la synchronisation 
- Ou des product codes spécifiques qui ne marchent pas

### ✅ Cas 2: Logs montrent "Nom ÉCRIT" MAIS Sheets n'a PAS le nouveau nom
**Verdict**: Bug dans Google Sheets ou Sheets UI cache

Actions:
1. Appuyez sur F5 pour recharger Google Sheets complètement
2. Vérifiez que vous regardez la BONNE feuille (Carton? Milliers? Piece?)
3. Vérifiez que la ligne trouvée a bien le code "1" en colonne A

### ❌ Cas 3: Logs montrent `❌ Parse error`
**Verdict**: Le JSON du payload est corrompu

Actions:
1. Contactez avec les détails du message d'erreur
2. Le fichier `sync_operations` peut avoir une corruption

### ❌ Cas 4: Logs montrent `NAME est undefined`
**Verdict**: Le champ `name` ne vient pas du patch

Actions:
1. Vérifiez que le produit est bien mis à jour en base locale
2. Vérifiez que l'API PUT /api/products fonctionne
3. Les logs du dev server devraient montrer "✓ Produit enregistré"

### ❌ Cas 5: Logs montrent `colNom=-1`
**Verdict**: Google Sheets n'a pas de colonne "Nom du produit"

Actions:
1. Vérifiez que la colonne B de votre Sheets s'appelle exactement "Nom du produit"
2. Vérifiez la CASSE (majuscules/minuscules)
3. S'il n'existe pas, le script créera la colonne automatiquement

### ❌ Cas 6: Pas de logs `[PRODUCT-PATCH` du tout
**Verdict**: Les patches ne sont pas envoyés à Google Sheets

Actions:
1. Vérifiez que le dev server est bien en cours d'exécution (`npm run dev`)
2. Vérifiez que la URL Google Sheets dans `config.env` est correcte
3. Vérifiez que l'API key Google Sheets est valide (si configurée)

## Détails techniques

### Fichiers modifiés
1. `src/services/sync/sync.worker.js`: Improved logging for payload parsing
2. `src/api/routes/products.routes.js`: Added `/api/products/test/sync-name` endpoint
3. `tools/apps-script/Code.gs`: Improved logging in handleProductUpsert

### Logs à vérifier
1. **Dev server console**: npm run dev output
2. **Google Apps Script logs**: Tools → Script editor → View → Logs
3. **Database**: SELECT * FROM sync_operations WHERE entity_code = '1'

## Prochaines étapes si encore cassé

Si le test montre que les logs sont OK mais Sheets ne change pas:
1. Contactez avec les captures d'écran des logs
2. Donnez aussi la liste complète des colonnes de votre Sheets
3. Spécifiez si c'est la feuille "Carton", "Milliers", ou "Piece"

## Code du test endpoint

L'endpoint `/api/products/test/sync-name` fait ceci:
1. Met à jour le produit code "1" avec un nom test
2. Crée un patch PRODUCT_PATCH
3. Enqueue pour la synchronisation
4. Retourne l'opération ID pour tracking

C'est identique à ce que fait la modification manuelle, mais GARANTI d'avoir un nom valide.
