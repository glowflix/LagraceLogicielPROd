# ⚡ RÉSUMÉ RAPIDE: Synchronisation des noms de produits

## Le Problème
- Les noms de produits ne se synchronisent PAS vers Google Sheets
- Les marks ne se synchronisent PAS
- Mais les STOCKS se synchronisent correctement ✅

## Ce qui a été fixé

### 1. Logging détaillé
Le code envoie maintenant des logs TRÈS détaillés à chaque étape pour voir exactement où ça casse.

### 2. Endpoint de test
Vous pouvez appeler:
```
POST http://localhost:5000/api/products/test/sync-name
```
pour déclencher un test directement sans passer par l'UI mobile.

### 3. Fan-out logic
Les produits avec plusieurs unités (CARTON, MILLIER, PIECE) envoient maintenant un patch POUR CHAQUE unité.

## Comment tester

### Étape 1: Déclencher le test
```powershell
# Si vous utilisez Windows PowerShell:
$token = "VOTRE_TOKEN_ICI"
$headers = @{ "Authorization" = "Bearer $token" }
Invoke-WebRequest -Uri "http://localhost:5000/api/products/test/sync-name" `
  -Method POST -Headers $headers
```

### Étape 2: Attendre 10 secondes
Attendez que le cycle de sync s'exécute.

### Étape 3: Vérifier les logs
1. Google Sheets → Outils → Éditeur de script
2. Affichage → Journaux
3. Cherchez des messages qui commencent par `[PRODUCT-PATCH`

### Étape 4: Regarder si le nom a changé en Sheets
Cherchez la ligne avec code "1" → regardez colonne "Nom du produit"

## Logs attendus si ça fonctionne

```
[PRODUCT-PATCH 0] entity_code='1'...
  ✅ Parsed JSON: name='TEST_14:35:22'...
📦 [handleProductUpsert] Début upsert:
   code='1', name='TEST_14:35:22'...
   ✅ [handleProductUpsert] Nom ÉCRIT: 'TEST_14:35:22'...
   📝 Mise à jour ligne 2
   ✅ Upsert terminé
```

Si vous voyez ça → **LA SYNC FONCTIONNE!** (peut-être juste un cache Google Sheets, essayer F5)

## Logs si ça casse

### ❌ Cas 1: Message "Parse error"
```
❌ Parse error: Unexpected token...
```
→ Le JSON est corrompu

### ❌ Cas 2: Message "NAME est undefined"  
```
⚠️ NAME est undefined - NE SERA PAS ÉCRIT
```
→ Le champ `name` n'arrive pas du tout

### ❌ Cas 3: Message "colNom=-1"
```
❌ colNom=-1 INVALIDE - colonne introuvable!
```
→ La colonne "Nom du produit" n'existe pas ou a un autre nom

### ❌ Cas 4: Pas de messages du tout
→ Les patches ne sont pas envoyés à Google Sheets

## Les fichiers modifiés

1. **src/services/sync/sync.worker.js**: Better logging when sending patches
2. **tools/apps-script/Code.gs**: Better logging when receiving patches
3. **src/api/routes/products.routes.js**: New test endpoint

## Fichiers de documentation créés

- **FIX-PROGRESS-PRODUCT-SYNC.md**: Document technique complet
- **TEST-PRODUCT-NAME-SYNC.md**: Instructions de test détaillées
- **DIAGNOSTIC-NOM-SYNC.md**: Guide de diagnostic en français

## Qu'est-ce que je dois faire maintenant?

1. **Lire**: FIX-PROGRESS-PRODUCT-SYNC.md pour comprendre en détail
2. **Tester**: Suivre les étapes du TEST-PRODUCT-NAME-SYNC.md
3. **Envoyer les logs**: Si ça ne marche pas, copier-coller les logs de Google Apps Script et me dire ce que vous voyez
4. **Nous saurons alors**: Où exactement le bug se trouve et comment le fixer

## Cas spéciaux

### Si votre produit code "1" n'a qu'UNE unité
- La sync envoie un seul patch au lieu de 3
- Cherchez les messages avec "unit_level='CARTON'" ou autre

### Si vous modifiez un produit différent (ex: code "2")
- Remplacez "code='1'" par "code='2'" dans les logs à chercher
- L'endpoint test crée toujours un patch pour code "1"

### Si les noms s'affichent mais sont vides
- Les logs diront "Nom ÉCRIT: ''" (avec chaîne vide)
- Alors le problème est dans sync.worker.js (name pas inclus ou vide)

## Support

Si vous avez besoin d'aide:
1. Lancez le test endpoint
2. Attendez 10 secondes  
3. Copiez les logs Google Apps Script
4. Décrivez ce que vous voyez en Sheets
5. Envoyez tout ça avec votre rapport
