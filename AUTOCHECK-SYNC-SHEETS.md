# AutoCheck → Synchronisation Sheets

## 🔄 Flux complet: AutoCheck → Sheets

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. AutoCheck (toutes les 2 secondes)                             │
│    - Scanne tous les produits                                    │
│    - Si CARTON > 0 ET cible (PIECE/MILLIER) = 0                │
│    - Déclenche applyAutoStock()                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. applyAutoStock() crée 3 choses:                              │
│    ✅ stock_moves (2 lignes: CARTON -1, PIECE/MILLIER +factor)│
│    ✅ sync_operations (1 opération STOCK_MOVE, status=pending) │
│    ✅ Updates directs: stock_initial & stock_current          │
│       + synced_at = NULL (force resync)                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. SyncWorker (toutes les 10 secondes)                          │
│    - checkConnection() → ping Google Sheets                      │
│    - Si online:                                                  │
│      • Lit sync_operations (status='pending')                   │
│      • Envoie les mouvements à Sheets                           │
│      • Mark: status='sent' ou 'acked'                           │
│    - Si offline:                                                │
│      • Attend connexion (retry automatique)                     │
│      • Stock_moves reste en pending dans la DB                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Google Sheets                                                │
│    - Reçoit les stock_moves                                     │
│    - Met à jour colonne STOCK                                   │
│    - Envoie ack: status='acked'                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## ✅ Intégration AutoCheck dans le flux sync

Les `sync_operations` créées par AutoCheck sont **automatiquement** traitées par le SyncWorker.

### Fichiers impliqués:

1. **router.autostock.js** (AutoCheck)
   - Crée `sync_operations` avec `status='pending'`
   - Crée `stock_moves` avec `device_id='AUTO_CHECK'`

2. **sync.worker.js** (SyncWorker)
   - Lit les `sync_operations` en pending
   - Envoie vers Sheets
   - Gère la connexion avec `checkConnection()`

---

## 🌐 Détection de connexion

Le SyncWorker a une fonction `checkConnection()` qui:

```javascript
async checkConnection() {
  try {
    // Ping Google Sheets avec timeout 3s
    const response = await axios.get(webAppUrl, {
      params: { entity: 'test' },
      timeout: 3000,
    });
    
    // Connexion OK
    isOnline = true;
  } catch (error) {
    // Connexion perdue
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      isOnline = false;
    }
  }
}
```

### Comportement:

| Connexion | État | Comportement |
|-----------|------|-------------|
| 🟢 Online | `isOnline=true` | Push immédiat vers Sheets (10s) |
| 🔴 Offline | `isOnline=false` | Stocke en DB, retry automatique |
| 🟡 Timeout | `isOnline=false` | Retry après 10s |

---

## 📊 Logs connexion

Quand AutoCheck crée une opération:

```
✅ Biscuit Lorie → MILLIER:
   CARTON: 1 → 0
   MILLIER: 0 → 50
   sync_op_id: a1b2c3d4-e5f6-...
```

Le SyncWorker (10 sec plus tard):

```
🔍 [PUSH-SYNC] Tentative de synchronisation...
📊 État connexion: isOnline=true
📊 [STOCK_MOVE] 1 mouvement(s) à envoyer
🌐 [SHEETS] Envoi vers Google Sheets...
✅ [SHEETS] sync_operations mises à jour (status=sent)
```

### Si pas de connexion:

```
⚠️ [PUSH-SYNC] État isOnline=false
   Opérations restent en pending (status=pending)
   Attente connexion...
   
🌐 [INTERNET] Connexion Internet détectée
✅ [AUTO-SYNC] Synchronisation automatique déclenchée
```

---

## 🔧 Configuration requise

### .env ou config.env:

```env
# Synchronisation
SYNC_INTERVAL_MS=10000
GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/YOUR_KEY/usercodeapp

# AutoCheck
# (Pas de variable spécifique, utilise le DB du serveur)
```

---

## 📝 Exemple: Tracer un mouvement de stock

### 1. AutoCheck déclenche (t=0s)

```
✅ AutoCheck: RIZ-001 → PIECE
   CARTON: 10 → 9
   PIECE: 0 → 50
   sync_op_id: uuid-1234
```

### 2. Vérifier DB (t=1s)

```sql
-- Vérifier les stocks changés
SELECT unit_level, stock_current, last_update, synced_at
FROM product_units
WHERE product_id = (SELECT id FROM products WHERE code = 'RIZ-001');

-- Résultat:
-- unit_level | stock_current | last_update | synced_at
-- CARTON     | 9             | 2026-01-02  | NULL      ← synced_at=NULL force resync
-- PIECE      | 50            | 2026-01-02  | NULL
```

### 3. Vérifier sync_operations (t=2s)

```sql
SELECT op_id, op_type, status, created_at
FROM sync_operations
WHERE entity_code = 'RIZ-001'
ORDER BY created_at DESC
LIMIT 1;

-- Résultat:
-- op_id        | op_type     | status  | created_at
-- uuid-1234    | STOCK_MOVE  | pending | 2026-01-02 14:23:45
```

### 4. SyncWorker envoie (t=10s)

```
🔍 [PUSH-SYNC] Tentative...
📊 [STOCK_MOVE] 1 mouvement(s) à envoyer
✅ Envoi vers Sheets réussi
```

### 5. Sheets reçoit et ack (t=12s)

```sql
SELECT op_id, status, sent_at, acked_at
FROM sync_operations
WHERE op_id = 'uuid-1234';

-- Résultat final:
-- op_id     | status | sent_at | acked_at
-- uuid-1234 | acked  | 14:23:55| 14:23:56
```

---

## ❌ Troubleshooting

### Problem: Opérations restent en pending (offline)

```bash
# 1. Vérifier la connexion Internet
ping script.google.com

# 2. Vérifier l'URL dans config.env
grep GOOGLE_SHEETS_WEBAPP_URL config.env

# 3. Redémarrer serveur pour tester checkConnection()
npm run dev
```

### Problem: sync_operations pas créées par AutoCheck

```bash
# 1. Vérifier que AutoCheck fonctionne
grep "✅ AutoCheck" logs/app.log

# 2. Vérifier que les sync_operations existent
sqlite3 data.db "SELECT COUNT(*) FROM sync_operations WHERE op_type='STOCK_MOVE' AND device_id='AUTO_CHECK';"

# Si COUNT=0: AutoCheck ne crée pas les opérations
# → Vérifier runAutoCheck() crée bien sync_operations
```

### Problem: Sheets ne reçoit pas les mouvements

```bash
# 1. Vérifier que SyncWorker tourne
grep "PUSH-SYNC" logs/backend.log

# 2. Vérifier la connexion
grep "isOnline=" logs/backend.log

# 3. Vérifier les erreurs d'envoi
grep "SHEETS" logs/backend.log
```

---

## 🎯 Résumé

| Étape | Fonction | Résultat |
|-------|----------|----------|
| 1️⃣ AutoCheck (2s) | runAutoCheck() | Creates sync_op + stock_moves |
| 2️⃣ Stock update | updateUnitStocks() | synced_at=NULL |
| 3️⃣ SyncWorker (10s) | checkConnection() | Ping Google Sheets |
| 4️⃣ Push | pushPendingOperations() | Envoie à Sheets |
| 5️⃣ Sheets ack | Apps Script | status='acked' |

**Aucune action supplémentaire nécessaire** - le flux est automatique! 🚀

