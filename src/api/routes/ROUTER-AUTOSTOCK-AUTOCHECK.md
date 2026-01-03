# AutoCheck - Vérification Automatique du Stock

## 🔄 Vue d'ensemble

**AutoCheck** est un système qui vérifie **automatiquement** tous les produits **toutes les 2 secondes** et déclenche `autoStock` si les conditions sont remplies.

**Pas besoin d'appui sur un bouton** - ça se fait tout seul en arrière-plan!

---

## 📋 Conditions d'activation

AutoCheck déclenche automatiquement l'autostock pour un produit si:

1. ✅ Le produit a une unité **CARTON** avec `stock_current > 0`
2. ✅ Le produit a une unité cible (PIECE ou MILLIER) avec:
   - `stock_current <= 0` (vide ou négatif)
   - `auto_stock_factor > 0` (facteur de conversion positif)

---

## 🎯 Exemple concret

### Produit: Biscuit Lorie

| Unité   | Stock | Auto_Factor |
|---------|-------|-------------|
| CARTON  | 44    | 0           |
| PIECE   | 0     | 50          |
| MILLIER | 0     | 1000        |

### Qu'est-ce qui se passe:

```
Timer: 0s
  ✓ CARTON = 44 (> 0) ✓
  ✓ PIECE = 0 (<= 0) ✓
  ✓ PIECE.factor = 50 (> 0) ✓
  → AutoCheck déclenche: applyAutoStock('Biscuit Lorie', 'PIECE')
  
Résultat:
  CARTON: 44 → 43
  PIECE:  0  → 50
```

```
Timer: 2s
  ✓ CARTON = 43 (> 0) ✓
  ✓ MILLIER = 0 (<= 0) ✓
  ✓ MILLIER.factor = 1000 (> 0) ✓
  → AutoCheck déclenche: applyAutoStock('Biscuit Lorie', 'MILLIER')
  
Résultat:
  CARTON: 43 → 42
  MILLIER: 0  → 1000
```

```
Timer: 4s
  ✓ CARTON = 42 (> 0) ✓
  ✓ PIECE = 50 (> 0) → PAS VIDE
  ✗ MILLIER = 1000 (> 0) → PAS VIDE
  → Pas d'action (les deux cibles sont remplies)
```

---

## 🔧 Implémentation

### Fonctions exportées (router.autostock.js)

```javascript
// Démarrer l'auto-check (toutes les 2 secondes)
export function startAutoCheck(db) { ... }

// Arrêter l'auto-check (appel automatique au shutdown)
export function stopAutoCheck() { ... }
```

### Intégration serveur (server.js)

```javascript
// 1. Import
import autoStockRouter, { startAutoCheck, stopAutoCheck } from './routes/router.autostock.js';

// 2. Assigner DB (ligne ~327)
app.locals.db = getDb();

// 3. Démarrer AutoCheck (dans startBackend, après module d'impression)
startAutoCheck(getDb());
logger.info('🔄 AutoCheck démarré (vérification stock toutes les 2 secondes)');

// 4. Arrêter proprement (dans stop())
async stop() {
  stopAutoCheck(); // ← Avant de fermer le serveur
  return new Promise((r) => httpServer.close(() => r()));
}
```

---

## 📊 Logique détaillée (runAutoCheck)

```pseudocode
TOUS LES 2 SECONDES:
  1. Récupérer TOUS les produits (WHERE status != 'deleted')
  
  2. POUR CHAQUE produit:
    a) Récupérer toutes ses unités
    b) Vérifier CARTON.stock_current > 0
       → Non? → Passer au produit suivant
    c) Chercher une unité cible VIDE (stock <= 0) avec factor > 0
       → Pas trouvée? → Passer au produit suivant
    d) Déclencher: applyAutoStock(productCode, unitLevel)
       - Avec device_id = 'AUTO_CHECK'
       - Dans une transaction DB
    e) Log: ✅ AutoCheck: CODE -> UNIT (X actions)
    
  3. Gérer erreurs gracieusement (log mais continue)
```

---

## ⚡ Performance

- **Fréquence**: Toutes les 2 secondes (2000ms)
- **Durée par cycle**: ~50-200ms (dépend du nombre de produits)
- **Chevauchements**: Évités par flag `autoCheckRunning`
  - Si un cycle est encore en cours, saute la vérification suivante
  - Évite les surcharges si la DB est lente

---

## 📝 Logs

Quand un autocheck se déclenche, vous voyez:

```
✅ AutoCheck: RIZ-001 -> PIECE (1 action)
✅ AutoCheck: BLÉ-002 -> MILLIER (1 action)
❌ AutoCheck error pour SUCRE-003: Produit intro
```

Au démarrage:
```
🔄 Démarrage AutoCheck (toutes les 2 secondes)
🔄 AutoCheck démarré (vérification stock toutes les 2 secondes)
```

À l'arrêt:
```
⏹️ AutoCheck arrêté
```

---

## ⚙️ Configuration

### Modifier l'intervalle (2 secondes par défaut)

Dans `router.autostock.js`, fonction `startAutoCheck`:

```javascript
// AVANT: 2000 ms (2 secondes)
autoCheckInterval = setInterval(() => {
  runAutoCheck(db).catch((err) => console.error("AutoCheck error:", err));
}, 2000);  // ← Modifier ici

// APRÈS: 5000 ms (5 secondes)
}, 5000);
```

### Désactiver AutoCheck temporairement

En production, si AutoCheck cause trop de charge:

```javascript
// Commenter cette ligne dans startBackend():
// startAutoCheck(getDb());  // ← Désactiver
```

---

## 🧪 Tester manuellement

### Scenario 1: Auto-trigger simple

```bash
# 1. Créer un produit RIZ-001
# 2. Ajouter 2 unités:
#    - CARTON: stock=10, auto_stock_factor=0
#    - PIECE: stock=0, auto_stock_factor=50

# 3. Attendre 2 secondes (ou moins si vous avez modifié l'intervalle)

# 4. Vérifier les logs: "✅ AutoCheck: RIZ-001 -> PIECE"

# 5. Vérifier la DB:
SELECT stock_current FROM product_units 
WHERE product_id = (SELECT id FROM products WHERE code = 'RIZ-001');

# Résultat attendu:
# CARTON: 9   (10 - 1)
# PIECE: 50   (0 + 50)
```

### Scenario 2: Multiples cibles

```bash
# Produit avec:
# - CARTON: 10
# - PIECE: 0, factor=50
# - MILLIER: 0, factor=1000

# Après 2s: CARTON→9, PIECE→50
# Après 4s: CARTON→8, MILLIER→1000
# Après 6s: CARTON→7, PIECE→50 (re-rempli car vide)
```

---

## ⚠️ Pièges à éviter

### ❌ Auto_stock_factor = 0

```sql
-- MAUVAIS: Aucune conversion
UPDATE product_units SET auto_stock_factor = 0 WHERE unit_level = 'PIECE';
-- → AutoCheck l'ignorera (factor = 0)

-- BON: Utiliser factor > 0
UPDATE product_units SET auto_stock_factor = 50 WHERE unit_level = 'PIECE';
```

### ❌ CARTON stock <= 0

```sql
-- MAUVAIS: CARTON vide
UPDATE product_units SET stock_current = 0 WHERE unit_level = 'CARTON';
-- → AutoCheck ne déclenche PAS (stock <= 0)

-- BON: S'assurer que CARTON > 0
UPDATE product_units SET stock_current = 10 WHERE unit_level = 'CARTON';
```

### ❌ Désynchronisation stock_initial <> stock_current

```sql
-- MAUVAIS: Les deux n'ont pas la même valeur
UPDATE product_units SET stock_current = 50 WHERE uuid = '...';
-- stock_initial reste = 10 !

-- BON: Toujours modifier les deux
UPDATE product_units 
SET stock_initial = 50, stock_current = 50
WHERE uuid = '...';
```

---

## 🔄 Interactions avec d'autres systèmes

### Avec ProductsPage.jsx (auto-save)

- **AutoCheck**: Vérification automatique toutes les 2s (passive)
- **Auto-save**: Utilisateur modifie → save après 5s inactivité (actif)

**Pas de conflit**: AutoCheck lit la DB, auto-save y écrit. Aucun deadlock.

### Avec Sync vers Sheets

- **AutoCheck déclenche**: applyAutoStock → crée sync_operations
- **Sync worker**: Lit sync_operations (status='pending') et envoie Sheets
- **Sheets répond**: status='acked' quand synced

**Séquence**: AutoCheck → stock_moves + sync_op → Sync worker → Sheets

---

## 📊 Monitoring

### Vérifier que AutoCheck est actif

```bash
# Checher les logs au démarrage
grep "AutoCheck démarré" logs/app.log

# Vérifier les actions AutoCheck
grep "AutoCheck:" logs/app.log | wc -l
# Combien d'actions ont été déclenchées?
```

### Vérifier les stocks

```sql
-- Produits avec CARTON stock > 0 ET cible stock <= 0
SELECT 
  p.code,
  pu_carton.stock_current as carton_stock,
  pu_carton.auto_stock_factor as carton_factor,
  pu_piece.unit_level,
  pu_piece.stock_current as piece_stock,
  pu_piece.auto_stock_factor as piece_factor
FROM products p
JOIN product_units pu_carton ON p.id = pu_carton.product_id 
  AND UPPER(pu_carton.unit_level) = 'CARTON'
JOIN product_units pu_piece ON p.id = pu_piece.product_id 
  AND UPPER(pu_piece.unit_level) IN ('PIECE', 'MILLIER')
WHERE pu_carton.stock_current > 0
  AND pu_piece.stock_current <= 0
  AND pu_piece.auto_stock_factor > 0
ORDER BY p.code;
```

---

## 🚀 Prochains pas

1. **Tester** avec un produit simple (CARTON + PIECE)
2. **Vérifier** les logs "✅ AutoCheck: ..."
3. **Valider** les changements de stock dans la DB
4. **Monitorer** les performances (charge CPU/DB)
5. **Adapter** l'intervalle si besoin (2s par défaut)
6. **Déployer** en production quand satisfait

---

## 📞 Support

Si AutoCheck ne se déclenche pas:

1. **Vérifier les logs**:
   ```bash
   grep "AutoCheck" logs/app.log
   ```

2. **Vérifier la config**:
   - `app.locals.db` assigné? (ligne ~327 server.js)
   - `startAutoCheck(getDb())` appelé? (après module impression)
   - Les produits ont-ils `auto_stock_factor > 0`?

3. **Vérifier les conditions**:
   ```sql
   -- CARTON doit avoir stock > 0
   SELECT code, unit_level, stock_current, auto_stock_factor 
   FROM product_units pu
   JOIN products p ON pu.product_id = p.id
   WHERE UPPER(unit_level) = 'CARTON'
   ORDER BY p.code;
   ```

4. **Vérifier les cibles**:
   ```sql
   -- Unités cibles vides avec factor > 0
   SELECT code, unit_level, stock_current, auto_stock_factor 
   FROM product_units pu
   JOIN products p ON pu.product_id = p.id
   WHERE UPPER(unit_level) IN ('PIECE', 'MILLIER')
     AND stock_current <= 0
     AND auto_stock_factor > 0
   ORDER BY p.code;
   ```

