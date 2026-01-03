# 🚀 Architecture PRO: Sync Offline-First & Cohérence Produits

**Date:** 2025-01-01  
**Version:** PRO v1  
**Objectif:** Synchronisation fiable bidirectionnelle entre Google Sheets et SQL local, sans doublons, sans perte de données.

---

## 📋 Table des Matières

1. [Principes Fondamentaux](#principes-fondamentaux)
2. [Structure Sheets Recommandée](#structure-sheets-recommandée)
3. [Comportement Sheets](#comportement-sheets)
4. [Modèle SQL](#modèle-sql)
5. [Endpoints API](#endpoints-api)
6. [Menu Admin Sheets](#menu-admin-sheets)
7. [Stratégie de Conflits](#stratégie-de-conflits)
8. [Workflows Pratiques](#workflows-pratiques)
9. [Troubleshooting](#troubleshooting)

---

## 🎯 Principes Fondamentaux

### Règle #1: UUID = Clé Unique (Obligatoire)

❌ **JAMAIS** utiliser Nom (B) ou Mark (F) comme clé de recherche  
✅ **TOUJOURS** utiliser UUID pour identifier un produit

**Pourquoi?** Si quelqu'un renomme le produit (B), tu perds le lien avec la BD locale → crée un doublon.

### Règle #2: Colonnes Techniques Intouchables

Garder ces colonnes tout à droite, jamais au milieu:
- `_uuid` : identifiant unique (généré auto si manquant)
- `_updated_at` : timestamp (mise à jour auto)
- `_version` : compteur d'incréments (auto)
- `_deleted` : suppression logique (optionnel)

### Règle #3: Cohérence Inter-Unités

Si le même produit existe dans **Carton** ET **Pièce**:
- Un seul UUID pour ce produit
- Un seul nom/mark (propriété globale du produit)
- Propager automatiquement les modifs name/mark partout

### Règle #4: Pas de UUID = Danger

Toute ligne sans `_uuid` est susceptible de créer un doublon.  
→ Code.gs auto-backfill si manquant (via `onEdit`)

---

## 📊 Structure Sheets Recommandée

### Exemple: Feuille "Carton"

| A | B | C | ... | F | ... | _uuid | _updated_at | _version | _deleted | _unit |
|---|---|---|-----|---|-----|-------|-------------|----------|----------|-------|
| # | **Nom du produit** | Code produit | ... | **Mark** | ... | UUID | ISO 8601 | Nombre | Bool | "CARTON" |
| 1 | Lait Entier | LAIT001 | ... | DZ | ... | `abc-123-def-456` | 2025-01-01T10:30:00Z | 2 | FALSE | CARTON |
| 2 | Farine | FARINE01 | ... | (vide) | ... | `xyz-789-uvw-012` | 2025-01-01T14:15:00Z | 1 | FALSE | CARTON |

**Colonnes gardées:**
- B: `Nom du produit` (à gauche, peut changer)
- F: `Mark` (à gauche, peut changer)
- Stock, Prix, etc. (colonnes métier)

**Colonnes ajoutées (à droite):**
- `_uuid`: Stable, jamais changé
- `_updated_at`: Auto-rempli à chaque modif
- `_version`: Incrément auto
- `_deleted`: Suppression logique (optionnel)
- `_unit`: "CARTON" / "MILLIER" / "PIECE" (optionnel, déduit du nom de feuille)

---

## 🔄 Comportement Sheets (onEdit)

### Quand quelqu'un modifie Colonne B (Nom) ou F (Mark)

Code.gs déclenche automatiquement:

1. ✅ Remplit `_uuid` si manquant (génère `Utilities.getUuid()`)
2. ✅ Met à jour `_updated_at` = `NOW()`
3. ✅ Incrémente `_version` = `_version + 1`
4. ✅ Logue le changement (console)

**Exemple:**
```
Avant:  | Lait | DZ | | uuid=abc-123 | updated_at=2025-01-01T10:00Z | version=1 |
Après:  | Lait Entier | DZ | | uuid=abc-123 | updated_at=2025-01-01T11:00Z | version=2 |
```

### Quand quelqu'un modifie autre colonne (Stock, Prix, etc.)

- ✅ `_updated_at` s'auto-remplit (mais `_version` ne s'incrémente que pour B/F)
- Permet la sync incrémentale sans recharger tout

---

## 💾 Modèle SQL (Local)

### Table: `products` (Maître)

```sql
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,        -- Clé de sync avec Sheets
  name TEXT NOT NULL,               -- Globalement unique (propagé partout)
  mark TEXT,                        -- Marque (propagée partout)
  version INTEGER DEFAULT 0,        -- Numéro de version
  updated_at DATETIME,              -- Timestamp du serveur
  deleted BOOLEAN DEFAULT FALSE,    -- Suppression logique
  synced_from TEXT,                 -- "SHEETS" ou "LOCAL"
  synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Table: `product_units` (Par Unité)

```sql
CREATE TABLE product_units (
  id INTEGER PRIMARY KEY,
  product_uuid TEXT NOT NULL,       -- FK vers products
  unit TEXT NOT NULL,               -- "CARTON" / "MILLIER" / "PIECE"
  stock INTEGER,
  price_usd DECIMAL,
  price_fc DECIMAL,
  version INTEGER DEFAULT 0,
  updated_at DATETIME,
  deleted BOOLEAN DEFAULT FALSE,
  synced_from TEXT,                 -- "SHEETS" ou "LOCAL"
  synced_at DATETIME,
  UNIQUE (product_uuid, unit),
  FOREIGN KEY (product_uuid) REFERENCES products(uuid)
);
```

### Avantages:
- `name` et `mark` sont **globaux** au produit (pas dupliqués)
- Stock/Prix sont **par unité** (CARTON vs MILLIER)
- `version` permet la détection de conflits
- `updated_at` permet le LWW (Last Write Wins)

---

## 🌐 Endpoints API

### 1️⃣ **GET ?action=proPull&since=...** (Pull Améloré)

**Récupère les modifications depuis Sheets.**

```bash
GET https://script.google.com/macros/d/.../usercontent?action=proPull&since=2025-01-01T00:00:00Z
```

**Réponse:**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "uuid": "abc-123-def-456",
        "code": "LAIT001",
        "name": "Lait Entier",
        "mark": "DZ",
        "unit": "CARTON",
        "version": 2,
        "updated_at": "2025-01-01T11:00:00Z",
        "row": 2,
        "sheet": "Carton"
      }
    ],
    "meta": {
      "total": 1,
      "since": "2025-01-01T00:00:00Z",
      "pulledAt": "2025-01-01T11:30:00Z",
      "applied": 1,
      "conflicts": 0
    }
  },
  "server_time": "2025-01-01T11:30:00Z"
}
```

**À faire côté Local:**
1. Pour chaque `product` changé → UPDATE `products.name / products.mark / products.version`
2. Propager `name` et `mark` sur tous les `product_units` de ce `uuid`
3. Enregistrer `synced_at` = maintenant

---

### 2️⃣ **POST { action: 'proPush', updates: [...] }** (Push Améloré)

**Envoie les modifications locales vers Sheets et propage name/mark.**

```bash
POST https://script.google.com/macros/d/.../usercontent
Body:
{
  "action": "proPush",
  "updates": [
    {
      "uuid": "abc-123-def-456",
      "name": "Lait Entier Écrémé",  // nom changé
      "mark": "DZ",
      "unit": "CARTON"
    }
  ]
}
```

**Ce que Code.gs fait automatiquement:**
1. Trouve tous les UUID "abc-123-def-456" dans Carton, Milliers, Pièce
2. Mets à jour **Nom** et **Mark** partout
3. Mets à jour `_updated_at` et `_version` pour chaque ligne
4. Retourne le nombre de lignes mises à jour

**Réponse:**
```json
{
  "success": true,
  "applied": [
    {
      "uuid": "abc-123-def-456",
      "status": "applied",
      "nameChanged": true,
      "markChanged": false
    }
  ],
  "propagated": [
    {
      "uuid": "abc-123-def-456",
      "name": "Lait Entier Écrémé",
      "mark": "DZ",
      "countPropagated": 3  // 3 unités mises à jour
    }
  ],
  "server_time": "2025-01-01T11:30:00Z"
}
```

---

### 3️⃣ **GET ?action=test** (Ping)

Vérifie que le serveur AppScript est accessible.

```bash
GET https://script.google.com/macros/d/.../usercontent?action=test

Response: { "success": true, "server_time": "..." }
```

---

## 📱 Menu Admin Sheets

Ouvre le menu **"LaGrace Admin"** depuis Sheets.

### 🆔 Backfill All UUIDs
Parcourt Carton, Milliers, Pièce et génère UUID pour toutes les lignes vides.

**Usage:** Au démarrage ou après import de données manuelles.

```
Click → "LaGrace Admin" → "🆔 Backfill All UUIDs"
Result: "✅ Succès! 42 UUID(s) généré(s)"
```

### 📥 Pull Changes (PRO)
Affiche les changements depuis une date donnée.

```
Click → "LaGrace Admin" → "📥 Pull Changes (PRO)"
Prompt: "2025-01-01T00:00:00Z" (ou tapez "today")
Result: Liste les produits modifiés
```

### 🔄 Sync Status
Vérifie l'état de chaque feuille:
- Combien de lignes ont un `_uuid`?
- Combien ont un `_updated_at`?

```
Click → "LaGrace Admin" → "🔄 Sync Status"
Result:
  Carton: 42/42 avec _uuid, 42/42 avec _updated_at ✅
  Milliers: 18/20 avec _uuid ⚠️
  Pièce: 256/256 avec _uuid ✅
```

### 📋 Show Tech Columns
Affiche les colonnes techniques trouvées par feuille.

### ✅ Validate Schema
Vérifie que toutes les colonnes tech requises existent.

---

## 🔀 Stratégie de Conflits

### Cas 1: Modification Sheets + Modification Local (simultané)

**Scénario:** 
- Quelqu'un change le nom sur Sheets à 10:00 (version 2)
- Quelqu'un change aussi le nom en local à 10:05 (version 3)
- Pull à 10:10

**Stratégie: Last Write Wins (LWW)**

```javascript
// Dans syncWithConflictResolution():
if (local_version > sheets_version) {
  // Local plus récent → garder local
  // Enregistrer comme conflit (audit)
  conflicts.push({
    uuid,
    reason: 'LOCAL_NEWER',
    winner: 'LOCAL'
  });
} else {
  // Sheets plus récent ou égal → appliquer Sheets
  applied.push({ uuid, ... });
}
```

**Audit:**
Tous les conflits sont enregistrés dans les logs:
```
[syncWithConflictResolution] ⚠️ Conflit: abc-123 (local plus récent)
  Sheets version=2, updated_at=2025-01-01T10:00Z
  Local  version=3, updated_at=2025-01-01T10:05Z
```

### Cas 2: Doublon (deux UUID pour le même produit)

**Prévention automatique:**
1. `onEdit` génère UUID automatiquement
2. Pas d'import sans UUID
3. Si doublon détecté → backfill + merge manuel

**Détection:** Menu "🔄 Sync Status" → voir les stats par feuille

---

## 💼 Workflows Pratiques

### Workflow 1: Premier Démarrage (Backfill)

```mermaid
1. Ouvrir Sheets
2. Menu "LaGrace Admin" → "🆔 Backfill All UUIDs"
   ✅ Tous les produits ont maintenant un UUID
3. Menu "🔄 Sync Status" → vérifier les stats
4. Effectuer le premier Pull:
   GET ?action=proPull&since=1970-01-01
5. Charger tout dans SQL local
```

### Workflow 2: Modification Nom/Mark (Sheets → Local)

```mermaid
1. Admin modifie "Lait" → "Lait Entier Écrémé" sur Sheets
2. onEdit se déclenche:
   - _uuid reste "abc-123" ✅
   - _updated_at = NOW
   - _version = 2
3. App locale effectue Pull:
   GET ?action=proPull&since=LAST_SYNC
4. Reçoit:
   { uuid: "abc-123", name: "Lait Entier Écrémé", version: 2, ... }
5. UPDATE products SET name = "Lait Entier Écrémé", version = 2 WHERE uuid = "abc-123"
6. PROPAGATE: UPDATE product_units SET ... (tous les CARTON, MILLIER, PIECE avec uuid="abc-123")
```

### Workflow 3: Modification Stock/Prix (Local → Sheets)

```mermaid
1. POS met à jour stock local: UPDATE product_units SET stock = 100 WHERE uuid = "abc-123"
2. App locale effectue Push:
   POST { action: 'proPush', updates: [{ uuid: "abc-123", stock: 100 }] }
3. Code.gs retrouve uuid "abc-123" dans toutes les feuilles
4. Met à jour la cellule Stock
5. onEdit s'auto-déclenche:
   - _updated_at = NOW
   - _version++ (si stock change)
6. Retourne: "✅ 3 lignes mises à jour (Carton, Millier, Pièce)"
```

### Workflow 4: Conflit Résolu (LWW)

```mermaid
Sheets modifié:  Lait Entier     (version 2, 10:00)
Local  modifié:  Lait Écrémé     (version 3, 10:05)

Pull à 10:10:
  → Local plus récent (v3 > v2)
  → Garder "Lait Écrémé"
  → Enregistrer conflit dans logs
  → Push inverse vers Sheets (optionnel)
```

---

## 🐛 Troubleshooting

### Problem 1: Ligne sans UUID
```
Diagnostic: Menu "🔄 Sync Status" montre "18/20 avec _uuid"
Cause: Ligne créée avant le déploiement PRO
Fix: Menu "🆔 Backfill All UUIDs"
```

### Problem 2: Doublon (même produit 2x)
```
Diagnostic: 2 lignes avec name="Lait", mark="DZ" mais UUID différents
Cause: Import manuel sans UUID check
Fix: 
  1. Garder un UUID (plus ancien = source de vérité)
  2. Supprimer ou merger l'autre
  3. Backfill + Pull/Push
```

### Problem 3: Modification non synchronisée
```
Diagnostic: Changé nom sur Sheets, Pull ne le voit pas
Cause: onEdit pas déclenché (copier-coller, formatage, etc.)
Fix: 
  1. Ouvrir la cellule et taper directement (trigger onEdit)
  2. Ou: Menu "📥 Pull Changes" manuellement
```

### Problem 4: Conflits trop fréquents
```
Diagnostic: Lots de "LOCAL_NEWER" dans les logs
Cause: App local et Sheets modifient en même temps
Fix: 
  1. Pull d'abord, puis Push (séquentiellement)
  2. Ou: Utiliser des windows temporels (ex: Pull le matin, Push l'après-midi)
  3. Ou: Donner priorité à une source (ex: Sheets = source de vérité pour name/mark)
```

### Problem 5: Menu "LaGrace Admin" absent
```
Diagnostic: Menu n'apparaît pas dans Sheets
Cause: onOpen() pas exécuté
Fix: 
  1. Recharger la page Sheets (F5)
  2. Ou: Ouvrir le Apps Script editor et exécuter onOpen() manuellement
```

---

## 📈 Améliorations Futures

- [ ] Table `sync_conflicts` pour audit complet
- [ ] Merge automatique des doublons
- [ ] Dashboard de sync status (temps réel)
- [ ] Versioning des colonnes (track chaque champ)
- [ ] Rollback sur conflit grave
- [ ] Webhook bi-directionnel (temps réel au lieu de polling)

---

**Support:** Consultez les logs Apps Script (Ctrl+Enter) pour plus de détails.

