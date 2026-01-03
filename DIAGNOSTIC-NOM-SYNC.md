# Diagnostic: Pourquoi les noms de produits ne se synchronisent pas

## Version courte
1. Modifiez le produit code "1" et changez son nom à quelque chose d'unique comme "TEST_SYNC_2026_001"
2. Attendez 10 secondes
3. Ouvrez Google Apps Script (outils → Script editor) et consultez les logs
4. Cherchez les messages qui commencent par `[PRODUCT-PATCH` et `[handleProductUpsert]`
5. Si vous voyez `Nom ÉCRIT: 'TEST_SYNC_2026_001'` → Le bug est dans Sheets (UI cache? column confusion?)
6. Si vous NE voyez pas ce message → Le bug est dans sync.worker.js ou Code.gs

## Logs à chercher

### ✅ Logs de sync.worker.js (dans Logs Google Apps Script)
```
[PRODUCT-PATCH 0] entity_code='1', payload_json type=string
  ✅ Parsed JSON: name='TEST_SYNC_2026_001', is_active=1
  Name value: finalName='TEST_SYNC_2026_001' (source: defined)
  📦 Loaded 3 unit(s) from DB: CARTON, MILLIER, PIECE
    [UNIT 0] CARTON/CARTON: name='TEST_SYNC_2026_001'
```

### ✅ Logs de Code.gs (dans Logs Google Apps Script)
```
📦 [handleProductUpsert] Début upsert:
   code='1', name='TEST_SYNC_2026_001', unit_level='CARTON', unit_mark='CARTON'
   uuid='...', type=object
...
   ✅ [handleProductUpsert] Nom ÉCRIT: 'TEST_SYNC_2026_001' dans colonne 2
      Type: string, Longueur: 18
   📝 Mise à jour ligne 2
   ✅ Upsert terminé: ligne 2, feuille Carton, uuid=...
```

### ❌ Si vous voyez ça au lieu du dessus
```
[PRODUCT-PATCH 0] entity_code='1', payload_json type=string
  ❌ Parse error: Unexpected token... (first 100 chars: '...')
  Name value: finalName='' (source: undefined)
```
→ **PROBLÈME**: Le JSON est corrompu ou mal encodé

```
[PRODUCT-PATCH 0] entity_code='1', payload_json type=undefined
  ⚠️ payload_json is null/undefined!
```
→ **PROBLÈME**: La payload n'a pas été stockée en base de données

```
   ⚠️ [handleProductUpsert] NAME est undefined - NE SERA PAS ÉCRIT
```
→ **PROBLÈME**: Le field `name` est absent de la payload reçue par Code.gs

```
   ❌ [handleProductUpsert] colNom=-1 INVALIDE - colonne introuvable!
```
→ **PROBLÈME**: La colonne "Nom du produit" n'existe pas ou a un nom différent en Sheets

## Instructions détaillées

### Étape 1: Vérifier les logs Google Apps Script

1. Allez à Google Sheets (votre feuille de calcul avec les produits)
2. Menu: `Outils` → `Éditeur de script` (ou `Tools` → `Script editor`)
3. Bouton `▶ Exécuter` (Run) - vous pouvez ignorer ou appuyer sur `Autoriser`
4. Menu: `Affichage` → `Journaux` (ou `View` → `Logs`)
5. Les logs les plus récents s'affichent à droite
6. Cherchez les messages `[PRODUCT-PATCH` et `[handleProductUpsert]`

### Étape 2: Déclencher une synchronisation

Dans l'app mobile:
1. Allez à "Produits"
2. Cherchez le produit code "1"
3. Modifiez le nom: "TEST_SYNC_2026_V2"
4. Sauvegardez
5. Vérifiez que l'app montre le nouveau nom localement

### Étape 3: Attendre la sync

- Attendez 10-15 secondes pour que la sync cycle se lance
- Le dev server devrait log quelque chose comme:
  ```
  ℹ️ [PUSH-SYNC] Types: PRODUCT_PATCH, UNIT_PATCH, STOCK_MOVE
  [PRODUCT-PATCH 0] entity_code='1'...
  ```

### Étape 4: Vérifier les logs Google Apps Script

1. Retournez à Google Apps Script
2. Logs → cherchez les nouveaux messages contenant '1' ou 'TEST_SYNC'
3. Notez TOUS les messages entre `[PRODUCT-PATCH 0]` et `Upsert terminé`

### Étape 5: Vérifier Google Sheets

1. Retournez à Google Sheets
2. Cherchez la ligne avec code "1"
3. Vérifiez la colonne "Nom du produit" (colonne B)
   - Si elle est vide → Bug dans Code.gs (mais logs diraient "Nom ÉCRIT")
   - Si elle montre l'ancien nom → Peut-être un cache UI (F5?)
   - Si elle montre le nouveau nom → 🎉 FONCTIONNE! (bug peut-être intermittent)

## Cas spéciaux

### Cas 1: Product code "1" existe dans plusieurs feuilles
- La sync crée un patch POUR CHAQUE feuille (Carton, Millier, Piece)
- Si la colonne "Nom du produit" n'existe que dans UNE feuille, seule celle-ci sera mise à jour
- Les logs diront "colNom=-1" pour les autres feuilles

### Cas 2: Product code "1" n'existe pas en base données
- La sync va créer une NOUVELLE ligne
- Attendez, l'utilisateur dit que stock synchro → les produits existent en base
- À moins que les produits aient été créés SEULEMENT dans Sheets?

### Cas 3: Product code "1" a PLUSIEURS unités
- La sync envoie 3 opérations: CARTON, MILLIER, PIECE
- Chaque opération cherche une ligne par `code='1' + mark=UNIT_MARK`
- Si les marks sont différents dans Sheets, ça peut créer de nouvelles lignes

## Solution d'urgence: Forcer la mise à jour manuellement

Si les logs montrent "Nom ÉCRIT" mais Sheets ne change pas:

1. Dans Google Sheets, colonne "Code produit", cherchez "1"
2. Dans la même ligne, allez à colonne "Nom du produit" (colonne B)
3. Effacez le contenu
4. Écrivez: `=CONCATENATE("SYNC_TEST_", TEXT(NOW(),"HH:MM:SS"))`
5. Appuyez sur Entrée
6. Alors la colonne "_updated_at" devrait se mettre à jour automatiquement
7. Cela confirmerait que Sheets reçoit les mises à jour

## Questions pour l'utilisateur

1. **Voyez-vous des messages `[PRODUCT-PATCH` dans les logs?**
   - Si NON: Les patches ne sont pas envoyés à Google
   - Si OUI: Les patches arrivent bien

2. **Voyez-vous `✅ Parsed JSON` ou `❌ Parse error`?**
   - Parse error = JSON corrompu
   - Parsed JSON = JSON OK

3. **Voyez-vous `Nom ÉCRIT` ou `NAME est undefined`?**
   - Nom ÉCRIT = Code.gs essaie d'écrire
   - NAME undefined = Le field `name` ne vient pas du payload

4. **Voyez-vous `colNom=-1` ou `colNom=2` (ou autre nombre)?**
   - colNom=-1 = Colonne "Nom du produit" introuvable
   - colNom=2 = Colonne trouvée, tentative d'écriture

5. **Le produit code "1" existe-t-il dans la feuille Carton?**
   - S'il n'existe pas, une NOUVELLE ligne sera créée pour chaque sync

## Checklist finale

- [ ] Logs montrent `[PRODUCT-PATCH` 
- [ ] Logs montrent `Parsed JSON: name='TEST_SYNC_...`
- [ ] Logs montrent `Nom ÉCRIT: 'TEST_SYNC_...`
- [ ] Logs montrent `colNom=2` (ou autre numéro > 0)
- [ ] Logs montrent `Mise à jour ligne X` (au lieu de "Nouvelle ligne")
- [ ] Google Sheets affiche le nouveau nom après F5

Si tout checkmark est vert → Le système fonctionne!
