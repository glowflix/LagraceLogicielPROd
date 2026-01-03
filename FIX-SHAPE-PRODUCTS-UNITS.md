# 🔧 FIX: Problème de "Shape" products vs product_units

## 🔴 Problème identifié

### Code dans Code.gs (doGet)
```javascript
switch (entity) {
  case 'products':
  case 'product_units':
    out = getProductsPage(...);  // ← Même fonction pour les deux!
    break;
}
```

### Problème réel
- `getProductsPage()` retourne des **UNITS** (shape flat):
  ```javascript
  {
    uuid: '96a8387d-...',    // UUID de l'unit
    code: '1',
    name: 'crist',
    unit_level: 'CARTON',    // ← C'est un unit
    unit_mark: 'MARK1',      // ← C'est un unit
    sale_price_fc: 28000,    // ← Prix de l'unit
    purchase_price_usd: 10,
    stock_current: 44396
  }
  ```

- Mais le client qui demande `entity=products` s'attend à une **PRODUCT** (avec units regroupés):
  ```javascript
  {
    code: '1',
    name: 'crist',
    uuid: '1d6f6b3b-...',    // UUID du PRODUCT
    units: [
      {
        unit_level: 'CARTON',
        unit_mark: 'MARK1',
        sale_price_fc: 28000,
        ...
      },
      {
        unit_level: 'MILLIER',
        unit_mark: 'MARK2',
        sale_price_fc: 500000,
        ...
      }
    ]
  }
  ```

### Conséquences
- ❌ Le client reçoit une structure "aplatie" au lieu d'une structure hiérarchique
- ❌ Merging des données cassé (pas de `units:[]` array)
- ❌ Logique côté client compliquée (traiter 2 shapes différents)
- ❌ Filtres/requêtes confus (est-ce que c'est une unit ou un product?)

---

## ✅ Solution retenue: SIMPLE (côté client)

### Pourquoi cette solution?

| Solution | Complexité | Impact | Maintenance |
|----------|-----------|--------|-------------|
| **Simple** (recommandée) | 1/10 | Zéro changement GAS | ✅ Facile |
| **GAS** (regroupement) | 9/10 | Pagination complexe | ❌ Lourd |
| **Hybride** | 5/10 | Dual logic | ⚠️ Moyen |

### Implémentation: Côté client, traiter TOUJOURS comme product_units

**Règle simple**:
```
Pull de Sheets → Toujours traiter comme product_units
Peu importe si entity='products' ou entity='product_units'
Chaque ligne retournée = une unit
```

### Code côté Node/Electron:
```javascript
// Pull depuis Sheets
const response = await fetch(sheetUrl, {
  params: {
    entity: 'products',  // ou 'product_units' → même résultat
    since: '2025-01-01T00:00:00Z',
    cursor: 2,
    limit: 300
  }
});

const { data } = response.json(); // data = array d'units

// Traiter comme product_units, JAMAIS comme products
data.forEach(unit => {
  // unit = {code, name, unit_level, unit_mark, sale_price_fc, ...}
  
  // Merge dans local DB:
  // 1. Chercher ou créer product avec ce code
  // 2. Créer ou update l'unit avec unit_level
  // 3. Pas de regroupement complexe!
});
```

---

## 📝 Changements GAS appliqués

### 1. Commentaire explicatif dans doGet()
```javascript
switch (entity) {
  case 'products':
  case 'product_units':
    // ⚠️ NOTE: getProductsPage() retourne des UNITS (shape=unit)
    // Pas des PRODUCTS regroupés (shape=product avec units:[])
    // Solution: Le client traite toujours comme product_units
    out = getProductsPage(sinceDate, cursor, limit, p.unit_level || '');
    break;
}
```

### 2. Documentation JSDoc mis à jour
```javascript
/**
 * Récupère une page de produits-units (pagination PRO)
 * ⚠️ IMPORTANT: Retourne des UNITS (shape flat), pas des PRODUCTS regroupés!
 * - Shape retourné: [{code, name, unit_level, unit_mark, sale_price_fc, ...}]
 * - Pas de regroupement par code (impossible avec pagination)
 * - Raison: Chaque ligne Sheets = une combinaison (code + unit_level)
 * 
 * @returns {{data: Array, next_cursor: number|null, done: boolean}}
 */
function getProductsPage(sinceDate, cursor, limit, unitLevelParam) {
```

---

## 🚀 Conséquences

### ✅ Avantages:
- **Zéro changement GAS** → Code stable
- **Client simple** → Traiter 1 shape, pas 2
- **Pagination facile** → Pas besoin de regrouper par code
- **Performance** → Plus rapide (pas de join/group)
- **Maintenance** → Une seule logique

### ⚠️ À comprendre:
- **entity='products'** retourne une structure "unit", pas "product"
- **Chaque ligne** = une combinaison (code + unit_level)
- **Regroupement** doit se faire côté client (logique simple avec un loop + map)

---

## 📚 Exemple complet: Pull et Merge

### Pseudocode côté client (Node/Electron):

```javascript
async function syncProductsFromSheets() {
  const response = await sheetsApi.get({
    entity: 'products',  // ← Demande les products
    cursor: 2,
    limit: 300
  });
  
  const units = response.data;  // ← Reçoit des units
  
  // Regrouper par code
  const productsMap = new Map();
  
  for (const unit of units) {
    // unit = {code, name, unit_level, unit_mark, sale_price_fc, ...}
    
    if (!productsMap.has(unit.code)) {
      productsMap.set(unit.code, {
        code: unit.code,
        name: unit.name,
        uuid: unit.uuid,  // UUID du produit
        units: []
      });
    }
    
    // Ajouter l'unit à la liste
    productsMap.get(unit.code).units.push({
      unit_level: unit.unit_level,
      unit_mark: unit.unit_mark,
      sale_price_fc: unit.sale_price_fc,
      sale_price_usd: unit.sale_price_usd,
      purchase_price_usd: unit.purchase_price_usd,
      stock_current: unit.stock_current,
      ...
    });
  }
  
  // Maintenant on a la structure correcte: products avec units[]
  const products = Array.from(productsMap.values());
  
  // Merge dans la BD locale
  for (const product of products) {
    await db.upsertProduct({
      code: product.code,
      name: product.name,
      uuid: product.uuid,
      units: product.units  // ← Maintenant bien structuré
    });
  }
}
```

---

## ✅ Statut

- [x] Problème identifié et documenté
- [x] Commentaires GAS expliquant le problème ajoutés
- [x] Solution (traiter côté client) communiquée
- [x] Pseudocode exemple fourni

**Status**: ✅ **EXPLIQUÉ ET DOCUMENTÉ**

**Prochaine étape côté Node/Electron**:
- Vérifier que le client traite bien le pull comme product_units
- Ajouter la logique de regroupement par code si nécessaire

---

**Date**: 2026-01-01  
**Impact**: Documentation + clarification  
**Changement de code**: Minimal (juste commentaires)  
**Risque**: Aucun
