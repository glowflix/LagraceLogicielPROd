# 📚 Index: Synchronisation des noms de produits

## 🎯 Commencez par ici

### Si vous avez peu de temps (5 min):
👉 **Lisez**: [QUICK-START-SYNC-TEST.md](QUICK-START-SYNC-TEST.md)
- Résumé rapide du problème
- 4 étapes simples pour tester
- Logs à chercher

### Si vous voulez comprendre en détail (15 min):
👉 **Lisez**: [FIX-PROGRESS-PRODUCT-SYNC.md](FIX-PROGRESS-PRODUCT-SYNC.md)
- Analyse complète du problème
- 5 causes possibles
- Tous les changements faits
- Comment interpréter les résultats

### Si le test ne fonctionne pas (diagnostic approfondi):
👉 **Lisez**: [TEST-PRODUCT-NAME-SYNC.md](TEST-PRODUCT-NAME-SYNC.md)
- Instructions détaillées de test
- Interprétation des 6 cas possibles
- Troubleshooting pour chaque cas

### Pour les détails très techniques (français):
👉 **Lisez**: [DIAGNOSTIC-NOM-SYNC.md](DIAGNOSTIC-NOM-SYNC.md)
- Diagnostic complet en français
- Checklist de verification
- Logs attendus dans chaque cas

## 🔧 Changements apportés

### Code modifié
1. `src/services/sync/sync.worker.js` (lignes 307-380)
   - Logging amélioré dans pushProductPatches()
   - Fan-out logic pour chaque unité

2. `tools/apps-script/Code.gs` (lignes 487-492)
   - Logging amélioré dans handleProductUpsert()
   - Affiche tous les champs reçus

3. `src/api/routes/products.routes.js` (lignes 440-490)
   - Nouveau endpoint: POST /api/products/test/sync-name
   - Permet de tester directement sans UI mobile

### Fichiers créés
- **QUICK-START-SYNC-TEST.md** ← Commencez ici
- **FIX-PROGRESS-PRODUCT-SYNC.md** ← Détails complets
- **TEST-PRODUCT-NAME-SYNC.md** ← Guide de test
- **DIAGNOSTIC-NOM-SYNC.md** ← Diagnostic approfondi
- **FIX-PROGRESS: This file** ← Index et track

## 🚀 Plan d'action rapide

```
1. Lire QUICK-START-SYNC-TEST.md (5 min)
   ↓
2. Appeler POST /api/products/test/sync-name (1 min)
   ↓
3. Attendre 10 secondes
   ↓
4. Vérifier les logs Google Apps Script (2 min)
   ↓
5. Nous envoyer les logs + ce que vous voyez en Sheets (2 min)
   ↓
6. Analyse + Fix (je fais ça)
```

## 📊 Statut du problème

### ✅ Analysé et compris
- Les stocks synchro ✅ (via update_stock operation)
- Les noms ne synchro pas ❌ (via product upsert)
- Les marks ne synchro pas ❌ (même raison)

### ✅ Diagnostiqué
- Problem: handleProductUpsert() ne reçoit ou n'écrit pas le `name` et `unit_mark`
- Cause possible: JSON corrupted, column not found, payload empty, UI cache...

### ✅ Outils de diagnostic créés
- Logging détaillé à chaque étape
- Test endpoint pour contourner l'UI
- 4 guides de diagnostic
- Checklist de verification

### ⏳ En attente
- User runs test
- Logs show exactly where it breaks
- We fix it based on logs

## 🔍 Prochaines étapes

### Pour l'utilisateur:
1. Exécuter le test endpoint
2. Consulter les logs
3. Envoyer les résultats

### Pour moi:
1. Analyser les logs
2. Identifier le bug exact
3. Appliquer le fix
4. Vérifier en prod

## 📝 Notes d'implémentation

### Fan-out Logic (déjà implémenté)
```javascript
// AVANT: Un seul patch pour le produit
patches.map(op => ({ code: op.entity_code, name: ... }))

// APRÈS: Un patch PER unité
patches.flatMap(op => 
  units.map(u => ({ 
    code: op.entity_code, 
    name: ..., 
    unit_level: u.unit_level,
    unit_mark: u.unit_mark
  }))
)
```

### Logging ajouté
- sync.worker.js: Affiche payload_json brut, résultat parse, finalName
- Code.gs: Affiche tous les champs reçus, colonne trouvée, nom écrit

### Endpoint de test
- Crée un patch test immédiatement
- Bypasse l'UI mobile
- Génère un nom test unique
- Fait la même chose que la modification UI

## ❓ Questions fréquentes

**Q: Pourquoi les stocks marchent mais pas les noms?**
A: Les stocks viennent de update_stock operation (autre handler), les noms viennent de product upsert.

**Q: Pourquoi l'UI mobile ne montre pas les changements de Sheets?**
A: L'UI affiche la base locale (SQLite), pas Google Sheets. Il n'y a pas de pull depuis Sheets.

**Q: Si le test montre "Nom ÉCRIT" mais Sheets ne change pas?**
A: Probablement un cache Google Sheets. Essayer F5, Ctrl+Shift+Del, ou reload complète.

**Q: Comment je sais quel token utiliser pour le test endpoint?**
A: Utilisez le même token qu'avec l'app mobile (même authentication).

**Q: Est-ce que je peux avoir une erreur si je teste plusieurs fois?**
A: Non, chaque test crée un nouveau nom test unique, donc pas de conflit.

## 🎓 Apprentissage

Cet exercice montre l'importance de:
1. **Logs détaillés** - On sait EXACTEMENT où ça casse
2. **Séparation des concerns** - update_stock vs product upsert
3. **Fan-out logic** - Un produit peut avoir plusieurs unités
4. **Testing directs** - Endpoint de test pour contourner l'UI

## 📞 Support

Si vous avez besoin d'aide:
1. Lisez QUICK-START-SYNC-TEST.md
2. Exécutez le test
3. Consultez les logs
4. Dites-moi ce que vous voyez
