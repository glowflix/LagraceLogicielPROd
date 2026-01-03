# ✅ GLOWFLIXPROJET - RAPPORT COMPLET DE DIAGNOSTIC

## 📋 RÉSUMÉ EXÉCUTIF

**État**: Base de données locale fonctionnelle ✅
**Chemin**: `C:\Glowflixprojet\db\glowflixprojet.db` ✅
**Problème rapporté**: Nom du produit code '1' ne se synchronise pas vers Google Sheets

---

## 🔍 DIAGNOSTIQUE - PRODUIT CODE '1'

### ✅ État Local (Base de Données)
| Propriété | Valeur | Status |
|-----------|--------|--------|
| **Code** | `1` | ✅ |
| **Nom** | `crist` | ✅ **HAS NAME** |
| **UUID** | `1d6f6b3b-f378-471c-94e4-41ee1d069095` | ✅ |
| **Unités** | 1 (CARTON) | ✅ |
| **Unit UUID** | `96a8387d-b9ff-4bf0-bd9a-e5568e81e190` | ✅ |
| **Prix FC** | 28000.0 | ✅ |
| **Prix USD** | 10.0 | ✅ |
| **Stock** | 44396 | ✅ |
| **Dernière MAJ** | 2026-01-01 13:38:38 | ✅ |

### ❌ Problème: Nom Non Synchronisé vers Google Sheets
- ✅ Nom existe localement: `'crist'`
- ❌ Nom arrive VIDE dans Google Sheets
- 🤔 Cause: À investiguer dans le flux de synchronisation

---

## 📊 ÉTAT DE LA BASE DE DONNÉES

### Résumé
```
📦 Total Produits: 240
  ├─ Sans nom: 4 ❌
  └─ Avec nom: 236 ✅

📦 Total Unités: 304
  └─ Tous les produits ont des unités ✅

📤 Opérations Synchronisation: 39
  └─ Pending push: 138 (dans sync_outbox)
```

### Tables
```
✅ app_license              0 rows
✅ audit_log               45 rows
✅ debt_payments            0 rows
✅ debts                    6 rows
✅ exchange_rates          43 rows
✅ price_logs               0 rows
✅ print_jobs              12 rows
✅ product_units          304 rows
✅ products               240 rows
✅ sale_items              12 rows
✅ sale_voids               0 rows
✅ sales                   12 rows
✅ settings                15 rows
✅ stock_moves              0 rows
✅ sync_operations         39 rows
✅ sync_outbox            138 rows  ← 138 opérations en attente!
✅ user_devices          7983 rows
✅ users                   6 rows
```

---

## 🔄 FLUX DE SYNCHRONISATION ANALYSÉ

### 1. **PUSH** (Local → Google Sheets)
```
sync.worker.js::pushProductPatches()
  ├─ Cherche produit en DB: ✅ CODE '1' TROUVÉ
  ├─ Charge le name: ✅ 'crist'
  ├─ Charge les units: ✅ 1 CARTON
  ├─ Crée op_batch avec:
  │  ├─ code: '1' ✅
  │  ├─ name: 'crist' ✅ (doit être dans le payload)
  │  └─ unit_level: 'CARTON' ✅
  └─ Envoie à Code.gs::handleBatchPush()
```

### 2. **HANDLE** (Google Apps Script)
```
Code.gs::handleBatchPush()
  ├─ Reçoit ops batch
  └─ Pour chaque op:
     └─ Code.gs::handleProductUpsert()
        ├─ Extrait name du payload ← POINT CRITIQUE
        ├─ Cherche la ROW dans Sheets par code+unit_level
        └─ SI name NON-VIDE:
           └─ ✅ Écrit dans colonne "Nom du produit"
        SINON:
           └─ ❌ IGNORE (problème!)
```

---

## 🚨 HYPOTHÈSES DU PROBLÈME

### Hypothèse 1: Le `name` n'arrive pas dans le payload ❌
**Indice**: 
- `sync.worker.js` log: `Name value: finalName='crist'`
- Mais arrive-t-il vraiment à Code.gs?

**Test**:
```javascript
// Dans sync.worker.js ligne ~370, ajouter:
syncLogger.info(`   [BATCH PUSH] Op #0 name='${batch[0].payload.name}'`);
```

### Hypothèse 2: Code.gs reçoit le `name` mais ne l'écrit pas ⚠️
**Indice**: 
- Logique dans `handleProductUpsert` (ligne ~1227):
```javascript
if (colNom > 0 && name !== undefined && name !== null && String(name).trim() !== '') {
  rowData[colNom - 1] = String(name).trim();
  console.log(`   ✅ Nom ÉCRIT: '${String(name).trim()}'`);
} else {
  console.log(`   ⚠️ Nom NOT écrit...`);
}
```

**Possibilité**: 
- `name` arrive comme `undefined` ou `null`
- OR colonne "Nom du produit" n'existe pas dans Sheets

### Hypothèse 3: 138 Opérations en Attente! 🔴
**Grave**: 
- `sync_outbox` a 138 opérations **non confirmées**
- Le push n'a PAS fonctionné correctement
- Les updates ne sont pas appliquées

---

## 📍 CHEMINS CONFIGURATION - TOUS CORRECTS ✅

| Fichier | Chemin | Status |
|---------|--------|--------|
| `config.env` | `DB_PATH=C:\Glowflixprojet\db\glowflixprojet.db` | ✅ |
| `src/core/paths.js` | Retourne automatiquement `C:\Glowflixprojet\db\glowflixprojet.db` | ✅ |
| `src/db/sqlite.js` | Utilise `getDbPath()` | ✅ |
| `check-glowflixprojet-db.py` | `db_path = 'C:/Glowflixprojet/db/glowflixprojet.db'` | ✅ |
| `check-pending-patch.py` | `db_path = 'C:/Glowflixprojet/db/glowflixprojet.db'` | ✅ |

---

## ⚠️ PROBLÈME MAJEUR IDENTIFIÉ

### 138 Opérations en Attente dans `sync_outbox`
```sql
SELECT COUNT(*) FROM sync_outbox WHERE status = 'pending'
→ 138 résultat
```

**Cela signifie**:
1. ❌ Push vers Google Sheets a ÉCHOUÉ
2. ❌ Les modifications ne sont PAS appliquées
3. ❌ Les données locales et Sheets sont DÉSYNCHRONISÉES

**Action URGENTE**: 
- Voir pourquoi le push échoue
- Tester la connexion à Google Apps Script
- Relancer le sync manuellement

---

## 🎯 PROCHAINES ÉTAPES

### ⏳ 1. Vérifier Google Apps Script URL
```bash
echo $env:GOOGLE_SHEETS_WEBAPP_URL
```

### ⏳ 2. Tester le Push Manuellement
```javascript
// Dans Node.js:
import { sheetsClient } from './src/services/sync/sheets.client.js';
const result = await sheetsClient.testConnection();
console.log(result);
```

### ⏳ 3. Vérifier les Logs de Code.gs
1. Ouvrir Google Sheets
2. Tools → Script Editor (Apps Script)
3. Chercher les logs de `handleProductUpsert` pour code '1'
4. Vérifier que `name='crist'` arrive dans le log

### ⏳ 4. Forcer une Resync Complète (si nécessaire)
```bash
# Créer une task qui:
# 1. Marque le produit '1' comme modifié
# 2. Exécute pushProductPatches()
# 3. Vérifie que Google Sheets a reçu l'update
```

---

## 📝 FICHIERS CRÉÉS

1. **FIX-SYNC-PRODUCT-NAME-1.md** - Analyse du problème
2. **diagnostic-product-1.py** - Script de diagnostic Python
3. **CE FICHIER** - Rapport complet

---

## ✅ CONCLUSION

**Base locale**: PARFAITE ✅  
**Problème**: SYNCHRONISATION VERS GOOGLE SHEETS ❌  
**Solution**: À investiguer dans le flux push/Code.gs

**Priorié**:
1. Vérifier les 138 opérations en attente
2. Tester la connexion à Apps Script
3. Relancer le sync manuellement
