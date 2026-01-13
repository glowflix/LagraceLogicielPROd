# 🔍 Débugage du Problème de Doublons STOCK_MOVE

## Problème Signalé
Les mouvements de stock (`STOCK_MOVE`) sont réduits DEUX FOIS pour la même vente, causant une désynchronisation.

**Cause Probable**: Les opérations `STOCK_MOVE` ne sont jamais marquées comme "acked" après confirmation par Sheets, ce qui les fait renvoyer à chaque cycle de sync.

## Amélorations Apportées

### 1. Logs Agressifs Ajoutés

#### Dans `enqueueSale()` (outbox.repo.js)
- Affiche les STOCK_MOVE créées avec leurs op_ids
- Montre le stock avant/après pour chaque item

#### Dans `getPendingOperations()` (outbox.repo.js)
- Affiche le nombre d'opérations pending trouvées par type

#### Dans `pushStockMoves()` (sync.worker.js)
- Affiche les opérations reçues et leurs op_ids
- Affiche les opérations créées pour Sheets
- Affiche la réponse complète de Sheets (success, applied, failed, stats)
- Affiche les op_ids qui vont être marquées acked
- Affiche confirmation du marquage acked

### 2. Protection Ajoutée

Dans `pushStockMoves()` ligne 889-904:
```javascript
if (ackedOpIds.length > 0) {
  console.log(`   📌 [MARK-ACKED] Marking ${ackedOpIds.length} ops: ${ackedOpIds.join(', ')}`);
  try {
    outboxRepo.markAsAcked(ackedOpIds);
    console.log(`   ✅ [MARK-ACKED] ${ackedOpIds.length} ops marked as acked successfully`);
  } catch (ackErr) {
    console.log(`   ❌ [MARK-ACKED] ERREUR: ${ackErr.message}`);
    syncLogger.error(`[STOCK] Error marking as acked: ${ackErr.message}`);
  }
}
```

## Comment Tester

### 1. Démarrer le Backend
```bash
npm run dev
```

### 2. Créer une Vente
Via l'interface SalesPOS, créer une vente avec au moins 1 item.

### 3. Vérifier les Logs

Vous devriez voir dans le terminal:

```
═══════════════════════════════════════════════════════════════════
📤 [OUTBOX] ENQUEUE VENTE + STOCK_MOVE POUR SYNC SHEETS
═══════════════════════════════════════════════════════════════════
   📄 Facture: INV-2026-0123
   📦 Items: 1
═══════════════════════════════════════════════════════════════════
   📦 PRODUIT-A (Product Name)
      └─ CARTON: 100 → 95 (delta: -5)
      └─ STOCK_MOVE pending (stock_absolute: 95)
───────────────────────────────────────────────────────────────────
✅ [OUTBOX] Vente INV-2026-0123 enqueued
   📊 STOCK_MOVE créés: 1/1
   ⏳ Sync vers Sheets dans ~10 secondes...
═══════════════════════════════════════════════════════════════════
```

### 4. Vérifier la Synchronisation

Attendez 10-20 secondes. Vous devriez voir:

```
═══════════════════════════════════════════════════════════════════
📤 [SYNC] PUSH STOCK_MOVE VERS GOOGLE SHEETS
═══════════════════════════════════════════════════════════════════
   📦 Mouvements reçus: 1
   🆔 Op IDs reçus: 12345-67890-abcdef
═══════════════════════════════════════════════════════════════════

   📦 PRODUIT-A/CARTON: stock_absolute=95
───────────────────────────────────────────────────────────────────
   🚀 Envoi de 1 opération(s) vers Sheets...

   📡 RÉPONSE de Sheets:
      success: true
      applied: 1
      failed: 0
      conflicts: 0
      stats: {"received":1,"skipped":0,"applied":1}

   ✅ SUCCÈS! 1 opération(s) (1 applied)
   ✅ ackIds à marquer: 12345-67890-abcdef
═══════════════════════════════════════════════════════════════════

   📌 [MARK-ACKED] ackedOpIds.length = 1
   📌 [MARK-ACKED] Marking 1 ops: 12345-67890-abcdef
   ✅ [MARK-ACKED] 1 ops marked as acked successfully
```

### 5. Vérifier la Base de Données

Exécutez:
```sql
SELECT op_id, op_type, status, created_at, updated_at
FROM sync_operations
WHERE op_type = 'STOCK_MOVE'
ORDER BY created_at DESC
LIMIT 10;
```

**Résultat Attendu**: Le status devrait être `'acked'`, pas `'pending'`

```
op_id                          | op_type    | status | created_at          | updated_at
12345-67890-abcdef            | STOCK_MOVE | acked  | 2026-01-09 14:30:00 | 2026-01-09 14:30:15
```

### 6. Créer une Deuxième Vente

Créez une autre vente pour le même produit.

**Résultat Attendu**: 
- ✅ Le stock ne devrait être réduit qu'UNE FOIS
- ✅ Les logs doivent montrer une nouvelle opération STOCK_MOVE distinct
- ✅ L'ancienne opération ne devrait PAS être renvoyée

## Fichiers Modifiés

1. **src/services/sync/sync.worker.js**
   - Ligne 730: Logs des mouvements reçus
   - Ligne 823-827: Logs de la réponse Sheets
   - Ligne 851-854: Logs des ackIds
   - Ligne 889-904: Logs du marquage acked avec try/catch

2. **src/db/repositories/outbox.repo.js**
   - Ligne 783-786: Logs des opérations pending trouvées

## Troubleshooting

### Symptôme: "Aucune opération à marquer!"
**Cause**: `ackedOpIds.length === 0`, ce qui veut dire que les op_ids ne sont pas extraites du payload.
**Vérifier**: 
- Que `op.payload.op_ids` est bien défini
- Que les opérations STOCK_MOVE contiennent des op_ids dans leur payload JSON

### Symptôme: "ERREUR: markAsAcked"
**Cause**: Exception dans outboxRepo.markAsAcked()
**Vérifier**: 
- Que la transaction SQL fonctionne
- Que les op_ids sont valides (UUID format)

### Symptôme: Stocks réduits 2x malgré tout
**Cause Possible 1**: Les STOCK_MOVE ne sont pas créées du tout (enqueueSale() échoue silencieusement)
**Vérifier**: Les logs de "STOCK_MOVE créés: X/Y" dans enqueueSale()

**Cause Possible 2**: Sheets retourne une erreur
**Vérifier**: Le champ `success` dans la réponse Sheets

**Cause Possible 3**: Les opérations sont marquées error au lieu de acked
**Vérifier**: Le log "markAsError" dans les erreurs

## Prochaines Étapes

1. Testez le système avec les logs
2. Rapportez les logs exactement affichés
3. Vérifiez la base de données SQL
4. Si le problème persiste, on cherchera plus loin

