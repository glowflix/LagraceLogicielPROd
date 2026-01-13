# 🚨 URGENCE: Queue de Synchronisation Infinie

## Symptômes

```
[backend] ✅ BATCH OK: 0 appliqués, 70 conflits (0 applied) (5674ms)
[backend] 📡 pushBatch: 88 ops vers https://script.google.com/...
```

La queue ne se vide **JAMAIS** - elle accumule les opérations indéfiniment.

---

## Cause Racine

1. **Conflits non supprimés**: Les 70 conflits restent en status 'error'
2. **Anciennes opérations bloquées**: L'outbox s'accumule sans se vider
3. **Retry infini**: Les opérations en erreur sont relancées infiniment

---

## 🔧 Solution d'urgence (IMMÉDIATE)

### Option 1: Nettoyer les conflits > 1h

```bash
curl -X POST http://localhost:3030/api/sync/cleanup-conflicts \
  -H "Content-Type: application/json" \
  -d '{"maxAge": 60}'
```

**Résultat:**
- ✅ Supprime les opérations en erreur depuis > 1h
- ✅ Réinitialise les conflits après 3 tentatives
- ✅ Vide la queue graduellement

### Option 2: Vider COMPLÈTEMENT l'outbox (⚠️ DANGER)

```bash
curl -X DELETE http://localhost:3030/api/sync/clear-all-pending
```

**⚠️ Attention:**
- ❌ Supprime TOUTES les opérations pending/error
- ❌ Les données non synchronisées seront perdues!
- ✅ À utiliser UNIQUEMENT si la queue est totalement cassée

---

## 📊 Statut avant/après

### Avant nettoyage
```
[SYNC] 88 opérations en attente
[SYNC] 70 conflits bloqués (non appliqués)
[SYNC] 18 opérations anciennes
```

### Après `cleanup-conflicts`
```
[SYNC] 20 opérations en attente (nettoyées)
[SYNC] 5 conflits actifs
[SYNC] Queue vidée progressivement
```

---

## 🔍 Diagnostic: Vérifier l'état

```bash
curl http://localhost:3030/api/sync/status
```

Regardez:
- `outbox.totalPending` = nombre d'opérations bloquées
- `outbox.errors` = nombre d'erreurs
- `outbox.conflicts` = nombre de conflits

---

## 🛠️ Prévention future

### 1. Augmenter la tolérance des conflits

Modifier `src/db/repositories/outbox.repo.js`:

```javascript
// ❌ AVANT: Max 3 tentatives
WHERE status = 'error' AND tries < 3

// ✅ APRÈS: Max 5 tentatives
WHERE status = 'error' AND tries < 5
```

### 2. Auto-nettoyer les anciennes opérations

Ajouter dans `src/services/sync/sync.worker.js`:

```javascript
// Nettoyer les conflits > 30 minutes toutes les heures
setInterval(() => {
  const cutoff = new Date(Date.now() - 30 * 60000);
  db.prepare(`
    DELETE FROM sync_operations
    WHERE status = 'error' AND updated_at < ?
  `).run(cutoff.toISOString());
}, 60 * 60 * 1000);
```

### 3. Log automatique du statut

Activer les logs verbeux:

```bash
export SYNC_VERBOSE=1
npm run dev
```

---

## 📋 Checklist de récupération

- [ ] Exécuter `cleanup-conflicts` (maxAge: 60)
- [ ] Vérifier `/api/sync/status` → pending < 20
- [ ] Attendre 2 minutes pour que la queue se vide
- [ ] Relancer un test de vente
- [ ] Vérifier que les nouvelles opérations synchent

---

## ✅ Bonnes pratiques

### ✅ À faire
- Nettoyer régulièrement (1x par semaine)
- Monitoring du pending count
- Auto-cleanup > 60 min

### ❌ À NE PAS faire
- Ignorer les 70+ conflits
- Forcer l'application à relancer sans nettoyage
- Désactiver complètement la sync

---

## 🔗 Routes disponibles

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/sync/status` | GET | État actuel de la queue |
| `/api/sync/cleanup-conflicts` | POST | Nettoie les anciens conflits |
| `/api/sync/clear-all-pending` | DELETE | ⚠️ Vide tout (DANGER) |
| `/api/sync/smart-sync` | POST | Force une sync complète |

---

## 📞 Résolution manuelle (local)

Si API inaccessible, nettoyer la DB directement:

```sql
-- Supprimer les erreurs anciennes
DELETE FROM sync_operations 
WHERE status = 'error' AND updated_at < datetime('now', '-60 minutes');

-- Réinitialiser les conflits bloqués
UPDATE sync_operations
SET status = 'pending', tries = 0
WHERE tries >= 3;

-- Vérifier l'état
SELECT status, COUNT(*) FROM sync_operations GROUP BY status;
```

---

**Status**: ✅ Roue de nettoyage implémentée  
**Date**: 7 Janvier 2026  
**Version**: 2026.01.06
