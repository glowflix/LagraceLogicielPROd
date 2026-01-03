# 🔌 API Endpoints - Sync PRO

**Version:** 1.0  
**Date:** 2025-01-01

---

## 📍 Base URL

```
https://script.google.com/macros/d/YOUR_DEPLOYMENT_ID/usercontent
```

Replace `YOUR_DEPLOYMENT_ID` avec votre ID d'Apps Script (voir déploiement).

---

## 📊 Endpoints GET (Pull)

### 1. `proPull` - Pull Amélioré avec Détection Name/Mark

**Description:** Récupère les modifications de produits depuis une date, avec stratégie de conflits LWW.

**URL:**
```
GET /usercontent?action=proPull&since=2025-01-01T00:00:00Z&includeConflicts=1
```

**Paramètres:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | ✅ | Toujours `"proPull"` |
| `since` | ISO string | ❌ | Date minimum (default: 1970-01-01) |
| `includeConflicts` | 0/1 | ❌ | Inclure les conflits détectés (default: 0) |
| `key` | string | ❌ | API key si configurée |

**Réponse Success:**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "uuid": "550e8400-e29b-41d4-a716-446655440000",
        "code": "LAIT001",
        "name": "Lait Entier Pasteurisé",
        "mark": "DZ",
        "unit": "CARTON",
        "version": 2,
        "updated_at": "2025-01-01T11:30:45.123Z",
        "row": 5,
        "sheet": "Carton",
        "stock": 250
      }
    ],
    "conflicts": [],
    "meta": {
      "total": 1,
      "since": "2025-01-01T00:00:00.000Z",
      "pulledAt": "2025-01-01T11:35:00.000Z",
      "applied": 1,
      "conflicts": 0
    }
  },
  "server_time": "2025-01-01T11:35:00.000Z"
}
```

**Réponse Error:**
```json
{
  "success": false,
  "error": "API key invalide",
  "server_time": "2025-01-01T11:35:00.000Z"
}
```

**Exemple Node.js:**
```javascript
const response = await fetch(
  'https://script.google.com/macros/d/YOUR_ID/usercontent' +
  '?action=proPull' +
  '&since=' + encodeURIComponent(new Date('2025-01-01T00:00:00Z').toISOString())
);
const data = await response.json();

if (data.success) {
  console.log(`✅ ${data.data.meta.total} changement(s) trouvé(s)`);
  for (const product of data.data.products) {
    console.log(`UUID: ${product.uuid}, Name: ${product.name}, Version: ${product.version}`);
  }
}
```

**Logique Côté Local:**
```javascript
// 1. Récupérer les changements
const changes = await proPull(lastSyncTime);

// 2. Pour chaque produit changé
for (const prod of changes.data.products) {
  // 3. Mettre à jour ou insérer
  await db.products.upsert({
    uuid: prod.uuid,
    name: prod.name,
    mark: prod.mark,
    version: prod.version,
    updated_at: prod.updated_at,
    synced_from: 'SHEETS',
    synced_at: new Date()
  });

  // 4. Propager aux product_units
  await db.productUnits.updateByUuid(prod.uuid, {
    name: prod.name,
    mark: prod.mark
  });
}

// 5. Enregistrer sync
lastSyncTime = new Date();
```

---

## 📤 Endpoints POST (Push)

### 1. `proPush` - Push Amélioré avec Propagation Name/Mark

**Description:** Envoie les modifications locales vers Sheets. Propage automatiquement `name` et `mark` sur tous les UUID identiques.

**URL:**
```
POST /usercontent
Content-Type: application/json
```

**Body:**
```json
{
  "action": "proPush",
  "key": "YOUR_API_KEY",  // optionnel si configuré
  "updates": [
    {
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Lait Entier Écrémé",
      "mark": "DZ",
      "unit": "CARTON",
      "version": 3
    },
    {
      "uuid": "660f8400-e29b-41d4-a716-446655440001",
      "name": "Farine Complète",
      "mark": null,
      "unit": "MILLIER"
    }
  ]
}
```

**Paramètres d'Update:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uuid` | string | ✅ | UUID du produit |
| `name` | string | ❌ | Nouveau nom (propagé partout) |
| `mark` | string | ❌ | Nouvelle marque (propagée partout) |
| `unit` | string | ❌ | Unité cible (CARTON/MILLIER/PIECE) |
| `version` | number | ❌ | Version pour vérification |
| `...` | any | ❌ | Autres champs (ignorés) |

**Réponse Success:**
```json
{
  "success": true,
  "applied": [
    {
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "status": "applied",
      "nameChanged": true,
      "markChanged": false
    },
    {
      "uuid": "660f8400-e29b-41d4-a716-446655440001",
      "status": "applied",
      "nameChanged": true,
      "markChanged": false
    }
  ],
  "propagated": [
    {
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Lait Entier Écrémé",
      "mark": "DZ",
      "countPropagated": 3
    }
  ],
  "server_time": "2025-01-01T11:40:00.000Z"
}
```

**Réponse Error:**
```json
{
  "success": false,
  "error": "UUID invalide: abc-123",
  "server_time": "2025-01-01T11:40:00.000Z"
}
```

**Exemple Node.js:**
```javascript
const updates = [
  {
    uuid: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Lait Entier Écrémé',
    mark: 'DZ'
  }
];

const response = await fetch(
  'https://script.google.com/macros/d/YOUR_ID/usercontent',
  {
    method: 'POST',
    body: JSON.stringify({
      action: 'proPush',
      updates: updates
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log(`✅ ${result.applied.length} mise(s) à jour appliquée(s)`);
  for (const prop of result.propagated) {
    console.log(`  → ${prop.countPropagated} ligne(s) mises à jour pour UUID ${prop.uuid}`);
  }
}
```

---

## 🧪 Endpoints Utilitaires

### 1. `test` - Ping

**URL:**
```
GET /usercontent?action=test
```

**Réponse:**
```json
{
  "success": true,
  "server_time": "2025-01-01T11:45:00.000Z"
}
```

**Usage:** Vérifier que le serveur AppScript est accessible.

---

### 2. `batchPull` - Pull Batch (Entités Légères)

**URL:**
```
GET /usercontent?action=batchPull&since=2025-01-01T00:00:00Z&entities=users,rates
```

**Paramètres:**
| Param | Type | Description |
|-------|------|-------------|
| `action` | string | `"batchPull"` |
| `since` | ISO string | Date minimum |
| `entities` | CSV string | Entités à récupérer (users, rates) |

**Réponse:**
```json
{
  "success": true,
  "data": {
    "users": [...],
    "rates": [...]
  },
  "meta": {
    "users": {
      "count": 42,
      "max_updated_at": "2025-01-01T11:00:00Z"
    },
    "rates": {
      "count": 3,
      "max_updated_at": "2025-01-01T10:00:00Z"
    }
  },
  "server_time": "2025-01-01T11:50:00.000Z"
}
```

---

### 3. `batchPush` - Push Batch (Multi-Entity)

**URL:**
```
POST /usercontent
```

**Body:**
```json
{
  "action": "batchPush",
  "device_id": "device-001",
  "ops": [
    {
      "op_id": "op-1001",
      "entity": "product_units",
      "op": "upsert",
      "payload": {
        "code": "LAIT001",
        "name": "Lait Entier",
        "unit_level": "CARTON",
        "stock_current": 500
      }
    },
    {
      "op_id": "op-1002",
      "entity": "sale_items",
      "op": "upsert",
      "payload": {
        "invoice_number": "INV-2025-001",
        "product_code": "LAIT001",
        "qty": 10,
        "unit_price_fc": 2500
      }
    }
  ]
}
```

**Réponse:**
```json
{
  "success": true,
  "applied": [
    {
      "op_id": "op-1001",
      "sheet": "Carton",
      "uuid": "550e8400-..."
    },
    {
      "op_id": "op-1002",
      "sheet": "Ventes",
      "uuid": null
    }
  ],
  "conflicts": [],
  "server_time": "2025-01-01T11:55:00.000Z"
}
```

---

## 🔐 Sécurité

### API Key Configuration

Si vous avez une clé API configurée dans **Apps Script Properties**:

```javascript
// Apps Script Editor → Project Settings → Script Properties
API_KEY = "your-secret-key-123"
```

Toute requête doit inclure:
```
?key=your-secret-key-123   (GET)
{ "key": "your-secret-key-123" } (POST)
```

---

## ⏱️ Rate Limits & Timeouts

| Endpoint | Timeout | Limite |
|----------|---------|--------|
| proPull | 30s | 1 req/sec |
| proPush | 30s | 1 req/sec |
| batchPull | 30s | 1 req/5sec |
| batchPush | 30s | 1 req/5sec |

**Best Practice:** Implémenter un queue côté local pour les pushes simultanés.

---

## 🗂️ Headers Recommandés

```javascript
const headers = {
  'Content-Type': 'application/json',
  'User-Agent': 'LaGrace-App/1.0',
  'X-Device-ID': 'device-001',
  'X-App-Version': '1.0.0'
};
```

---

## 📝 Logs & Debugging

Tous les appels sont loggés dans **Apps Script Logs**:

```
View → Logs (Ctrl+Enter)
```

**Format du log:**
```
[proPull] 📥 Début pull PRO depuis: 2025-01-01T00:00:00.000Z
[proPull] Found 1 changement(s)
[proPull] ✅ Retourner 1 produit(s) modifié(s)
```

**Debugging:**
1. Ouvrir Apps Script Editor
2. Exécuter `backfillAllUUIDs()` ou `getPullChanges()` directement
3. Consulter les logs (Ctrl+Enter)

---

## 💡 Patterns de Sync Recommandés

### Pattern 1: Polling Simple (Toutes les 5 min)

```javascript
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function syncLoop() {
  while (true) {
    try {
      // 1. Pull
      const changes = await proPull(lastSyncTime);
      await applyChanges(changes);

      // 2. Push
      const pending = await getPendingChanges();
      if (pending.length > 0) {
        await proPush(pending);
      }

      lastSyncTime = new Date();
    } catch (error) {
      console.error('Sync error:', error);
    }

    await sleep(SYNC_INTERVAL);
  }
}
```

### Pattern 2: Conflict Resolution

```javascript
async function syncWithConflictHandling() {
  const changes = await proPull(lastSyncTime, { includeConflicts: true });

  for (const conflict of changes.data.conflicts) {
    console.warn(`⚠️ Conflict: ${conflict.uuid}`);
    console.warn(`   Sheets v${conflict.sheets_version} @ ${conflict.sheets_updated_at}`);
    console.warn(`   Local v${conflict.local_version} @ ${conflict.local_updated_at}`);

    // Implémenter votre logique de résolution
    if (conflict.local_version > conflict.sheets_version) {
      // Push local vers Sheets
      await proPush([{ uuid: conflict.uuid, ... }]);
    } else {
      // Accepter Sheets
      await applyChange(conflict.uuid);
    }
  }
}
```

### Pattern 3: Batch Operations

```javascript
async function batchSync() {
  // Récupérer multiple entités en une requête
  const batch = await fetch(
    `?action=batchPull&since=${lastSync}&entities=users,rates,products`
  );
  const data = await batch.json();

  // Appliquer en parallèle
  await Promise.all([
    applyUsers(data.data.users),
    applyRates(data.data.rates),
    applyProducts(data.data.products)
  ]);
}
```

---

**Support & Issues:** Consultez `PRO-SYNC-ARCHITECTURE.md` ou les logs Apps Script.

