# 📋 Refactorisation PRO - Schéma & Identification Stable

## 🎯 Problème Fondamental Résolu

**Avant:** `unit_mark` (attribut modifiable) servait de clé dans les contraintes UNIQUE et les triggers.
- ❌ Si l'utilisateur renomme unit_mark, les ventes orphelines ne se restaurent plus lors d'un void
- ❌ Risque d'incohérence de stock
- ❌ Unicité impossible si mark est modifiable

**Après:** Identification stable basée sur `uuid` immutables.
- ✅ unit_mark = simple libellé (DZ, BT, SAC, BOX...)
- ✅ uuid = identité stable (jamais changée)
- ✅ Renommer unit_mark ne casse rien

---

## 🔧 Changements Appliqués

### 1. Schéma SQL (`src/db/schema.sql`)

#### 1.1 Ajout de colonne `product_unit_uuid` dans `sale_items`
```sql
CREATE TABLE sale_items (
  ...
  product_unit_uuid TEXT,           -- ✅ RÉFÉRENCE STABLE à l'unité (uuid)
  ...
  FOREIGN KEY(product_unit_uuid) REFERENCES product_units(uuid)
);

CREATE INDEX idx_sale_items_unit_uuid ON sale_items(product_unit_uuid);
```

**Raison:** Les triggers ont besoin d'une référence immuable à l'unité pour effectuer les mises à jour de stock, indépendamment de toute modification de `unit_mark`.

#### 1.2 Correction de l'unicité de `product_units`
```sql
-- AVANT (MAUVAIS):
UNIQUE(product_id, unit_level, unit_mark)

-- APRÈS (CORRECT):
UNIQUE(product_id, unit_level)
```

**Raison:** 
- `unit_mark` est modifiable par l'utilisateur
- Un seul niveau d'unité par produit (CARTON, MILLIER, PIECE)
- Le mark ne doit pas être une clé d'identification

#### 1.3 Réécriture des Triggers Stock

Tous les triggers stock ont changé **de l'identification par `(product_id, unit_level, unit_mark)`** vers **l'identification par `product_unit_uuid`**.

**Triggers modifiés:**
- `trg_sale_items_stock_decrease_ai` (AFTER INSERT)
- `trg_sale_items_stock_adjust_au` (AFTER UPDATE)
- `trg_sale_items_stock_restore_ad` (AFTER DELETE)
- `trg_sale_voids_mark_sale` (VOID facture)

**Exemple - Avant:**
```sql
WHERE product_id = NEW.product_id
  AND unit_level = NEW.unit_level
  AND unit_mark  = NEW.unit_mark
```

**Exemple - Après:**
```sql
WHERE uuid = NEW.product_unit_uuid
```

### 2. Backend - `sales.repo.js`

#### 2.1 Méthode `create()` - Insertion de vente locale
```javascript
// Avant l'insertion de sale_items:
const productUnit = db.prepare(`
  SELECT id, uuid FROM product_units
  WHERE product_id = ? AND unit_level = ?
  LIMIT 1
`).get(item.product_id, unitLevelForDb);

const productUnitUuid = productUnit.uuid;

// Lors de l'INSERT:
itemStmt.run(
  ...,
  productUnitUuid,  // ✅ Ajouté
  ...
);
```

#### 2.2 Méthode `upsert()` - Insertion de vente depuis Sheets
Même pattern: récupérer l'uuid de l'unité avant l'insertion.

```javascript
// Avant l'insertion:
const productUnit = db.prepare(`
  SELECT uuid FROM product_units
  WHERE product_id = ? AND unit_level = ?
  LIMIT 1
`).get(productId, unitLevel);

const productUnitUuid = productUnit?.uuid || null;

// Lors de l'INSERT:
itemStmt.run(
  ...,
  productUnitUuid,  // ✅ Ajouté
  ...
);
```

---

## 🎓 Règles d'Identification (PRO)

### Produits (`products`)
| Colonne | Rôle | Immuable? |
|---------|------|-----------|
| `id` | Clé locale (SQLite relations) | Oui |
| `uuid` | Clé globale (sync multi-devices) | **OUI** |
| `code` | Clé métier (unique) | Modifiable |
| `name` | Libellé | Modifiable |

**Règle:** Sync via `uuid`, jamais via `code`.

### Unités (`product_units`)
| Colonne | Rôle | Immuable? |
|---------|------|-----------|
| `id` | Clé locale | Oui |
| `uuid` | Clé globale (sync) | **OUI** |
| `unit_level` | CARTON/MILLIER/PIECE | Rarement modifié |
| `unit_mark` | DZ, BT, SAC, BOX... | **MODIFIABLE** |

**Règle:** Une unité par (`product_id`, `unit_level`). Le mark est un libellé, pas une clé.

### Ventes - Items (`sale_items`)
| Colonne | Référence | Immuable? |
|---------|-----------|-----------|
| `product_unit_uuid` | → `product_units.uuid` | **OUI** (point de fixation) |
| `unit_mark` | Copie du mark au moment de la vente | Non |

**Règle:** Chaque item de vente est lié à une unité via `product_unit_uuid`, jamais modifié même si l'utilisateur renomme le mark plus tard.

---

## 🚀 Bénéfices

### 1. **Intégrité du Stock Garantie**
- Les ventes restent liées à la bonne unité, même si le mark est renommé
- Les triggers VOID retrouvent toujours la bonne unité (via uuid)
- Pas d'orphelins de stock

### 2. **Sync Sheets Robuste**
- Chaque entité a un uuid immutable (clé globale)
- Les mises à jour Sheets matching par uuid, jamais par mark
- Backfill uuid côté Sheets quand nécessaire

### 3. **Flexibilité Utilisateur**
- L'utilisateur peut renommer `unit_mark` sans casser l'application
- Les tarifs, le stock, les ventes restent cohérents
- Les historiques restent valides

---

## 📊 Migration

Si vous aviez des données anciennes avec des doublons `(product_id, unit_level, unit_mark)`:

```sql
-- Détecter les doublons
SELECT product_id, unit_level, COUNT(*) c
FROM product_units
GROUP BY product_id, unit_level
HAVING c > 1;

-- Nettoyer (garder le plus récent, supprimer le reste)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY product_id, unit_level
           ORDER BY datetime(updated_at) DESC, id DESC
         ) rn
  FROM product_units
)
DELETE FROM product_units
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Backfill product_unit_uuid dans sale_items (si données anciennes)
UPDATE sale_items
SET product_unit_uuid = (
  SELECT pu.uuid
  FROM product_units pu
  WHERE pu.product_id = sale_items.product_id
    AND pu.unit_level = sale_items.unit_level
  LIMIT 1
)
WHERE product_unit_uuid IS NULL OR TRIM(product_unit_uuid) = '';
```

---

## ✅ Validations

Après cette refactorisation:

- [x] `UNIQUE(product_id, unit_level)` appliquée
- [x] Tous les triggers stock utilisent `product_unit_uuid`
- [x] Ventes locales (`create()`) incluent `product_unit_uuid`
- [x] Ventes Sheets (`upsert()`) incluent `product_unit_uuid`
- [x] Void facture récupère via `product_unit_uuid`
- [x] Pas de référence à `unit_mark` dans les WHERE des triggers

---

## 🔮 Prochaines Étapes (Optional)

1. **Sheets Sync:** Ajouter colonne `unit_uuid` dans Sheets (optionnel mais recommandé)
2. **Frontend (ProductsPage):** Afficher l'uuid des unités pour debug
3. **Tests:** Vérifier qu'un void restaure le stock même après renommage de mark

