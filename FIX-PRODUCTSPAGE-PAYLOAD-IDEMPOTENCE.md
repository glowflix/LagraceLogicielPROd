# 🔧 FIX: ProductsPage.jsx - Payload propre + last_update + Idempotence

## 📋 Problèmes corrigés

### 1. last_update ne bouge jamais
**Avant:** Modification du produit mais `last_update` n'était pas modifié  
**Après:** Bump `last_update` à `nowISO()` lors de chaque modification  
→ Sync peut détecter les changements ("dirty" detection)

### 2. synced_at remis à null
**Avant:** `synced_at` gardait l'ancienne valeur après modification  
**Après:** `synced_at: null` lors de chaque modification pour signaler "pas encore synchronisé"

### 3. Payload sale_price_fc en trop
**Avant:** Envoyer `sale_price_fc` au backend, qui ne savait pas si c'était obsolète  
**Après:** Utiliser `buildUnitPayload()` qui exclut sale_price_fc (backend le calcule depuis USD)

### 4. Created_at/updated_at dans le payload
**Avant:** Envoyer tous les champs y compris les read-only  
**Après:** Utiliser `omitUndefined()` pour envoyer seulement les champs nécessaires

### 5. Champs numériques mal parsés
**Avant:** Parser manuel avec `parseFloat()` sans vérification  
**Après:** `toNumberSafe()` garantit un nombre ou une valeur par défaut

### 6. existingCarton: POST au lieu de PUT
**Avant:** 
```javascript
await axios.post(`${API_URL}/api/products`, {...})  // ❌ crée au lieu de mettre à jour
```
**Après:**
```javascript
await axios.put(`${API_URL}/api/products/${productKey}`, {...})  // ✅ met à jour proprement
```

### 7. handleUpdateProduct manquait last_update
**Avant:** Mettre à jour le produit sans bumper last_update  
**Après:** Bump last_update et synced_at=null à chaque update

### 8. Auth dans catch n'existait pas
**Avant:** 
```javascript
} catch (error) {
  console.error('   Headers envoyés:', auth);  // ❌ auth n'existe pas ici!
}
```
**Après:** Déclarer `auth` au début de la fonction pour le rendre dispo dans catch

### 9. UI post-save affichage immédiat
**Avant:** Attendre le reload complet avant de voir les changements  
**Après:** `setVisualForRow()` affiche les changements immédiatement pendant 3.5s

---

## ✅ Changements appliqués

### 1. Ajouter helpers (lignes ~298-375)

```javascript
// ✅ HELPERS: Payload normalization + bump last_update
const nowISO = () => new Date().toISOString();

const normalizeMark = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

const omitUndefined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const toNumberSafe = (v, fallback = 0) => {
  const s = String(v ?? '').trim();
  if (s === '') return fallback;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

const buildUnitPayload = (u, overrides = {}) => {
  const merged = { ...u, ...overrides };
  return omitUndefined({
    id: merged.id,
    unit_level: merged.unit_level,
    unit_mark: normalizeMark(merged.unit_mark),
    stock_initial: merged.stock_initial !== undefined ? toNumberSafe(...) : undefined,
    stock_current: merged.stock_current !== undefined ? toNumberSafe(...) : undefined,
    purchase_price_usd: merged.purchase_price_usd !== undefined ? toNumberSafe(...) : undefined,
    sale_price_usd: merged.sale_price_usd !== undefined ? toNumberSafe(...) : undefined,
    auto_stock_factor: merged.auto_stock_factor !== undefined ? Math.round(toNumberSafe(...)) : undefined,
    qty_step: merged.qty_step !== undefined ? Math.round(toNumberSafe(...)) : undefined,
    extra1: merged.extra1 ?? null,
    extra2: merged.extra2 ?? null,
    uuid: merged.uuid,
    last_update: merged.last_update || nowISO(),
    synced_at: merged.synced_at ?? null,
  });
};

const getProductKeyFromRow = (row) => row?.product_id ?? row?.product_code;

const setVisualForRow = useCallback((rowId, patch) => {
  setVisualValues((prev) => ({
    ...prev,
    [rowId]: { ...(prev[rowId] || {}), ...patch },
  }));
  const old = visualValuesTimeoutsRef.current.get(rowId);
  if (old) clearTimeout(old);
  const t = setTimeout(() => {
    setVisualValues((prev) => {
      const copy = { ...prev };
      delete copy[rowId];
      return copy;
    });
    visualValuesTimeoutsRef.current.delete(rowId);
  }, 3500);
  visualValuesTimeoutsRef.current.set(rowId, t);
}, []);
```

### 2. Corriger existingCarton (ligne ~735)

**Avant:**
```javascript
if (existingCarton) {
  const code = existingCarton.code;
  const name = existingCarton.name;
  const existingUnits = existingCarton.units || [];
  const newUnit = { ... };
  await axios.post(`${API_URL}/api/products`, {
    code, name,
    units: [...existingUnits, newUnit]
  }, getAuthHeaders());
}
```

**Après:**
```javascript
if (existingCarton) {
  const auth = getAuthHeaders();
  const productKey = existingCarton.id ?? existingCarton.code;
  
  let currentProduct = existingCarton;
  try {
    const r = await axios.get(`${API_URL}/api/products/${productKey}`, auth);
    currentProduct = r.data;
  } catch {
    // fallback
  }
  
  const now = nowISO();
  const newUnit = buildUnitPayload({
    unit_level: unitLevel,
    unit_mark: edits?.unit_mark ?? '',
    stock_current: toNumberSafe(edits?.stock_current, 0),
    purchase_price_usd: toNumberSafe(edits?.purchase_price_usd, 0),
    sale_price_usd: salePriceUSD,
    auto_stock_factor: toNumberSafe(edits?.auto_stock_factor, 1),
    qty_step: 1,
    extra1: null,
    extra2: null,
  }, { last_update: now, synced_at: null });
  
  const safeUnits = (currentProduct.units || []).map((u) => buildUnitPayload(u));
  safeUnits.push(newUnit);
  
  const payload = {
    name: currentProduct.name,
    units: safeUnits,
  };
  
  await axios.put(`${API_URL}/api/products/${productKey}`, payload, auth);  // ✅ PUT!
  return;
}
```

### 3. Remplacer handleUpdateProduct (ligne ~874)

**Avant:** 200 lignes de code complexe avec erreurs  
**Après:** Version épurée et robuste

```javascript
const handleUpdateProduct = useCallback(async (row, edits) => {
  if (!row || row.is_empty) return;

  const auth = getAuthHeaders();  // ✅ Dispo dans catch aussi
  const productKey = getProductKeyFromRow(row);
  if (!productKey) {
    throw new Error('Produit invalide: product_id / product_code manquant');
  }

  const unitUpdates = {};
  let productNameUpdate;

  // Prix: si FC modifié => calcul USD; sinon si USD modifié => USD direct
  if (edits.sale_price_fc !== undefined) {
    const fc = toNumberSafe(edits.sale_price_fc, NaN);
    if (!Number.isFinite(fc)) return;
    unitUpdates.sale_price_usd = calculateUSD(fc);
  } else if (edits.sale_price_usd !== undefined) {
    const usd = toNumberSafe(edits.sale_price_usd, NaN);
    if (!Number.isFinite(usd)) return;
    unitUpdates.sale_price_usd = usd;
  }

  if (edits.stock_current !== undefined) unitUpdates.stock_current = toNumberSafe(edits.stock_current, 0);
  if (edits.purchase_price_usd !== undefined) unitUpdates.purchase_price_usd = toNumberSafe(edits.purchase_price_usd, 0);
  if (edits.auto_stock_factor !== undefined) unitUpdates.auto_stock_factor = Math.round(toNumberSafe(edits.auto_stock_factor, 1));
  if (edits.unit_mark !== undefined) unitUpdates.unit_mark = edits.unit_mark;
  if (edits.product_name !== undefined) productNameUpdate = String(edits.product_name ?? '').trim();

  try {
    const productResponse = await axios.get(`${API_URL}/api/products/${productKey}`, auth);
    const currentProduct = productResponse.data;
    const now = nowISO();

    // ✅ bump last_update + synced_at=null uniquement pour l'unité ciblée
    const updatedUnits = (currentProduct.units || []).map((u) => {
      if (u?.id === row.unit_id) {
        const merged = { ...u, ...unitUpdates };
        return buildUnitPayload(merged, { last_update: now, synced_at: null });
      }
      return buildUnitPayload(u);  // autres unités: payload propre, sans bump
    });

    const updatePayload = {
      name: productNameUpdate || currentProduct.name,
      units: updatedUnits,
    };

    if (IS_DEV) {
      console.log(`📤 [ProductsPage] PUT /api/products/${productKey}`);
      console.log('   Payload:', JSON.stringify(updatePayload, null, 2));
    }

    const response = await axios.put(`${API_URL}/api/products/${productKey}`, updatePayload, auth);

    if (IS_DEV) {
      console.log('✅ [ProductsPage] Produit mis à jour:', response.data);
    }

  } catch (error) {
    if (IS_DEV) {
      console.error('❌ [ProductsPage] Erreur mise à jour produit:', error);
      console.error('   Status:', error.response?.status);
      console.error('   Message:', error.response?.data?.error || error.message);
      console.error('   productKey:', productKey);
    }
    throw error;
  }
}, [getAuthHeaders, calculateUSD, buildUnitPayload, getProductKeyFromRow]);
```

### 4. Ajouter post-save visuel dans savePendingChanges

Après chaque `handleUpdateProduct()` réussi:
```javascript
.then(() => {
  // ✅ UI post-save: afficher tout de suite les valeurs
  const lastPriceField = lastPriceEditedRef.current.get(rowId);
  const patch = {};

  if (edits.product_name !== undefined) patch.product_name = String(edits.product_name ?? '');
  if (edits.unit_mark !== undefined) patch.unit_mark = edits.unit_mark;
  if (edits.stock_current !== undefined) patch.stock_current = toNumberSafe(edits.stock_current, 0);
  if (edits.purchase_price_usd !== undefined) patch.purchase_price_usd = toNumberSafe(edits.purchase_price_usd, 0);

  if (lastPriceField === 'sale_price_fc' && edits.sale_price_fc !== undefined) {
    const fc = toNumberSafe(edits.sale_price_fc, 0);
    patch.sale_price_fc = fc;
    patch.sale_price_usd = calculateUSD(fc);
  }
  if (lastPriceField === 'sale_price_usd' && edits.sale_price_usd !== undefined) {
    const usd = toNumberSafe(edits.sale_price_usd, 0);
    patch.sale_price_usd = usd;
    patch.sale_price_fc = calculateFC(usd);
  }

  setVisualForRow(rowId, patch);

  // ✅ nettoyer l'état d'édition après save
  setEditingValues((prev) => {
    const copy = { ...prev };
    delete copy[rowId];
    return copy;
  });
})
```

---

## 🎯 Impact

| Aspect | Avant | Après |
|--------|-------|-------|
| **last_update** | ❌ Ne change jamais | ✅ Bumé à chaque modif |
| **synced_at** | ❌ Garde ancienne valeur | ✅ Remis à null |
| **sale_price_fc** | ❌ Envoyée au backend | ✅ Exclus (backend la calcule) |
| **Read-only fields** | ❌ Envoyées en payload | ✅ Exclues avec omitUndefined |
| **Nombres** | ❌ Parsing fragile | ✅ toNumberSafe robuste |
| **existingCarton** | ❌ POST (création) | ✅ PUT (mise à jour) |
| **Auth en catch** | ❌ auth undefined | ✅ auth défini au départ |
| **UI post-save** | ❌ Attendre reload | ✅ Affichage immédiat 3.5s |
| **Produit_id vs code** | ❌ Utilise toujours code | ✅ Préfère ID (plus sûr) |

---

## ✨ Bénéfices

1. ✅ **Sync sait quand changement**: last_update change = backend peut détecter
2. ✅ **Produits jamais re-créés**: existingCarton utilise PUT
3. ✅ **Payload propre**: Pas de champs read-only
4. ✅ **Nombres fiables**: toNumberSafe gère les cas limites
5. ✅ **UX instantanée**: Voir les changements pendant 3.5s post-save
6. ✅ **Code lisible**: buildUnitPayload centralise la logique

---

## 🚀 Test

1. Modifier un nom de produit
   - UI affiche changement immédiatement
   - last_update bumpé dans DB
   - synced_at remis à null
   
2. Modifier un prix FC
   - USD calculé automatiquement
   - Payload envoie uniquement USD
   - Backend recalcule FC depuis USD
   
3. Ajouter une MILLIER/PIECE à CARTON existant
   - PUT au lieu de POST
   - Toutes les unités conservées
   - last_update bumpé

**Status**: ✅ **DÉPLOYÉ**

