# 🔧 FIX CRITIQUE: unit_mark: null - Perte du Mark pendant la sauvegarde

## 🔴 Problème identifié

Quand tu modifies le MARK d'une unité, il devient `null` dans le backend alors qu'il devrait avoir la valeur que tu as tapée.

### Root cause 1: Delete prématuré (PRINCIPAL)
```javascript
// ❌ AVANT - C'est le coupable!
setEditingValues((prev) => {
  const copy = { ...prev };
  delete copy[rowId];  // ← ça supprime unit_mark qu'on vient de taper!
  return copy;
});
```

**Scénario qui montre le bug:**
```
1. Utilisateur modifie PRIX (auto-save) → scheduleSave déclenché
2. PENDANT que la requête est en cours:
   - Utilisateur tape MARK = "PQT"
3. Sauvegarde prix se termine, et fait delete copy[rowId]
   - ❌ Cela supprime aussi unit_mark: "PQT" qu'on vient de taper!
4. La sauvegarde suivante voit unit_mark: undefined
5. Backend reçoit null → enregistre null
```

### Root cause 2: Auto-save non déclenché
```javascript
// ❌ AVANT - unit_mark n'est pas dans AUTO_SAVE_FIELDS
const AUTO_SAVE_FIELDS = new Set([
  'sale_price_fc',
  'sale_price_usd',
  'purchase_price_usd',
  'stock_current',
  'auto_stock_factor'
  // unit_mark ABSENT → dépend uniquement du blur/Enter (fragile!)
]);
```

Si le blur n'est pas déclenché proprement, le mark ne parte jamais.

---

## ✅ Solutions appliquées

### 1️⃣ Ajouter unit_mark + product_name à AUTO_SAVE_FIELDS

**Avant:**
```javascript
const AUTO_SAVE_FIELDS = new Set([
  'sale_price_fc',
  'sale_price_usd',
  'purchase_price_usd',
  'stock_current',
  'auto_stock_factor'
]);
```

**Après:**
```javascript
const AUTO_SAVE_FIELDS = new Set([
  'sale_price_fc',
  'sale_price_usd',
  'purchase_price_usd',
  'stock_current',
  'auto_stock_factor',
  'unit_mark',      // ✅ AJOUT
  'product_name'    // ✅ AJOUT (bonus)
]);
```

**Impact:** Dès que tu tapes dans le Mark, `scheduleSave(rowId)` est appelé avec debounce 2s. Beaucoup plus robuste que blur.

---

### 2️⃣ Augmenter le cache visuel et ajouter TTL personnalisé

**Avant:**
```javascript
const setVisualForRow = useCallback((rowId, patch) => {
  // ...
  const t = setTimeout(() => { ... }, 3500);  // ← 3.5s fixe
}, []);
```

**Après:**
```javascript
const setVisualForRow = useCallback((rowId, patch, ttlMs = 8000) => {
  // ...
  const t = setTimeout(() => { ... }, ttlMs);  // ✅ TTL paramétrable
}, []);
```

**Changement dans savePendingChanges:**
```javascript
// ✅ 8s pour le cache visuel au lieu de 3.5s
setVisualForRow(rowId, patch, 8000);
```

**Impact:** 
- L'utilisateur voit son Mark pendant 8 secondes après avoir tapé
- Même si Sheets recharge, le Mark reste visible localement

---

### 3️⃣ Cache visuel IMMÉDIAT au blur/Enter du champ Mark

**Avant:**
```javascript
onBlur={() => {
  setTimeout(() => {
    if (row?.id) {
      scheduleSave(row.id);
    }
    setEditingCell(null);
    setFocusedField(null);
  }, 50);
}}
```

**Après:**
```javascript
onBlur={() => {
  const v = (document.activeElement?.value || '');
  const vNorm = String(v ?? '').trim();

  // ✅ cache visuel immédiat 8s
  if (vNorm) {
    setVisualForRow(row.id, { unit_mark: vNorm }, 8000);
  }

  setTimeout(() => {
    if (row?.id) {
      scheduleSave(row.id);
    }
    setEditingCell(null);
    setFocusedField(null);
  }, 50);
}}
```

**Même chose pour onKeyPress (Enter):**
```javascript
onKeyPress={(e) => {
  if (e.key === 'Enter') {
    const v = e.currentTarget.value;
    const vNorm = String(v ?? '').trim();

    // ✅ cache visuel immédiat 8s
    if (vNorm) {
      setVisualForRow(row.id, { unit_mark: vNorm }, 8000);
    }

    if (row?.id) {
      scheduleSave(row.id);
    }
    setEditingCell(null);
    setFocusedField(null);
  }
}}
```

**Impact:**
- L'utilisateur VOIT IMMÉDIATEMENT le Mark qu'il tape
- Même avant la requête réseau
- Pendant 8 secondes, il restera affiché

---

### 4️⃣ Ne pas supprimer editingValues si du pending

**Avant:**
```javascript
// ❌ PROBLÈME: supprime même si d'autres changements arrivent pendant le save
setEditingValues((prev) => {
  const copy = { ...prev };
  delete copy[rowId];
  return copy;
});
```

**Après:**
```javascript
// ✅ Solution: Garder les edits si du pending
setEditingValues((prev) => {
  // ✅ Si pendant la requête il reste des changements, on ne supprime pas
  if (pendingSavesRef.current.has(rowId)) return prev;

  const copy = { ...prev };
  delete copy[rowId];
  return copy;
});
```

**Impact:** 
- Ton unit_mark ne sera PAS supprimé si tu continues à modifier pendant la sauvegarde
- La prochaine itération de savePendingChanges verra l'unit_mark et l'enverra

---

### 5️⃣ Normaliser unit_mark avant l'envoi

**Avant:**
```javascript
if (edits.unit_mark !== undefined) unitUpdates.unit_mark = edits.unit_mark;
```

**Après:**
```javascript
if (edits.unit_mark !== undefined) {
  unitUpdates.unit_mark = normalizeMark(edits.unit_mark);  // ✅ trim + null si vide
}
```

**Ce que normalizeMark fait:**
```javascript
const normalizeMark = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;  // Vide → null (pas "" vide)
};
```

**Impact:**
- "PQT " (avec espace) → "PQT" (trimé)
- "" (vide) → null (intentionnel)
- Cohérent avec la DB

---

### 6️⃣ Debug log pour vérifier le payload

**Ajout dans handleUpdateProduct:**
```javascript
// ✅ DEBUG: Vérifier que unit_mark est bien dans le payload
if (IS_DEV) {
  const targetUnit = updatedUnits.find(u => u.id === row.unit_id);
  console.log('📋 [handleUpdateProduct] DEBUG unit_mark:');
  console.log('   ├─ edits.unit_mark (raw):', edits?.unit_mark);
  console.log('   ├─ unitUpdates.unit_mark:', unitUpdates.unit_mark);
  console.log('   └─ payload.unit_mark:', targetUnit?.unit_mark);
}
```

**À voir dans la console:**
```
📋 [handleUpdateProduct] DEBUG unit_mark:
   ├─ edits.unit_mark (raw): "PQT"
   ├─ unitUpdates.unit_mark: "PQT"
   └─ payload.unit_mark: "PQT"
```

Si tu vois `null` à l'une de ces étapes, tu sais où est le problème.

---

## 🧪 Test de validation (30 sec)

### Test 1: Tap Mark normalement
```
1. Clique sur la cellule Mark
2. Type: PQT
3. Press Enter
4. Attends 2 secondes (debounce)
5. Vérifier console: 
   - Tu dois voir: "edits.unit_mark: PQT"
   - Payload doit avoir: "unit_mark": "PQT"
6. Vérifier Google Sheets dans 10s
   - Mark doit être "PQT" (pas null)
```

### Test 2: Modify Prix PUIS Mark
```
1. Modify Prix FC (déclenche auto-save immédiatement)
2. PENDANT que la requête est en cours, tap Mark: "ABC"
3. UI affiche "ABC" immédiatement pendant 8s (cache visuel)
4. Attends 2s (debounce Mark)
5. Vérifier console: 
   - Doit avoir: "unit_mark": "ABC"
6. Vérifier Google Sheets
   - Mark DOIT être "ABC" (le vrai test!)
```

### Test 3: Leave Mark empty (intentionnel)
```
1. Clear la cellule Mark (la laisser vide)
2. Press Enter
3. Attends 2s
4. Vérifier console: 
   - Doit avoir: "unit_mark": null (pas vide string)
5. Vérifier Google Sheets
   - Mark doit être null (vide)
```

---

## 📊 Résumé des changements

| Aspect | Avant | Après | Impact |
|--------|-------|-------|--------|
| **unit_mark en AUTO_SAVE** | ❌ Non | ✅ Oui | Debounce 2s au lieu d'attendre blur |
| **Cache visuel TTL** | ❌ 3.5s fixe | ✅ 8s paramétrable | L'utilisateur voit plus longtemps |
| **Cache immédiat blur/Enter** | ❌ Non | ✅ Oui | Voir le Mark avant même la requête |
| **Delete prématuré** | ❌ Supprime même si pending | ✅ Garde si pending | unit_mark ne se perd plus |
| **Normalisation** | ❌ Pas de trim | ✅ trim + null | Pas de valeurs "fantômes" |
| **Debug log** | ❌ Non | ✅ Oui dans DEV | Diagnostic facile |

---

## 🎯 Résultat attendu

Quand tu modifies le Mark:

1. ✅ Cache visuel immédiat (avant requête)
2. ✅ Auto-save déclenché (debounce 2s)
3. ✅ PUT avec `"unit_mark": "PQT"`
4. ✅ Backend reçoit "PQT" (pas null)
5. ✅ Google Sheets affiche "PQT"
6. ✅ L'utilisateur voit "PQT" pendant 8 secondes post-save

**Status**: ✅ **DÉPLOYÉ**

