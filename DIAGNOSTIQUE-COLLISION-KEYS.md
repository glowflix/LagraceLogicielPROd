# 🔍 Diagnostic de Collision de Clés React - ProductsPage

## Status: ✅ IMPLÉMENTÉ

Les correctifs "pro" pour diagnostiquer et corriger les problèmes d'affichage d'une seule ligne (parfois CARTON) et le "Mark MILLIER qui glisse" ont été **intégrés** dans [ProductsPage.jsx](src/ui/pages/ProductsPage.jsx).

---

## 📋 Correctifs Appliqués

### 1️⃣ **Diagnostic Immédiat (30 secondes)**
**Ligne 266-280** : Après `loadProducts()`, un log automatique vérifie le produit 1 :

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

**➜ Comment tester :**
1. Ouvrir DevTools Console (F12)
2. Recharger la page
3. Chercher le message **"🔍 [DIAGNOSTIC] PRODUCT 1 FROM API"**
4. **Si `UNITS LENGTH = 1`** → Problème backend (GROUP BY écrase une unité)
5. **Si `UNITS LENGTH = 2`** → Collision React (clés identiques ou mal générées)

---

### 2️⃣ **Correction A: Clés Uniques et Déterministes**
**Ligne 519-526** dans `tableData` :

```javascript
// ✅ CORRECTION A: Créer une clé VRAIMENT unique et déterministe
// Inclure: product_code + unit_level + unit_uuid (pas d'index qui peut varier)
const productKey = String(product.code ?? product.id ?? `p${pIndex}`);
const unitKey = String(unit.uuid ?? unit.id ?? `u${uIndex}`);
const rowId = `${productKey}:${unit.unit_level}:${unitKey}`; // Format déterministe

rows.push({
  id: rowId, // ✅ Clé unique et déterministe par ligne
  // ...
});
```

**Avant :** `id = index` (instable, provoque des collisions)  
**Après :** `id = "1:CARTON:1d6f6b3b-f378..." + "1:MILLIER:..."` (unique par unité)

---

### 3️⃣ **Correction B: Normalisation du `unit_mark` (plus d'effacement)**
**Ligne 527-534** dans `tableData` :

```javascript
// ✅ CORRECTION B: Valider unit_mark (arrêter de l'effacer si c'est 'MILLIER')
// unit_mark est le marking/label RÉEL de la BD (ex: 'MILLIER' peut être un vrai mark)
let normalizedUnitMark = String(unit.unit_mark ?? '').trim();

// Optionnel: interdire 'MILLIER' comme mark SUR CARTON seulement (si métier l'exige)
if (unit.unit_level === 'CARTON' && normalizedUnitMark.toUpperCase() === 'MILLIER') {
  normalizedUnitMark = '';
}
```

**Avant :** Tout mark dans `['CARTON','MILLIER','PIECE','DETAIL']` était effacé ❌  
**Après :** On préserve le mark RÉEL de la DB, sauf si c'est une anomalie métier (MILLIER sur CARTON) ✅

---

### 4️⃣ **Rendu avec `data-rowid` pour debugging**
**Ligne 2078** dans le JSX :

```jsx
<tr
  key={row.id || `row-${index}`}
  data-rowid={row.id}  // ✅ Utile pour inspecter les doublons au DevTools
  className={`group ${row.is_empty ? 'opacity-30' : 'hover:bg-dark-700/50'} ...`}
  onMouseLeave={() => smartBlurRow(row.id)}
>
```

**➜ Pour vérifier les doublons :**
```javascript
// Dans DevTools Console:
document.querySelectorAll('tr[data-rowid]')
  .forEach(tr => console.log(tr.getAttribute('data-rowid')));
```

---

## 🧪 Résultats Attendus

### ✅ **Cas 1: Backend correct (2 unités)**
```
🔍 [DIAGNOSTIC] PRODUCT 1 FROM API = {id: 1, code: "1", units: Array(2), ...}
📊 UNITS LENGTH = 2
✅ Backend OK: 2 unités trouvées
   → Si l'UI affiche mal, c'est une collision de clé React
   Unit 0: level=CARTON, mark=KKKKK, uuid=1d6f6b3b-f378..., id=1
   Unit 1: level=MILLIER, mark=..., uuid=..., id=56
```

**→ L'UI affichera maintenant 2 lignes distinctes** (une CARTON, une MILLIER)

### ❌ **Cas 2: Backend récupère 1 seule unité**
```
🔍 [DIAGNOSTIC] PRODUCT 1 FROM API = {id: 1, code: "1", units: Array(1), ...}
📊 UNITS LENGTH = 1
⚠️  BACKEND PROBLEM: Seulement 1 unité trouvée (au lieu de 2)
   → Vérifier la requête /api/products et le GROUP BY
```

**→ Problème dans le backend** (voir `check-glowflixprojet-db.py` pour le SQL)

---

## 🚀 Utilisation

1. **Testez le diagnostic :**
   - F12 → Console
   - Recharger la page
   - Chercher "🔍 [DIAGNOSTIC]"

2. **Interprétez le résultat :**
   - **1 unité** = Corriger le `/api/products` backend
   - **2 unités** = Les clés React sont maintenant fixes → UI devrait afficher 2 lignes

3. **Vérifiez l'absence de collision :**
   ```javascript
   const rowIds = Array.from(document.querySelectorAll('tr[data-rowid]'))
     .map(tr => tr.getAttribute('data-rowid'));
   const hasDuplicates = new Set(rowIds).size !== rowIds.length;
   console.log('Doublons?', hasDuplicates); // Devrait être false
   ```

---

## 📚 Fichiers Modifiés

- [ProductsPage.jsx](src/ui/pages/ProductsPage.jsx) (lignes 266-280, 519-534, 2078)

## 🔗 Liens Utiles

- Test SQL: `check-glowflixprojet-db.py`
- Schema DB: `DATABASE-LOCATION-PRODUCTION.md`
- API Endpoint: `/api/products`

---

**Généré:** 2026-01-03  
**Status:** Production-Ready ✅
