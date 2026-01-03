# 📋 CONFIGURATION GLOWFLIXPROJET - DATABASE PATH FIX

## ✅ DIAGNOSTIQUE COMPLET

### 1. BASE DE DONNÉES LOCALE
- **Chemin**: `C:\Glowflixprojet\db\glowflixprojet.db` ✅ (CORRECT)
- **État**: Existe et contient des données ✅
- **Produit Code '1'**: 
  - Name: `crist` ✅ (NON VIDE - différent de ce que l'utilisateur dit)
  - UUID: `1d6f6b3b-f378-471c-94e4-41ee1d069095` ✅
  - Updated: `2026-01-01 13:38:38` ✅

### 2. STRUCTURE DE CHEMINS EN CODE
- `src/core/paths.js::getDbPath()` → Retourne automatiquement `C:\Glowflixprojet\db\glowflixprojet.db` en mode CLI ✅
- `config.env` → `DB_PATH=C:\Glowflixprojet\db\glowflixprojet.db` ✅
- `src/db/sqlite.js` → Utilise `getDbPath()` ✅

---

## 🔴 PROBLÈME IDENTIFIÉ: SYNCHRONISATION NOM PRODUIT

### Le Problème
L'utilisateur dit que le nom du produit code '1' **reste vide** dans Google Sheets, alors qu'il a un nom localement.

### Cause Probable
**Le produit code '1' a probablement UN SEUL UNIT_LEVEL** mais le système essaie de le synchroniser vers **TROIS FEUILLES** (CARTON, MILLIER, PIECE).

### Trace de Synchronisation

```
LOCAL (SQLite):
├─ Product code '1'
│  ├─ name: 'crist' ✅
│  ├─ uuid: '1d6f6b3b-f378-471c-94e4-41ee1d069095'
│  └─ units: [ ???  ]  ← PROBLÈME: Pas clair les unit_levels existants

SYNC FLOW:
1. pushProductPatches() 
   └─ Cherche le produit en DB
   └─ Récupère TOUS les units du produit
   └─ Crée une op par unit (fan-out)
   └─ Envoie à Code.gs

2. Code.gs::handleProductUpsert()
   └─ Reçoit code + name + unit_level
   └─ Cherche la ROW dans la bonne feuille (CARTON / MILLIER / PIECE)
   └─ SI row NOT FOUND → CREATE NEW ROW
   └─ SI row FOUND → UPDATE
   
SYMPTÔME: Row peut être trouvée vide (ancien bug de création)
```

---

## ✅ SOLUTIONS

### Solution 1: Vérifier les Units du Produit '1'
```python
# Dans check-db-schema.py ajouter:
cursor.execute("""
    SELECT id, unit_level, unit_mark, sale_price_fc 
    FROM product_units 
    WHERE product_id = (SELECT id FROM products WHERE code = '1')
""")
for row in cursor.fetchall():
    print(f"  Unit: {row[1]}/{row[2]}, Price FC: {row[3]}")
```

### Solution 2: Forcer Resync Complet
Créer un script pour:
1. Marquer le produit '1' comme MODIFIÉ dans `outbox`
2. Relancer `pushProductPatches()` manuellement
3. Vérifier que Google Sheets reçoit l'update

### Solution 3: Corriger le Logic handleProductUpsert (si nécessaire)
Si le problème est que `name` ne s'écrit pas:
- Vérifier que `payload.name` n'est pas vide en arrivant à Code.gs
- Vérifier que `colNom` est trouvée correctement dans Sheets

---

## 📝 SCRIPTS À EXÉCUTER (DANS L'ORDRE)

### 1. Diagnostic Complet
```bash
& "D:/logiciel/La Grace pro/v1/.venv/Scripts/python.exe" "check-db-schema.py"
```

### 2. Créer Script de Resync du Produit '1'
[SEE NEXT FILE: resync-product-code-1.js]

### 3. Tester Push Manuel
```bash
node resync-product-code-1.js
```

### 4. Vérifier dans Google Sheets
- Ouvrir Sheets
- Aller dans tous les tabs (CARTON, MILLIER, PIECE)
- Chercher code '1' → doit avoir `name='crist'`

---

## 🎯 CHEMINS DÉJÀ CORRECTS ✅
Tous les scripts pointent déjà vers le bon chemin:
- `config.env` ✅
- `src/core/paths.js` ✅  
- `src/db/sqlite.js` ✅
- Scripts Python: `check-glowflixprojet-db.py`, `check-pending-patch.py` ✅

---

## 📊 PROCHAINES ÉTAPES
1. ✅ Vérifier les units du produit '1'
2. ⏳ Créer opération de resync
3. ⏳ Executer et tester
4. ⏳ Confirmer que nom s'écrit dans Sheets
