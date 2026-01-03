# Stock Local vs Sheets: Architecture Offline-First

## 📋 Problème actuel

Les **ventes** ne réduisent PAS le stock LOCAL immédiatement.
- Elles créent juste une `update_stock` dans l'outbox (pour Sheets)
- Si offline longtemps: stock LOCAL ne change pas jusqu'à reconnexion
- Mauvais UX: vendeur voit le stock gonflé

## ✅ Solution: Stock LOCAL toujours correct

### 1. **AutoCheck** (déjà fait ✅)
```
Crée:
  ✅ Réduit stock_current (LOCAL) immédiatement
  ✅ Crée stock_moves (audit)
  ✅ Crée sync_operations (pour Sheets)
  
Offline:
  → Stock LOCAL correct
  → stock_moves en pending
  → Sheets reçoit tout quand online
```

### 2. **Ventes** (À FAIRE ❌)
```
Actuellement:
  ❌ Crée update_stock dans outbox (pour Sheets seulement)
  ❌ Stock LOCAL ne change pas
  
Doit être comme AutoCheck:
  ✅ Réduire stock_current immédiatement (LOCAL)
  ✅ Créer stock_moves (audit: raison='sale')
  ✅ Créer sync_operations (pour Sheets)
  
Offline:
  → Stock LOCAL réduit
  → stock_moves en pending
  → Quand online: Sheets reçoit tous les mouvements
```

### 3. **Void (annulation)** (À FAIRE ❌)
```
Logique inverse de ventes:
  ✅ Augmenter stock_current
  ✅ Créer stock_moves (raison='void')
  ✅ Créer sync_operations
```

---

## 🔄 Flux complet: Offline-first

```
OFFLINE LONGTEMPS (pas Internet)
│
├─ t=0s: Vente créée
│  ├─ Réduit CARTON: 10 → 9 (LOCAL)
│  ├─ Crée stock_move (delta=-1, reason='sale', synced=0)
│  └─ Crée sync_operation (status='pending')
│
├─ t=5s: Autre vente
│  ├─ Réduit CARTON: 9 → 8 (LOCAL)
│  ├─ Crée stock_move
│  └─ Crée sync_operation
│
├─ t=300s: Internet revient
│  ├─ SyncWorker detect online
│  ├─ Lit sync_operations (2 pending)
│  ├─ Envoie les 2 stock_moves à Sheets
│  └─ Sheets reçoit: CARTON: 10→9→8
│
└─ État final:
   LOCAL: CARTON = 8 ✅
   SHEETS: CARTON = 8 ✅
   (Cohérence garantie)
```

---

## 🛠️ Implémentation requise

### Fichier: src/api/routes/sales.routes.js

**Lieu**: Quand une vente est créée (après INSERT dans sales table)

**Ajouter**:
```javascript
// Pour chaque item de la vente:
for (const item of sale.items) {
  // 1. Réduire le stock LOCAL immédiatement
  db.prepare(`
    UPDATE product_units
    SET stock_initial = stock_initial - ?,
        stock_current = stock_current - ?,
        last_update = datetime('now'),
        synced_at = NULL,  ← Force resync
        updated_at = datetime('now')
    WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
  `).run(
    item.qty,  // delta: réduire de la quantité vendue
    item.qty,
    productId,
    item.unit_level,
    item.unit_mark || ''
  );

  // 2. Créer un stock_move (audit trail)
  const moveId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO stock_moves (
      move_id, product_uuid, product_code, unit_level, unit_mark,
      delta, reason, reference_id, 
      stock_before, stock_after, device_id, synced, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?, 0, datetime('now'))
  `).run(
    moveId,
    item.product_uuid,
    item.product_code,
    item.unit_level,
    item.unit_mark || '',
    -item.qty,  ← Négatif (réduction)
    'sale',  ← Raison: vente
    sale.invoice_number,  ← Reference: numéro facture
    stockBefore,
    stockBefore - item.qty,
    device_id
  );

  // 3. Créer une sync_operation (pour Sheets en offline)
  const opId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO sync_operations (
      op_id, op_type, entity_uuid, entity_code, payload_json,
      device_id, status, tries, created_at, updated_at
    ) VALUES (?,?,?,?,?, ?, 'pending', 0, datetime('now'), datetime('now'))
  `).run(
    opId,
    'STOCK_MOVE',  ← Même type que AutoCheck
    item.product_uuid,
    item.product_code,
    JSON.stringify({
      kind: 'SALE',
      invoice_number: sale.invoice_number,
      product: item.product_code,
      unit_level: item.unit_level,
      delta: -item.qty,
      device_id: device_id,
    }),
    device_id
  );
}
```

### Fichier: src/api/routes/sales.routes.js (Void)

**Lieu**: Quand une vente est annulée (void)

**Logique inverse**: +qty au lieu de -qty

```javascript
// 1. Augmenter le stock (restaurer)
db.prepare(`
  UPDATE product_units
  SET stock_initial = stock_initial + ?,
      stock_current = stock_current + ?,
      last_update = datetime('now'),
      synced_at = NULL,
      updated_at = datetime('now')
  WHERE product_id = ? AND unit_level = ? AND unit_mark = ?
`).run(item.qty, item.qty, ...);

// 2. Créer stock_move (delta positif, reason='void')
// 3. Créer sync_operation (status='pending')
```

---

## 📊 Résultat: Cohérence garantie

| Scénario | Stock LOCAL | stock_moves | sync_operations | Sheets |
|----------|------------|-------------|-----------------|--------|
| Online, vente | Réduit ✅ | Créé ✅ | pending → sent → acked ✅ | Reçoit ✅ |
| Offline, vente | Réduit ✅ | Créé ✅ | pending (en attente) | Reçoit quand online ✅ |
| Offline 1h, 10 ventes | Réduit x10 ✅ | 10 créés ✅ | 10 pending | Sheets reçoit les 10 ✅ |
| **Final** | **Correct** ✅ | **Trail complet** ✅ | **Acked** ✅ | **Cohérent** ✅ |

---

## 🔗 Relation avec AutoCheck

**AutoCheck** et **Ventes** doivent utiliser la **MÊME** logique:

```
┌─────────────────────────────┐
│ Événement (AutoCheck/Vente) │
└────────────┬────────────────┘
             │
             ↓
┌─────────────────────────────┐
│ 1. Réduire stock_current    │
│    + synced_at = NULL        │
└────────────┬────────────────┘
             │
             ↓
┌─────────────────────────────┐
│ 2. Créer stock_move         │
│    (audit trail)             │
└────────────┬────────────────┘
             │
             ↓
┌─────────────────────────────┐
│ 3. Créer sync_operation     │
│    (status='pending')        │
└────────────┬────────────────┘
             │
             ↓
┌─────────────────────────────┐
│ SyncWorker push quand online│
│ Sheets ack                   │
└─────────────────────────────┘
```

---

## 📝 Avantages

✅ **Stock LOCAL toujours à jour** (vendeur voit correct)
✅ **Offline-first**: fonctionne sans Internet
✅ **Audit trail complet**: chaque mouvement tracé
✅ **Sync robuste**: Sheets rattrape quand online
✅ **Pas de doublon**: sync_operations idempotentes (op_id unique)
✅ **Cohérence garantie**: LOCAL = SHEETS toujours

---

## 🚀 Priorité

1. ✅ AutoCheck (déjà fait)
2. ❌ Ventes (À FAIRE)
3. ❌ Void (À FAIRE)
4. ❌ Autres mouvements (adjustments, returns, etc.)

