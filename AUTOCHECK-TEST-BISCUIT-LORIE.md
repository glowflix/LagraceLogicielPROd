# Test AutoCheck - Biscuit Lorie

## 📋 Cas de test spécifique

**Produit**: Biscuit Lorie

| Unité   | Mark    | Stock | Auto_Factor | Attendu après AutoCheck |
|---------|---------|-------|-------------|------------------------|
| CARTON  | BOMBO   | 1     | 0           | 0 (ouverture)          |
| MILLIER | (Détail)| 0     | 50          | 50 (remplissage)       |

---

## 🧪 Test automatique (AutoCheck toutes les 2 secondes)

### Phase 1: Vérification initiale (t=0s)

```
Avant AutoCheck:
  CARTON stock  = 1   ✓ (> 0, peut être ouvert)
  MILLIER stock = 0   ✓ (= 0, vide)
  MILLIER factor = 50 ✓ (> 0, conversion possible)
  
→ Conditions remplies: AutoCheck déclenche applyAutoStock()
```

### Phase 2: Logs terminaux attendus

```
🔍 [AutoCheck] Vérification de X produit(s)...
  ✓ Biscuit Lorie: CARTON stock=1 (>0)
  📦 Biscuit Lorie: Trouvé cible MILLIER (stock=0, factor=50)
     → Déclenchement AutoStock: CARTON 1→0, MILLIER 0→50
  ✅ Biscuit Lorie → MILLIER:
     CARTON: 1 → 0
     MILLIER: 0 → 50
     sync_op_id: [UUID]

✨ [AutoCheck] Terminé: 1 action(s) exécutée(s) en XYZms
```

### Phase 3: Vérification DB

Après l'action, vérifier avec SQL:

```sql
-- Consulter les stocks finaux
SELECT 
  unit_level,
  stock_initial,
  stock_current,
  auto_stock_factor,
  last_update
FROM product_units 
WHERE product_id = (SELECT id FROM products WHERE code LIKE 'Biscuit Lorie%')
ORDER BY unit_level;

-- Résultat attendu:
-- unit_level | stock_initial | stock_current | auto_stock_factor | last_update
-- CARTON     | 0             | 0             | 0                 | 2026-01-02 14:23:45
-- MILLIER    | 50            | 50            | 50                | 2026-01-02 14:23:45
```

### Phase 4: Vérifier stock_moves

```sql
-- Consulter les mouvements de stock
SELECT 
  move_id,
  product_code,
  unit_level,
  delta,
  stock_before,
  stock_after,
  reference_id,
  device_id,
  created_at
FROM stock_moves 
WHERE product_code LIKE 'Biscuit Lorie%'
ORDER BY created_at DESC
LIMIT 10;

-- Résultat attendu (2 mouvements):
-- move_id                           | product_code    | unit_level | delta | stock_before | stock_after | reference_id       | device_id   | created_at
-- [UUID1]                           | Biscuit Lorie   | CARTON     | -1    | 1            | 0           | AUTO_STOCK:...     | AUTO_CHECK  | 2026-01-02 14:23:45.123
-- [UUID2]                           | Biscuit Lorie   | MILLIER    | 50    | 0            | 50          | AUTO_STOCK:...     | AUTO_CHECK  | 2026-01-02 14:23:45.125
```

### Phase 5: Vérifier sync_operations

```sql
-- Consulter les opérations de sync
SELECT 
  op_id,
  op_type,
  entity_code,
  status,
  tries,
  created_at
FROM sync_operations 
WHERE entity_code LIKE 'Biscuit Lorie%'
ORDER BY created_at DESC
LIMIT 5;

-- Résultat attendu (1 opération):
-- op_id      | op_type    | entity_code   | status  | tries | created_at
-- [UUID]     | STOCK_MOVE | Biscuit Lorie | pending | 0     | 2026-01-02 14:23:45.200
```

---

## 📊 Timeline complète

```
Temps    | Événement                                      | État
---------|------------------------------------------------|------------------------------------------
0s       | 🚀 Serveur démarre                            | Server running, AutoCheck démarré
0s       | 🔍 AutoCheck #1 lance                         | Scan tous les produits
0.05s    | ✓ Biscuit Lorie: détecte CARTON=1, MILLIER=0 | Déclenche applyAutoStock()
0.1s     | ✅ applyAutoStock() exécuté                   | CARTON: 1→0, MILLIER: 0→50
0.12s    | 📝 stock_moves créés                          | 2 mouvements loggés
0.15s    | 🔄 sync_operation créée                       | status='pending'
0.16s    | ✨ AutoCheck #1 terminé (1 action)           | Résultat: OK

2s       | 🔍 AutoCheck #2 lance                         | Scan à nouveau
2.05s    | ⏸️ Biscuit Lorie: CARTON=0 (<=0)             | Pas d'action (CARTON vide)
2.1s     | ✨ AutoCheck #2 terminé (0 actions)          | Aucune action

4s       | 🔍 AutoCheck #3 lance                         | Continue...
...      | ...                                            | ...
```

---

## 🎯 Points clés du test

✅ **CARTON stock passe de 1 à 0**
  - Vérifier que la valeur dans le terminal est exacte
  - Vérifier dans la DB (stock_initial ET stock_current)

✅ **MILLIER stock passe de 0 à 50**
  - Vérifier que la conversion 1 carton → 50 milliers fonctionne
  - Vérifier le factor (50) est appliqué correctement

✅ **Logs informatifs**
  - Vérifier que AutoCheck affiche:
    - "Trouvé cible MILLIER (stock=0, factor=50)"
    - "CARTON: 1 → 0"
    - "MILLIER: 0 → 50"

✅ **Idempotence**
  - Après le 1er cycle, CARTON=0 (VIDE)
  - AutoCheck #2 ne doit PAS déclencher d'action
  - Vérifier le log: "CARTON stock=0 (<=0) - skip"

✅ **Audit trail**
  - stock_moves: 2 lignes créées
  - sync_operations: 1 opération créée avec status='pending'
  - Chaque line a un unique move_id / op_id

---

## 💡 Troubleshooting

### Problem: AutoCheck ne se déclenche pas

```bash
# 1. Vérifier que AutoCheck a démarré
grep "AutoCheck Démarrage" logs/app.log

# 2. Vérifier que startAutoCheck() est appelé dans server.js
grep -n "startAutoCheck" src/api/server.js

# 3. Vérifier que app.locals.db est assigné
grep -n "app.locals.db" src/api/server.js
```

### Problem: Logs manquent dans le terminal

```bash
# AutoCheck doit avoir des console.log() explicites
# Vérifier que la sortie est visible (pas redirigée)

# Relancer le serveur:
npm run dev

# Chercher "🔍 [AutoCheck]" dans les logs
```

### Problem: CARTON ne passe pas de 1 à 0

```bash
# 1. Vérifier la condition dans runAutoCheck():
#    if (cartonStock <= 0) continue;  ← CARTON > 0 requis

# 2. Vérifier que stock_current n'est pas NULL
SELECT stock_current, stock_initial FROM product_units 
WHERE product_id = (SELECT id FROM products WHERE code LIKE 'Biscuit Lorie%');

# 3. Vérifier que auto_stock_factor est > 0 pour MILLIER
SELECT unit_level, auto_stock_factor FROM product_units 
WHERE product_id = (SELECT id FROM products WHERE code LIKE 'Biscuit Lorie%');
```

### Problem: MILLIER ne reçoit que 1 au lieu de 50

```bash
# Vérifier le factor:
SELECT auto_stock_factor FROM product_units 
WHERE product_id = (SELECT id FROM products WHERE code LIKE 'Biscuit Lorie%')
  AND unit_level = 'MILLIER';

# Si factor=0 → pas de conversion
# Si factor=1 → convertit en 1 au lieu de 50
# Solution: UPDATE product_units SET auto_stock_factor = 50 ...
```

---

## ✅ Checklist finale

- [ ] AutoCheck démarre au boot du serveur (log "🚀 [AutoCheck] Démarrage")
- [ ] Biscuit Lorie est dans la DB avec CARTON=1 et MILLIER=0
- [ ] MILLIER a auto_stock_factor=50
- [ ] Attendre 2 secondes
- [ ] Vérifier les logs: "✅ Biscuit Lorie → MILLIER"
- [ ] Vérifier CARTON passe à 0 (DB + terminal)
- [ ] Vérifier MILLIER passe à 50 (DB + terminal)
- [ ] Vérifier 2 stock_moves créées
- [ ] Vérifier 1 sync_operation créée (status='pending')
- [ ] Attendre 2 autres secondes, vérifier pas de 2e action
- [ ] AutoCheck arrête correctement au shutdown (log "⏹️ [AutoCheck] Arrêté")

