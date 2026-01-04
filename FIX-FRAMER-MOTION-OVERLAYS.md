# 🔧 CORRECTIF MAJEUR: Framer Motion + Overlays Bloquants

## 📋 Problème Diagnostiqué

Quand une erreur est signalée dans l'interface, l'UI devient "non cliquable/non éditable". Trois causes principales:

1. **CSS global trop agressif** → transitions `transform` + `opacity` globales conflictent avec Framer Motion
2. **Overlays invisibles qui bloquent les clics** → Les dropdowns fermés restent au-dessus pendant l'animation
3. **alert() + focus/blur/setTimeout = état incohérent** → Blocage du thread + perte d'événements blur

---

## ✅ CORRECTIFS APPLIQUÉS

### 1️⃣ CSS Global (`src/ui/index.css`)

**❌ AVANT:**
```css
* {
  transition-property: background-color, border-color, color, fill, stroke, opacity, box-shadow, transform;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
```

**Problème**: `transform` et `opacity` globales forcent des transitions CSS sur chaque micro-changement Framer Motion → animations doubles, états intermédiaires plus longs, overlays invisibles qui restent cliquables.

**✅ APRÈS:**
```css
* {
  transition-property: background-color, border-color, color, fill, stroke, box-shadow;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
```

**Résultat**: Suppression de `transform` et `opacity` de la transition globale. Framer Motion a maintenant le contrôle complet.

---

### 2️⃣ Remplacer `alert()` par message UI (`src/ui/pages/SalesPOS.jsx`)

**❌ AVANT:**
```jsx
alert('Le panier est vide');
alert('Le nom du client est obligatoire');
alert('Erreur lors de la finalisation de la vente');
```

**Problème**: `alert()` bloque le thread JS. Au retour, certains blur/focus n'arrivent pas comme prévu.

**✅ APRÈS:**
```jsx
// État UI pour les erreurs
const [uiError, setUiError] = useState(null);

// Helper: afficher une erreur UI (remplace alert)
const raiseError = (msg) => {
  setUiError(msg);
  // Auto-hide après 3 secondes
  setTimeout(() => setUiError(null), 3000);
};

// Utilisation:
if (sale.items.length === 0) {
  raiseError('Le panier est vide');
  return;
}

// Dans le JSX:
{uiError && (
  <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    className="card p-3 border-2 border-red-500/40 bg-red-500/10 text-red-200 text-sm"
  >
    <div className="flex items-start gap-2">
      <AlertCircle className="w-5 h-5" />
      <p>{uiError}</p>
    </div>
  </motion.div>
)}
```

**Résultat**: Erreurs affichées via motion.div. Focus/blur gérés avec `requestAnimationFrame` pour éviter les conflits.

---

### 3️⃣ Ajouter `pointerEvents` aux dropdowns (`src/ui/pages/SalesPOS.jsx`)

**❌ AVANT:**
```jsx
<motion.div
  initial={{ opacity: 0, y: -5, scale: 0.95 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  exit={{ opacity: 0, y: -5, scale: 0.95 }}
  // Pas de pointerEvents → reste cliquable même en exit!
>
```

**Problème**: Pendant `exit`, l'élément est encore présent (à `opacity: 0`) et reste cliquable au-dessus de l'UI.

**✅ APRÈS:**
```jsx
// Suggestions clients (z-[300])
<motion.div
  initial={{ opacity: 0, y: -5, scale: 0.95, pointerEvents: 'none' }}
  animate={{ opacity: 1, y: 0, scale: 1, pointerEvents: 'auto' }}
  exit={{ opacity: 0, y: -5, scale: 0.95, pointerEvents: 'none' }}
>

// Message "Aucun produit trouvé" (z-[100])
<motion.div
  initial={{ opacity: 0, y: -5, pointerEvents: 'none' }}
  animate={{ opacity: 1, y: 0, pointerEvents: 'auto' }}
  exit={{ opacity: 0, y: -5, pointerEvents: 'none' }}
>
```

**Résultat**: Les overlays fermés (`exit`) ne peuvent plus capturer les clics → l'UI est responsive.

---

### 4️⃣ Définir `SAFE_POLICY` et créer `getSafePolicy()` 

**❌ AVANT:**
```jsx
const policy = getQtyPolicy(unitNorm, markNorm) || SAFE_POLICY;  // SAFE_POLICY non défini!
```

**Problème**: Référence à `SAFE_POLICY` undefined → ReferenceError possible si `getQtyPolicy` retourne null.

**✅ APRÈS:**
```jsx
// Constante safe définie en haut du fichier
const SAFE_POLICY = {
  integerOnly: false,
  allowDecimal: true,
  step: 1,
  minQty: 0,
};

// Helper: obtenir une policy "safe" (jamais undefined)
function getSafePolicy(unitLevel, unitMark) {
  const unitNorm = normalizeUnit(unitLevel);
  const markNorm = normalizeMark(unitMark || '');
  return getQtyPolicy(unitNorm, markNorm) || SAFE_POLICY;
}

// Utilisé partout:
const policy = getSafePolicy(item.unit_level, item.unit_mark);  // Jamais null!
```

**Résultat**: Plus aucune ReferenceError. `policy` est toujours un objet valide.

---

### 5️⃣ Rendre immutable le state management

**❌ AVANT:**
```jsx
const addItemToSale = useCallback((product, unit, qty) => {
  const newSales = [...sales];
  const sale = newSales[activeSaleIndex];
  sale.items.push({...});  // Mutation profonde!
  setSales(newSales);
}, [sales, activeSaleIndex]);
```

**Problème**: Mutations profondes → état "corrompu", rerenders incohérents, comportements bizarres.

**✅ APRÈS:**
```jsx
const addItemToSale = useCallback((product, unit, qty) => {
  setSales(prev => {
    const next = [...prev];
    const sale = next[activeSaleIndex];
    const items = [...(sale.items || [])];  // Copie l'array items

    const existingItemIndex = items.findIndex(/* ... */);
    
    if (existingItemIndex >= 0) {
      // Update: créer un nouvel objet item
      items[existingItemIndex] = {
        ...items[existingItemIndex],
        qty: correctedQty,
        subtotal_fc: unitPriceFC * correctedQty,
      };
    } else {
      // Add: push dans l'array copié
      items.push({...});
    }

    // Retourner l'arbre complet immutable
    next[activeSaleIndex] = { ...sale, items };
    return next;
  });
}, [activeSaleIndex]);  // Pas de sales en dépendance (c'est prev)
```

**Résultat**: État stable, rerenders prévisibles, zéro comportements bizarres.

---

## 🎯 Résumé des Changements

| Fichier | Changement | Raison |
|---------|-----------|--------|
| `src/ui/index.css` | Supprimer `transform, opacity` de `*` | Éviter conflits Framer Motion |
| `src/ui/pages/SalesPOS.jsx` | Ajouter `SAFE_POLICY` + `getSafePolicy()` | Garantir une policy valide |
| `src/ui/pages/SalesPOS.jsx` | Remplacer `alert()` par `raiseError()` + UI | Éviter le blocage du thread |
| `src/ui/pages/SalesPOS.jsx` | Ajouter `pointerEvents` aux dropdowns | Empêcher les overlays invisibles de bloquer |
| `src/ui/pages/SalesPOS.jsx` | Rendre immutable le state management | État stable, rerenders prévisibles |

---

## 🔍 Diagnostic Rapide (Si ça bloque toujours)

**Chrome DevTools → Console:**
```javascript
// Quand ça "bloque", exécutez:
document.elementFromPoint(window.innerWidth/2, window.innerHeight/2)

// Vous verrez souvent un motion.div dropdown au-dessus
```

**Ou inspectez:**
1. Ouvrez Elements
2. Cliquez l'icône "sélecteur"
3. Cliquez sur la zone "non cliquable"
4. Vous verrez quel élément est au-dessus

---

## ✨ Résultats Attendus

✅ Erreurs affichées sans bloquer l'UI  
✅ Dropdowns fermés ne bloquent plus les clics  
✅ Pas d'états "figés" ou incohérents  
✅ Animations Framer Motion fluides et sans conflits  
✅ Aucune ReferenceError sur SAFE_POLICY  

---

**Status**: 🟢 TOUS LES CORRECTIFS APPLIQUÉS

**Fichiers modifiés**:
- `src/ui/index.css`
- `src/ui/pages/SalesPOS.jsx`

**À tester**:
1. Créer une vente avec le panier vide → message d'erreur (pas d'alert)
2. Chercher un produit → "Aucun produit trouvé" ferme bien
3. Finalize vente sans nom client → message d'erreur, focus sur champ client
4. Aucune ReferenceError dans la console
