# ✅ DEBTS SYNC - TEST CHECKLIST

## Phase 1: Backfill (Apps Script) - IMMÉDIAT

- [ ] Ouvrir `Code.gs` dans Google Apps Script
- [ ] Menu > Run > `backfillDettesTechColumns()`
- [ ] Attendre log: `[backfillDettesTechColumns] ✅ Terminé. Modifs: X`
- [ ] Vérifier dans Sheets : colonnes `_uuid` et `_updated_at` remplies

**Temps estimé** : 5 secondes

---

## Phase 2: Vérification Sheets

- [ ] Ouvrir Sheets "Dettes"
- [ ] Vérifier colonne `_uuid` : format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- [ ] Vérifier colonne `_updated_at` : format ISO `2025-12-06T14:36:49.132Z`
- [ ] Comptabiliser nombre de lignes avec données

**Exemple de résultat attendu** :
```
ID | Client      | Produit   | Prix a payer | _uuid                                | _updated_at
1  | PA MUKANIA  | 139       | 13800        | 550e8400-e29b-41d4-a716-446655440000 | 2025-12-06T14:36:49.132Z
2  | PA SAMY     | PMI8U2... | 100000       | 6ba7b810-9dad-11d1-80b4-00c04fd430c8 | 2025-12-06T14:42:01.535Z
```

---

## Phase 3: Test PULL (GET debts)

### Test 3.1: Pull FULL
```bash
curl "http://localhost:3000/api/sync?entity=debts&full=1&cursor=2&limit=300"
```

**Résultat attendu** :
- HTTP 200 ✅
- `data` array contient dettes
- Chaque dette a : `uuid`, `invoice_number`, `client_name`, `product_description`, `total_fc`, `paid_fc`, `remaining_fc`, `status`

### Test 3.2: Pull INCREMENTAL (depuis date)
```bash
curl "http://localhost:3000/api/sync?entity=debts&since=2026-01-01T00:00:00Z&cursor=2&limit=300"
```

**Résultat attendu** :
- Retourne dettes modifiées depuis 2026-01-01

### Test 3.3: Pagination
```bash
curl "http://localhost:3000/api/sync?entity=debts&cursor=2&limit=3"
```

**Résultat attendu** :
- `data.length` = 3
- `next_cursor` = 5 (si plus de 3 lignes)
- `done` = false (si plus de 3 lignes)

---

## Phase 4: Test PUSH (POST upsert)

### Test 4.1: Créer une nouvelle dette
```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "debts",
    "op": "upsert",
    "payload": {
      "client_name": "Test Client",
      "invoice_number": "TEST-2026-001",
      "product_description": "Test Product",
      "total_fc": 50000,
      "paid_fc": 0,
      "remaining_fc": 50000,
      "status": "open"
    }
  }'
```

**Résultat attendu** :
- HTTP 200 ✅
- Response inclut `uuid` généré
- Nouvelle ligne apparaît dans Sheets avec UUID et _updated_at

### Test 4.2: Mettre à jour une dette existante
```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "debts",
    "op": "upsert",
    "payload": {
      "uuid": "[UUID-FROM-PHASE-3]",
      "client_name": "PA MUKANIA",
      "invoice_number": "001",
      "product_description": "139",
      "total_fc": 13800,
      "paid_fc": 6900,
      "remaining_fc": 6900,
      "status": "partial"
    }
  }'
```

**Résultat attendu** :
- HTTP 200 ✅
- Ligne mise à jour (pas nouvelle ligne créée)
- `paid_fc` et `status` modifiés dans Sheets

### Test 4.3: Pas d'écrasement (multi-produits même facture)
**Scénario** :
- Facture 001 : Client PA MUKANIA, Produit 139, 13800 FC (LIGNE 1)
- Facture 001 : Client PA MUKANIA, Produit 69, 40020 FC (LIGNE 2)

**AVANT FIX** : Push produit 69 aurait écrasé ligne produit 139 (BUG)
**APRÈS FIX** : Chaque produit = ligne unique, pas d'écrasement ✅

```bash
# Push produit 139
POST /sync { invoice_number: "001", client_name: "PA MUKANIA", product_description: "139", ... }
# Résultat : Ligne 1 mise à jour

# Push produit 69
POST /sync { invoice_number: "001", client_name: "PA MUKANIA", product_description: "69", ... }
# Résultat : Ligne 2 mise à jour (pas écrasement de Ligne 1)
```

**Vérification** :
- [ ] Sheets contient DEUX lignes (pas une)
- [ ] Ligne 1 : Produit 139, Prix 13800
- [ ] Ligne 2 : Produit 69, Prix 40020

---

## Phase 5: Test END-TO-END (Electron App)

### Test 5.1: Créer une dette depuis l'app
1. Ouvrir app Electron
2. Menu "Dettes" ou formulaire créer/modifier vente
3. Cocher "Enregistrer comme dette"
4. Remplir : Client, Produit, Montant, Facture, Date
5. Valider

**Résultat attendu** :
- [ ] Sync logs montrent : `💳 [DEBT] 1 dette(s) à envoyer`
- [ ] Sync logs montrent : `✅ 1 dette(s) envoyée(s) avec succès`
- [ ] Nouvelle ligne apparaît dans Sheets "Dettes"
- [ ] SQLite `debts` table contient la ligne avec UUID

### Test 5.2: Modifier une dette depuis l'app
1. Ouvrir une dette existante
2. Modifier `paid_fc` ou `status`
3. Valider

**Résultat attendu** :
- [ ] Sync logs montrent PUSH
- [ ] Ligne Sheets mise à jour
- [ ] SQLite mise à jour

### Test 5.3: Vérifier PULL de Sheets
1. Modifier une ligne Sheets (manuellement dans le navigateur)
   - Ajouter une nouvelle ligne
   - Modifier `paid_fc` d'une ligne existante
2. Attendre sync auto (~10 secondes)
3. Vérifier Electron app → SQLite `debts` mise à jour

**Résultat attendu** :
- [ ] Sync logs montrent : `📥 [DEBTS] X dettes récupérées`
- [ ] Nouvelle ligne visible dans app (ou liste mise à jour)

---

## ⚠️ Rollback Plan (si problème)

Si quelque chose ne fonctionne pas :

1. **Annuler Code.gs changes**
   - Ouvrir Code.gs history (Undo)
   - Restaurer getDebtsPage() et handleDebtUpsert()
   - NE PAS rollback `backfillDettesTechColumns()` (déjà exécuté, UUIDs utiles)

2. **Vérifier error logs**
   ```sql
   SELECT error_message FROM sync_logs WHERE entity='debts' ORDER BY created_at DESC LIMIT 10;
   ```

3. **Contacter support avec logs**

---

## Logs à Rechercher (Indicateurs de Succès)

### ✅ GOOD - PULL
```
📄 [getDebtsPage] Feuille: Dettes | Cursor: 2 | Limit: 300
📥 [DEBTS] Pull | Tentative 1/2
✅ [DEBTS] Page 1: 15/15 item(s) en XXXms
✅ [DEBTS] Pull paginé terminé: 15 item(s) en 1 page(s)
```

### ✅ GOOD - PUSH
```
💳 [DEBT] 1 dette(s) à envoyer
✅ 1 dette(s) envoyée(s) avec succès
```

### ❌ BAD - Problèmes
```
❌ [getDebtsPage] FEUILLE "Dettes" NON TROUVÉE!
❌ Colonne "date" manquante!
⚠️ Aucune fausse valeur null détectée  (si devrait avoir des données)
Error: syncRepo.pushOutboxBatch is not a function  (ancien bug, pas bloquant)
```

---

## Résumé Checkpoints

| Phase | Checkpoint | Status | Notes |
|-------|-----------|--------|-------|
| 1 | Backfill exécuté | ⏳ | backfillDettesTechColumns() terminé |
| 2 | Sheets _uuid/updated_at remplis | ⏳ | Colonnes visibles dans Sheets |
| 3.1 | PULL FULL retourne dettes | ⏳ | GET debts&full=1 |
| 3.2 | PULL INCR retourne dettes | ⏳ | GET debts&since=... |
| 3.3 | Pagination fonctionne | ⏳ | cursor et limit |
| 4.1 | CREATE dette via POST | ⏳ | Nouvelle ligne Sheets |
| 4.2 | UPDATE dette via POST | ⏳ | Ligne mise à jour |
| 4.3 | Multi-produits pas écrasé | ⏳ | 2 lignes = 2 lignes |
| 5.1 | Electron CREATE → Sheets | ⏳ | Sync logs OK |
| 5.2 | Electron UPDATE → Sheets | ⏳ | Ligne modifiée |
| 5.3 | Sheets PULL → Electron | ⏳ | App mise à jour |

**Legend** : ⏳ = À faire, ✅ = Réussi, ❌ = Échoué

---

**Généré** : 2026-01-03
**Status** : 🟢 PRÊT POUR EXÉCUTION
