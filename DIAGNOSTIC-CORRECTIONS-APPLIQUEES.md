# 🔧 Corrections Pro Appliquées - Produit 1 Affichage

## 📋 Résumé des Problèmes

**Symptômes observés:**
- UI affiche qu'une seule ligne pour le produit 1 (au lieu de 2)
- Marque "MILLIER" s'affiche parfois sur la ligne CARTON
- Les valeurs "glissent" entre lignes

**Causes probables:**
1. Backend `/api/products` renvoie 1 seule unité (GROUP BY incorrect)
2. Collision de clé React (2 lignes ont le même `id` / `key`)

---

## ✅ CORRECTION 1: Diagnostic Immédiat (ProductsPage.jsx - ligne ~263)

**Ajout:** Log automatique après `loadProducts()`

```javascript
// 🔍 DIAGNOSTIC IMMÉDIAT: Vérifier si le backend renvoie bien les unités du produit 1
setTimeout(() => {
  const products_check = useStore.getState().products || [];
  const p1 = products_check.find(p => String(p.code) === "1" || p.id === 1);
  if (p1) {
    console.log('%c🔍 [DIAGNOSTIC] PRODUCT 1 FROM API =', 'color: #f59e0b; font-weight: bold;', p1);
    console.log('%c📊 UNITS LENGTH =', 'color: #f59e0b; font-weight: bold;', p1.units?.length || 0);
    if (p1.units?.length === 1) {
      console.warn('%c⚠️  BACKEND PROBLEM: Seulement 1 unité trouvée (au lieu de 2)\n   → Vérifier la requête /api/products et le GROUP BY', 'color: #ef4444; font-weight: bold;');
    } else if (p1.units?.length === 2) {
      console.log('%c✅ Backend OK: 2 unités trouvées\n   → Si l\'UI affiche mal, c\'est une collision de clé React', 'color: #10b981; font-weight: bold;');
      p1.units.forEach((u, i) => {
        console.log(`   Unit ${i}: level=${u.unit_level}, mark=${u.unit_mark}, uuid=${u.uuid}, id=${u.id}`);
      });
    }
  }
}, 100);
```

**Résultat attendu dans Console (F12):**
- ✅ Si `UNITS LENGTH = 2` → Backend OK, problème React
- ⚠️ Si `UNITS LENGTH = 1` → Vérifier `/api/products` et les GROUP BY

---

## ✅ CORRECTION 2: Clé React Unique et Déterministe (ligne ~524)

**Ancien code:**
```javascript
const stableProductKey = product.id ?? product.code ?? `p${pIndex}`;
const stableUnitKey = unit.uuid ?? unit.id ?? `${unit.unit_level ?? 'U'}-${uIndex}`;
rows.push({
  id: `${stableProductKey}-${stableUnitKey}`, // ❌ Problème: peut avoir collisions
  // ...
});
```

**Nouveau code:**
```javascript
// ✅ Créer une clé VRAIMENT unique et déterministe
const productKey = String(product.code ?? product.id ?? `p${pIndex}`);
const unitKey = String(unit.uuid ?? unit.id ?? `u${uIndex}`);
const rowId = `${productKey}:${unit.unit_level}:${unitKey}`; // Format déterministe

rows.push({
  id: rowId, // ✅ Clé unique par ligne
  // ...
});
```

**Pourquoi ça règle le problème:**
- Inclut `unit.unit_level` (CARTON vs MILLIER) → 2 lignes différentes = 2 clés différentes
- Utilise `uuid` en priorité (plus stable en sync)
- Format déterministe = pas de collision

**Exemple de clés générées:**
- Produit 1, CARTON: `1:CARTON:uuid-xxx`
- Produit 1, MILLIER: `1:MILLIER:uuid-yyy` ← DIFFÉRENT!

---

## ✅ CORRECTION 3: Arrêter d'Effacer 'MILLIER' du Mark (ligne ~526)

**Ancien code:**
```javascript
let normalizedUnitMark = unit.unit_mark ? String(unit.unit_mark).trim() : '';
if (['CARTON', 'MILLIER', 'MILLIER', 'PIECE', 'DETAIL'].includes(normalizedUnitMark.toUpperCase())) {
  normalizedUnitMark = ''; // ❌ EFFACE le vrai mark 'MILLIER' de la BD
}
```

**Nouveau code:**
```javascript
// ✅ Garder le mark RÉEL de la BD
let normalizedUnitMark = String(unit.unit_mark ?? '').trim();
// Optionnel: interdire 'MILLIER' comme mark SUR CARTON seulement (si métier l'exige)
if (unit.unit_level === 'CARTON' && normalizedUnitMark.toUpperCase() === 'MILLIER') {
  normalizedUnitMark = '';
}
```

**Pourquoi c'est important:**
- Si BD a `unit_mark = 'MILLIER'` pour une unité MILLIER → c'est un vrai mark!
- Ancien code l'effaçait → confusion dans les éditions/suggestions
- Nouveau code le garde → UI cohérente avec BD

---

## 🚀 Comment Tester

### 1. Ouvrir DevTools (F12) → Console

### 2. Charger la page Products

### 3. Regarder les logs:

**Cas 1 - Backend OK:**
```
🔍 [DIAGNOSTIC] PRODUCT 1 FROM API = {id: 1, code: "1", units: Array(2), ...}
📊 UNITS LENGTH = 2
✅ Backend OK: 2 unités trouvées
   → Si l'UI affiche mal, c'est une collision de clé React
   Unit 0: level=CARTON, mark=, uuid=..., id=...
   Unit 1: level=MILLIER, mark=MILLIER, uuid=..., id=...
```

**Cas 2 - Backend Problème:**
```
⚠️  BACKEND PROBLEM: Seulement 1 unité trouvée (au lieu de 2)
   → Vérifier la requête /api/products et le GROUP BY
```

### 4. Si Backend OK mais UI affiche mal:
- Inspector (F12) → Elements
- Chercher les `<tr>` avec `key` du produit 1
- Vérifier que les 2 lignes ont des `key` DIFFÉRENTES
- Vérifier que `data-rowid` est unique par ligne

---

## 📊 Diagnostic Complet Checklist

| Test | Résultat | Signification |
|------|----------|---------------|
| Console: UNITS LENGTH === 2 | ✅ OK | Backend envoie 2 unités |
| TableData contains 2 rows for P1 | ✅ OK | React génère 2 objets row |
| Row 1 id: `1:CARTON:...` | ✅ OK | Clé unique pour CARTON |
| Row 2 id: `1:MILLIER:...` | ✅ OK | Clé unique pour MILLIER |
| TableData Row 1 unit_mark: (empty) | ✅ OK | CARTON pas de mark |
| TableData Row 2 unit_mark: MILLIER | ✅ OK | MILLIER a son mark |
| UI affiche 2 lignes | ✅ OK | React affiche bien 2 <tr> |
| Marques à bonne place | ✅ OK | Pas de glissement visuel |

---

## 🔍 Si Ça Ne Marche Toujours Pas

**Étape 1:** Confirmer Backend renvoie 2 unités
```bash
curl "http://localhost:3000/api/products?product_id=1" | python -m json.tool
```
Vérifier que `products[0].units.length === 2`

**Étape 2:** Si OK, vérifier les clés dans React DevTools
```javascript
// Dans Console F12
const rows = document.querySelectorAll('tr[data-rowid]');
rows.forEach(r => console.log(r.getAttribute('data-rowid')));
```
Les 2 lignes du produit 1 doivent avoir 2 rowid DIFFÉRENTS.

**Étape 3:** Contacter dev avec:
- Capture console diagnostic
- Capture du curl backend
- Capture des rowid dans React

---

## 📝 Fichier Modifié

- **ProductsPage.jsx**
  - Ligne ~263: Ajout diagnostic
  - Ligne ~524: Correction clé
  - Ligne ~526: Correction mark

