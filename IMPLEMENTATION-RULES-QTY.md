# Implémentation des Règles de Quantité - OFFLINE-FIRST

## ✅ Modifications effectuées

### 1. Utilitaires de normalisation et règles quantité (`src/core/qty-rules.js`)

**Fichier créé** : `src/core/qty-rules.js`

Fonctions principales :
- `normalizeUnit(unit)` : Normalise l'unité vers "carton" | "milliers" | "piece"
- `normalizeMark(mark)` : Normalise le MARK avec tolérance DZ
- `getQtyPolicy(unit, markNorm)` : Calcule la politique de quantité
- `validateAndCorrectQty(qty, policy)` : Valide et corrige une quantité
- `validateQtyBackend(qty, unit, markNorm)` : Validation backend stricte

**Règles implémentées** :
- **Carton** : décimal autorisé (0.25, 0.5, 1.75, etc.)
- **Milliers + DZ** : décimal autorisé (0.5, 0.25, 1, 2, etc.)
- **Milliers + non-DZ** : décimal interdit, entier obligatoire, min = 1
- **Piece** : décimal interdit, entier obligatoire, min = 1

### 2. Modification SalesPOS.jsx

**Règles appliquées en temps réel** :
- ✅ Correction automatique lors de la saisie de quantité
- ✅ Blocage des décimales pour milliers non-DZ et piece
- ✅ Correction instantanée lors du changement d'unité/mark
- ✅ Validation au blur pour correction finale
- ✅ Boutons +/- respectent les règles

**Fonctions modifiées** :
- `addItemToSale` : Applique les règles avant ajout
- `updateItemQty` : Applique les règles lors de modification
- Input quantité : Bloque les décimales selon la politique
- Changement unité/mark : Réinitialise la quantité selon la nouvelle politique

### 3. Endpoint backend POST /api/sales

**Pipeline A - Vente (OFFLINE-FIRST)** :
- ✅ Validation des quantités selon les règles strictes
- ✅ Génération numéro facture au format YYYYMMDDHHmmss
- ✅ Transaction SQL locale (vente + items + réduction stock)
- ✅ Création sync_queue (pending) pour :
  - Ventes → feuille "Ventes"
  - Stock → feuilles "Carton"/"Milliers"/"Piece"
  - Prix effectué → feuille "Stock de prix effectué"
- ✅ Création print_job (pending) dans la base + fichier JSON
- ✅ Réponse immédiate même offline

**Fichiers modifiés** :
- `src/api/routes/sales.routes.js` : Endpoint POST /api/sales amélioré
- `src/core/invoice.js` : Ajout `generateTimestampInvoiceNumber()`

### 4. Repository print_jobs (`src/db/repositories/print-jobs.repo.js`)

**Fichier créé** : `src/db/repositories/print-jobs.repo.js`

Fonctions :
- `create(printJobData)` : Crée un job d'impression
- `findByInvoice(invoiceNumber)` : Trouve un job par facture
- `getPending(limit)` : Récupère les jobs en attente
- `markProcessing(id)` : Marque comme en cours
- `markPrinted(id)` : Marque comme imprimé
- `markError(id, errorMessage)` : Marque comme erreur
- `getStatus(invoiceNumber)` : Récupère le statut pour une facture

### 5. Schéma SQL (`src/db/schema.sql`)

**Table ajoutée** : `print_jobs`
```sql
CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'receipt-80',
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|printed|error
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  printed_at TEXT,
  FOREIGN KEY(invoice_number) REFERENCES sales(invoice_number)
);
```

### 6. Modification SalesDetail.jsx

**Affichage des statuts** :
- ✅ Badge Sync : Synchronisation Google Sheets (synced/pending/error)
- ✅ Badge Print : Impression (printed/pending/processing/error)
- ✅ Affichage des dates de sync/print
- ✅ Affichage des erreurs si présentes

### 7. Modification SalesHistory.jsx

**Badges dans la liste** :
- ✅ Badge Sync pour chaque vente (synced/pending)
- ✅ Badge Print pour chaque vente (printed/pending/processing/error)
- ✅ Chargement automatique des statuts d'impression
- ✅ Tooltips avec détails

### 8. Endpoint API Print (`src/api/routes/print.routes.js`)

**Route ajoutée** :
- `GET /api/print/status/:invoice` : Récupère le statut d'impression pour une facture

## 📋 Architecture des 3 pipelines

### Pipeline A - Vente (chemin critique)
1. Validation quantité (règles strictes)
2. Transaction SQL locale
3. Création sync_queue (pending)
4. Création print_job (pending)
5. Réponse immédiate

### Pipeline B - Sync Sheets (worker arrière-plan)
- Toutes les ~10 secondes
- Lit sync_queue (pending)
- Push batch vers Google Sheets
- Marque synced si succès

### Pipeline C - Impression (watcher print/module.js)
- Toutes les 1-2 secondes
- Lit print_jobs (pending) OU fichiers JSON dans printer/
- Imprime via watcher existant
- Marque printed si succès

## 🔄 Mapping Google Sheets

**Feuilles utilisées** :
- `Ventes` : Append lignes facture
- `Carton` : Update stock (colonne Stock initial)
- `Milliers` : Update stock (colonne Stock initial)
- `Piece` : Update stock (colonne Stock initial)
- `Stock de prix effectué` : Append journal prix

## ⚠️ Points importants

1. **OFFLINE-FIRST** : La vente fonctionne toujours, même sans Internet
2. **Numéro facture** : Format YYYYMMDDHHmmss (heure locale PC)
3. **Règles quantité** : Appliquées en temps réel côté UI + validation backend
4. **Sync arrière-plan** : Ne bloque jamais la vente
5. **Impression automatique** : Via print_job + watcher existant

## 🧪 Tests à effectuer

- [ ] milliers + DZ + qty 0,50 → accepté → stock -0.5
- [ ] milliers + DZ + qty 0,25 → accepté
- [ ] milliers + PAQUE + qty 0,5 → UI corrige instantanément à 1
- [ ] milliers + BT + qty 0 → UI corrige à 1
- [ ] piece + qty 0,5 → UI corrige à 1
- [ ] carton + qty 0,25 → accepté
- [ ] offline total : finaliser vente → OK, stock local réduit, print_job créé, sync_queue pending

