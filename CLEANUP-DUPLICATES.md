# Scripts de Nettoyage des Doublons UUID

## 🧹 Audit des Doublons Existants

### Vérifier les UUIDs dupliquées dans sale_items

```sql
-- 1. AUDIT: Identifier les UUIDs dupliquées
SELECT uuid, COUNT(*) as occurrences, GROUP_CONCAT(id) as ids
FROM sale_items 
WHERE uuid IS NOT NULL AND uuid != '' 
GROUP BY uuid 
HAVING COUNT(*) > 1
ORDER BY occurrences DESC;

-- 2. STATISTIQUES: Nombre total de doublons
SELECT 
  COUNT(DISTINCT uuid) as uuids_dupliquees,
  SUM(occurrences - 1) as lignes_a_supprimer,
  COUNT(*) as total_lignes_affectees
FROM (
  SELECT uuid, COUNT(*) as occurrences
  FROM sale_items 
  WHERE uuid IS NOT NULL AND uuid != '' 
  GROUP BY uuid 
  HAVING COUNT(*) > 1
);

-- 3. DÉTAIL: Afficher les UUIDs dupliquées avec leurs données
SELECT id, uuid, invoice_number, sold_at, product_code, qty, client_name, created_at
FROM sale_items
WHERE uuid IN (
  SELECT uuid FROM (
    SELECT uuid, COUNT(*) as cnt
    FROM sale_items 
    WHERE uuid IS NOT NULL AND uuid != '' 
    GROUP BY uuid 
    HAVING COUNT(*) > 1
  )
)
ORDER BY uuid, id;
```

## 🗑️ Suppression des Doublons (3 Stratégies)

### Stratégie 1: Garder le PLUS ANCIEN (recommandé)

```sql
-- Supprimer tous les doublons SAUF le premier (id le plus bas)
DELETE FROM sale_items 
WHERE id IN (
  SELECT id FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id ASC) as rn
    FROM sale_items 
    WHERE uuid IS NOT NULL AND uuid != ''
  )
  WHERE rn > 1
);
```

### Stratégie 2: Garder le PLUS RÉCENT (si modification après synchronisation)

```sql
-- Supprimer tous les doublons SAUF le dernier (id le plus haut)
DELETE FROM sale_items 
WHERE id IN (
  SELECT id FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id DESC) as rn
    FROM sale_items 
    WHERE uuid IS NOT NULL AND uuid != ''
  )
  WHERE rn > 1
);
```

### Stratégie 3: Garder le PLUS MIS À JOUR (basé sur updated_at)

```sql
-- Supprimer les doublons, garder la version la plus à jour
DELETE FROM sale_items 
WHERE id IN (
  SELECT id FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY updated_at DESC, id DESC) as rn
    FROM sale_items 
    WHERE uuid IS NOT NULL AND uuid != ''
  )
  WHERE rn > 1
);
```

## 🔍 Vérification Après Nettoyage

```sql
-- 1. Vérifier qu'il n'y a plus de doublons
SELECT uuid, COUNT(*) as count
FROM sale_items 
WHERE uuid IS NOT NULL AND uuid != '' 
GROUP BY uuid 
HAVING COUNT(*) > 1;
-- Doit retourner: (aucun résultat / empty set)

-- 2. Comparer avant/après
-- UUIDs uniques (devrait égaler le nombre de lignes)
SELECT 
  COUNT(*) as total_rows,
  COUNT(DISTINCT uuid) as unique_uuids,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT uuid) THEN '✅ OK'
    ELSE '❌ DOUBLONS DÉTECTÉS'
  END as status
FROM sale_items
WHERE uuid IS NOT NULL AND uuid != '';

-- 3. Vérifier l'intégrité des données restantes
SELECT 
  uuid, 
  COUNT(*) as count,
  MIN(created_at) as first_created,
  MAX(created_at) as last_modified
FROM sale_items
WHERE uuid IS NOT NULL AND uuid != ''
GROUP BY uuid
ORDER BY count DESC;
```

## 📋 Procédure Complète de Nettoyage

### Avant de commencer

```bash
# 1. Sauvegarder la base de données
cp app.db app.db.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ Backup créé"

# 2. Vérifier l'intégrité de la BD
sqlite3 app.db "PRAGMA integrity_check;"
# Doit retourner: ok

# 3. Afficher les statistiques avant
sqlite3 app.db << EOF
.mode column
.headers on
SELECT 
  'AVANT NETTOYAGE' as phase,
  COUNT(*) as total_rows,
  COUNT(DISTINCT uuid) as unique_uuids,
  COUNT(*) - COUNT(DISTINCT uuid) as doublons
FROM sale_items
WHERE uuid IS NOT NULL AND uuid != '';
EOF
```

### Exécution du nettoyage

```bash
# 4. Exécuter le nettoyage (Stratégie 1 par défaut)
sqlite3 app.db << EOF
BEGIN TRANSACTION;

-- Sauvegarde des doublons supprimés (optionnel)
CREATE TABLE IF NOT EXISTS sale_items_duplicates_backup AS
SELECT * FROM sale_items 
WHERE id IN (
  SELECT id FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id ASC) as rn
    FROM sale_items 
    WHERE uuid IS NOT NULL AND uuid != ''
  )
  WHERE rn > 1
);

-- Suppression des doublons
DELETE FROM sale_items 
WHERE id IN (
  SELECT id FROM sale_items_duplicates_backup
);

COMMIT;
EOF
echo "✅ Nettoyage complété"

# 5. Afficher les statistiques après
sqlite3 app.db << EOF
.mode column
.headers on
SELECT 
  'APRÈS NETTOYAGE' as phase,
  COUNT(*) as total_rows,
  COUNT(DISTINCT uuid) as unique_uuids,
  COUNT(*) - COUNT(DISTINCT uuid) as doublons
FROM sale_items
WHERE uuid IS NOT NULL AND uuid != '';
EOF
```

### Vérification finale

```bash
# 6. Valider l'intégrité
sqlite3 app.db "PRAGMA integrity_check;"

# 7. Compter les UUIDs uniques vs lignes
sqlite3 app.db << EOF
SELECT 
  COUNT(*) as total,
  COUNT(DISTINCT uuid) as unique_uuids,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT uuid) THEN '✅ OK - Zéro doublon'
    ELSE '⚠️  ATTENTION - Doublons restants'
  END as status
FROM sale_items
WHERE uuid IS NOT NULL AND uuid != '';
EOF

# 8. Redémarrer le service
npm run dev
echo "✅ Service redémarré"
```

## 🔗 Auditer les Autres Entités

Appliquer le même nettoyage à d'autres tables si nécessaire:

```sql
-- Vérifier tous les UUIDs dupliquées dans le schéma
SELECT 'users' as table_name, uuid, COUNT(*) as count FROM users WHERE uuid IS NOT NULL AND uuid != '' GROUP BY uuid HAVING COUNT(*) > 1
UNION ALL
SELECT 'products', uuid, COUNT(*) FROM products WHERE uuid IS NOT NULL AND uuid != '' GROUP BY uuid HAVING COUNT(*) > 1
UNION ALL
SELECT 'debts', uuid, COUNT(*) FROM debts WHERE uuid IS NOT NULL AND uuid != '' GROUP BY uuid HAVING COUNT(*) > 1
UNION ALL
SELECT 'rates', uuid, COUNT(*) FROM rates WHERE uuid IS NOT NULL AND uuid != '' GROUP BY uuid HAVING COUNT(*) > 1;
```

## ⚠️ Notes Importantes

### Avant le Nettoyage
- ✅ **TOUJOURS** faire un backup (`app.db.backup`)
- ✅ Arrêter le service de sync (pour éviter la concurrence)
- ✅ Exécuter en mode `BEGIN TRANSACTION` (permet rollback si erreur)

### Stratégie de Suppression
- **Stratégie 1** (Garder ancien): Mieux si la première entrée est l'originale
- **Stratégie 2** (Garder récent): Mieux si les doublons contiennent des modifications
- **Stratégie 3** (Garder à jour): Utilise le timestamp de modification

### Après le Nettoyage
- ✅ Valider l'intégrité avec `PRAGMA integrity_check;`
- ✅ Vérifier que `COUNT(*) == COUNT(DISTINCT uuid)`
- ✅ Redémarrer le service et refaire un sync complet

## 🚀 Automatisation (Script Bash)

```bash
#!/bin/bash
# cleanup-duplicates.sh

DB_FILE="app.db"
BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "🧹 Nettoyage des UUIDs dupliquées - $TIMESTAMP"

# Créer le répertoire de backup
mkdir -p "$BACKUP_DIR"

# Backup
cp "$DB_FILE" "$BACKUP_DIR/${DB_FILE}.backup.$TIMESTAMP"
echo "✅ Backup: $BACKUP_DIR/${DB_FILE}.backup.$TIMESTAMP"

# Audit avant
echo ""
echo "📊 AVANT NETTOYAGE:"
sqlite3 "$DB_FILE" << EOF
SELECT 
  COUNT(*) as total_rows,
  COUNT(DISTINCT uuid) as unique_uuids,
  COUNT(*) - COUNT(DISTINCT uuid) as doublons
FROM sale_items
WHERE uuid IS NOT NULL AND uuid != '';
EOF

# Exécution du nettoyage
echo ""
echo "🧹 Suppression des doublons..."
sqlite3 "$DB_FILE" << EOF
BEGIN TRANSACTION;
DELETE FROM sale_items 
WHERE id IN (
  SELECT id FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id ASC) as rn
    FROM sale_items 
    WHERE uuid IS NOT NULL AND uuid != ''
  )
  WHERE rn > 1
);
COMMIT;
EOF

# Audit après
echo ""
echo "📊 APRÈS NETTOYAGE:"
sqlite3 "$DB_FILE" << EOF
SELECT 
  COUNT(*) as total_rows,
  COUNT(DISTINCT uuid) as unique_uuids,
  COUNT(*) - COUNT(DISTINCT uuid) as doublons,
  CASE 
    WHEN COUNT(*) - COUNT(DISTINCT uuid) = 0 THEN '✅ OK'
    ELSE '⚠️  ATTENTION'
  END as status
FROM sale_items
WHERE uuid IS NOT NULL AND uuid != '';
EOF

echo ""
echo "✅ Nettoyage complété!"
```

Utilisation:
```bash
chmod +x cleanup-duplicates.sh
./cleanup-duplicates.sh
```

---

**Auteur**: AI Assistant  
**Date**: 2025-12-30  
**Basé sur**: SYNC-DEDUPLICATION-FIX.md
