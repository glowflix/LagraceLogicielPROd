# ✅ TEST: Corrections unit_mark (SQL + Frontend)

**Date:** January 1, 2026  
**Status:** ✅ IMPLEMENTED  
**Impact:** Résout les bugs "Mark disparaît" lors de la sauvegarde

---

## 🔧 Corrections Appliquées

### 1️⃣ **normalizeMark() - ProductsPage.jsx (Ligne 303)**

#### ❌ AVANT (BUG):
```javascript
const normalizeMark = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;  // ❌ Renvoie null si vide
};
```

**Problème SQL:** 
- `unit_mark TEXT NOT NULL` rejette les `null` 
- Erreur: `SQLITE_CONSTRAINT: NOT NULL constraint failed`

#### ✅ APRÈS (CORRIGÉ):
```javascript
const normalizeMark = (v) => {
  const s = String(v ?? '').trim();
  return s; // ✅ Jamais null - retourne '' si vide (DB-safe)
};
```

**Comportement:**
- `"PQT "` → `"PQT"` (trimé)
- `""` → `""` (vide, pas null)
- `null/undefined` → `""` (sûr)

---

### 2️⃣ **onBlur du champ Mark - ProductsPage.jsx (Ligne ~1900)**

#### ❌ AVANT (BUG):
```javascript
onBlur={() => {
  const v = (document.activeElement?.value || '');  // ❌ Au blur, activeElement n'est plus l'input!
  const vNorm = String(v ?? '').trim();
  // Cache visuel mais vNorm = '' (valeur perdue)
  if (vNorm) {
    setVisualForRow(row.id, { unit_mark: vNorm }, 8000);
  }
  // ...
}}
```

**Problème UI:**
- `document.activeElement` = `<body>` au blur
- Récupère `''` au lieu de la valeur saisie
- Cache visuel pas créé, appel `scheduleSave('')`
- Mark "disparaît" car vide est sauvegardé

#### ✅ APRÈS (CORRIGÉ):
```javascript
onBlur={(e) => {
  const vNorm = String(e.currentTarget.value ?? '').trim(); // ✅ CORRECT: e.currentTarget

  // ✅ VALIDATION: Mark ne peut pas être vide (DB constraint)
  if (!vNorm) {
    setSaveMessage({ 
      type: 'error', 
      text: 'Le Mark (unité de vente) est obligatoire' 
    });
    setTimeout(() => setSaveMessage({ type: '', text: '' }), 3000);
    return;  // Rester en édition
  }

  // ✅ cache visuel immédiat 8s
  setVisualForRow(row.id, { unit_mark: vNorm }, 8000);

  // ✅ Pousser la valeur normalisée dans editingValues
  updateEditValue(row.id, 'unit_mark', vNorm);

  setTimeout(() => {
    if (row?.id) {
      scheduleSave(row.id);
    }
    setEditingCell(null);
    setFocusedField(null);
  }, 50);
}}
```

**Améliorations:**
- ✅ Utilise `e.currentTarget.value` (stable au blur)
- ✅ Validation du mark (obligatoire)
- ✅ Message d'erreur utilisateur
- ✅ Cache visuel systématique
- ✅ `updateEditValue()` s'assure que la valeur est dans le state

#### ✅ `onKeyPress` - Également Corrigé:
```javascript
onKeyPress={(e) => {
  if (e.key === 'Enter') {
    const vNorm = String(e.currentTarget.value ?? '').trim();

    // ✅ VALIDATION: Mark ne peut pas être vide
    if (!vNorm) {
      setSaveMessage({ 
        type: 'error', 
        text: 'Le Mark (unité de vente) est obligatoire' 
      });
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 3000);
      return;
    }

    setVisualForRow(row.id, { unit_mark: vNorm }, 8000);
    updateEditValue(row.id, 'unit_mark', vNorm);
    if (row?.id) {
      scheduleSave(row.id);
    }
    setEditingCell(null);
    setFocusedField(null);
  }
}}
```

---

## 🗄️ Schema SQL - Pas de Changement Requis

La contrainte `unit_mark TEXT NOT NULL` est correcte:

```sql
CREATE TABLE IF NOT EXISTS product_units (
  ...
  unit_mark TEXT NOT NULL,  -- ✅ Correct (jamais NULL)
  ...
  UNIQUE(product_id, unit_level, unit_mark),  -- ✅ Correct
  ...
);
```

**Comportement avec la correction:**
- Frontend ne renvoie jamais `null`
- Envoie `''` si vide (conforme à NOT NULL)
- UNIQUE constraint accepte un seul `''` par `(product_id, unit_level)` ✅

---

## 🔄 Flux Complet de Sauvegarde

### Étape 1: Saisie utilisateur
```
Utilisateur tape "PQT" dans le champ Mark
```

### Étape 2: onChange dans l'input
```javascript
onChange={(e) => {
  updateEditValue(row.id, 'unit_mark', e.target.value); // "PQT"
}}
```

### Étape 3: onBlur (ou Enter)
```javascript
const vNorm = String(e.currentTarget.value ?? '').trim(); // "PQT"
if (!vNorm) {
  // Validation: mark vide → erreur
  setSaveMessage({ type: 'error', text: '...' });
  return;
}
setVisualForRow(row.id, { unit_mark: vNorm }, 8000);  // Afficher "PQT" immédiatement
updateEditValue(row.id, 'unit_mark', vNorm);          // Stocker dans le state
scheduleSave(row.id);                                   // Programmer la sauvegarde
```

### Étape 4: handleUpdateProduct (déclenchée par scheduleSave)
```javascript
// unitUpdates.unit_mark = normalizeMark(edits.unit_mark)
unitUpdates.unit_mark = normalizeMark("PQT");  // "PQT"
```

### Étape 5: buildUnitPayload
```javascript
unit_mark: normalizeMark(merged.unit_mark),  // "PQT"
```

### Étape 6: API PUT /api/products/:code
```json
{
  "name": "...",
  "units": [
    {
      "id": 123,
      "unit_level": "MILLIER",
      "unit_mark": "PQT",  // ✅ Valeur correcte
      "stock_current": 100,
      ...
    }
  ]
}
```

### Étape 7: Backend (products.repo.js)
```javascript
// ON CONFLICT(product_id, unit_level, unit_mark) DO UPDATE SET
// WHERE product_id=1 AND unit_level='MILLIER' AND unit_mark='PQT'
// ✅ Correspond exactement à la ligne de la base
```

---

## 🧪 Test de Validation (5 minutes)

### Test 1: Saisir un Mark normalement
```
1. Clique sur la cellule Mark
2. Type: PQT
3. Press Blur (click ailleurs) ou Enter
4. Vérifier console: 
   - Tu dois voir: unit_mark: "PQT" dans la logs handleUpdateProduct
5. Vérifier UI: 
   - Mark ne doit PAS disparaître
   - Cache visuel "PQT" doit afficher 8 secondes
6. Attendre la sauvegarde (~2s)
7. Recharger la page → Mark persiste ✅
```

### Test 2: Essayer Mark vide
```
1. Clique sur la cellule Mark
2. Sélectionner tout le texte et Delete (vide)
3. Press Blur ou Enter
4. Vérifier:
   - Message d'erreur rouge: "Le Mark (unité de vente) est obligatoire" ✅
   - Reste en édition (pas de fermeture)
   - Aucune sauvegarde envoyée au backend
5. Retaper un Mark valide (PQT)
6. Press Enter → Sauvegarde réussie ✅
```

### Test 3: Modifier Mark existant (changement + sauvegarde)
```
1. Produit avec Mark = "DZ"
2. Clique sur Mark
3. Type: CARTON
4. Press Enter
5. Vérifier console:
   - unit_mark: "CARTON" (ancien: "DZ")
6. Attendre 2s pour sync
7. Recharger la page → Mark = "CARTON" ✅
```

### Test 4: Vérifier la base de données (SQL)
```sql
SELECT id, product_id, unit_level, unit_mark, updated_at 
FROM product_units 
WHERE product_id = 1 AND unit_level = 'MILLIER' 
ORDER BY updated_at DESC 
LIMIT 1;
```

**Résultat attendu:**
```
id  | product_id | unit_level | unit_mark | updated_at
123 | 1          | MILLIER    | PQT       | 2026-01-01 12:34:56
```

---

## 📊 Résumé des Changements

| Aspect | Avant | Après |
|--------|-------|-------|
| **normalizeMark()** | Retourne `null` si vide ❌ | Retourne `''` si vide ✅ |
| **onBlur Mark** | `document.activeElement?.value` (bugué) ❌ | `e.currentTarget.value` (correct) ✅ |
| **Validation Mark** | Aucune validation ❌ | Obligatoire + message d'erreur ✅ |
| **Cache visuel** | Conditionnel (`if (vNorm)`) ❌ | Systématique ✅ |
| **updateEditValue()** | Pas appelé au blur ❌ | Appelé pour synchroniser state ✅ |
| **SQL Constraint** | `unit_mark NOT NULL` ✅ | Inchangé ✅ |

---

## 🎯 Résultat Attendu

Après ces corrections:
- ✅ Mark ne "disparaît" plus lors de la sauvegarde
- ✅ Les modifications sont sauvegardées correctement
- ✅ La validation empêche les marks vides (DB constraint)
- ✅ Les messages d'erreur aident l'utilisateur
- ✅ Pas de changer dans la base de données requise
- ✅ Cohérent avec Code.gs et le reste du backend

---

## 🔍 Points Clés

1. **Jamais `null` pour unit_mark** → Toujours `""` ou une string
2. **Validation UI avant envoi** → Empêche les requêtes invalides
3. **e.currentTarget vs document.activeElement** → Critique pour capturer la bonne valeur
4. **updateEditValue() au blur** → Assure la synchronisation du state
5. **Cache visuel systématique** → Feedback utilisateur immédiat

---

## 📝 Fichiers Modifiés

- [src/ui/pages/ProductsPage.jsx](src/ui/pages/ProductsPage.jsx#L303) - normalizeMark + onBlur Mark
