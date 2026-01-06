# Module Ventes / Dettes / Clients - Documentation

## Vue d'ensemble

Ce module amélioré gère de manière robuste, fluide et offline-first les ventes, dettes et clients avec synchronisation Google Sheets.

## Fichiers créés/modifiés

### Nouveaux fichiers
| Fichier | Description |
|---------|-------------|
| `src/db/repositories/debts.repo.new.js` | Repository dettes amélioré (USD, items, UUIDs) |
| `src/db/repositories/debt-payments.repo.js` | Repository paiements de dettes (ledger) |
| `src/db/repositories/clients.repo.js` | Repository clients avec création auto |
| `src/api/routes/debts.routes.new.js` | Routes API dettes améliorées |
| `src/api/routes/stats.routes.js` | Routes API statistiques du jour |
| `src/services/stats/day-stats.service.js` | Service calcul stats (ventes + paiements) |
| `src/services/sync/debts-sync-manager.js` | Gestionnaire sync dettes vers Sheets |
| `src/db/migrations/002_debts_clients_improvement.sql` | Migration SQL |
| `run-debts-migration.js` | Script de migration |

---

## Règles métier

### 1. Vente normale (sans dette)
```
Vente → SQL local → sync "Ventes" (Sheets) → Statistiques du jour ✓
```
- Enregistrée dans table `sales`
- Synchronisée vers feuille **"Ventes"**
- Comptabilisée dans **cash du jour**

### 2. Vente en mode dette (crédit)
```
Vente dette → SQL local (debts) → sync "Dettes" (Sheets) → PAS dans stats ventes
```
- Enregistrée dans table `debts` (pas dans `sales` du jour)
- Synchronisée vers feuille **"Dettes"**
- **NE comptabilise PAS** le total dans le cash du jour
- SEULEMENT le paiement initial (si fourni) est comptabilisé

### 3. Paiement d'une dette
```
Paiement → debt_payments → sync Sheets → Statistiques du JOUR DU PAIEMENT ✓
```
- Le paiement du 5 janvier compte dans les stats du 5 janvier
- Même si la dette date du 1er janvier

---

## Devise: USD comme référence

### Principe
- **USD = Source de vérité** (jamais modifié)
- **FC = Affichage** (calculé via taux du jour)

### Colonnes dans `debts`
| Colonne | Description |
|---------|-------------|
| `total_usd` | Montant total de la dette (USD) |
| `paid_usd` | Montant payé (USD) |
| `remaining_usd` | Reste à payer (USD) |
| `total_fc` | Équivalent FC (pour affichage) |
| `paid_fc` | Payé en FC |
| `remaining_fc` | Reste en FC |

---

## API Endpoints

### Dettes

```http
GET  /api/debts                    # Liste dettes (filtres: status, client_name, from_date, to_date)
GET  /api/debts/open               # Dettes non soldées (open + partial)
GET  /api/debts/stats              # Statistiques globales dettes
GET  /api/debts/:id                # Détail d'une dette
GET  /api/debts/uuid/:uuid         # Recherche par UUID
GET  /api/debts/invoice/:invoice   # Recherche par facture

POST /api/debts                    # Créer une dette directement
POST /api/debts/from-sale/:invoice # Créer dette depuis vente existante
POST /api/debts/:id/payments       # Ajouter un paiement
GET  /api/debts/:id/payments       # Liste paiements d'une dette
```

### Paiements du jour
```http
GET /api/debts/payments/day/:date  # Paiements d'un jour (stats)
```

### Clients
```http
GET  /api/debts/clients/search?q=nom  # Recherche autocomplete
POST /api/debts/clients               # Créer un client
GET  /api/debts/clients/:id           # Détails + stats client
GET  /api/debts/client/:uuid/debts    # Dettes d'un client
```

### Statistiques
```http
GET /api/stats/today               # Stats du jour actuel
GET /api/stats/day/:date           # Stats d'un jour spécifique
GET /api/stats/period?from=&to=    # Stats d'une période
GET /api/stats/week                # Stats semaine en cours
GET /api/stats/month               # Stats mois en cours
GET /api/stats/dashboard           # Résumé dashboard (aujourd'hui + dettes ouvertes)
```

---

## Réponse API Stats du jour

```json
{
  "success": true,
  "stats": {
    "date": "2026-01-05",
    "rate_fc_per_usd": 2800,
    
    "total_cash_usd": 150.50,    // Cash réel encaissé
    "total_cash_fc": 421400,     // Équivalent FC
    
    "normal_sales": {
      "count": 10,
      "total_usd": 100.00,
      "total_fc": 280000,
      "items_count": 25
    },
    
    "debt_payments": {          // Paiements dettes du jour
      "count": 3,
      "total_usd": 50.50,
      "total_fc": 141400,
      "debts_concerned": 2
    },
    
    "debts_created": {          // Info (pas dans cash)
      "count": 2,
      "total_amount_usd": 200.00,
      "initial_payments_usd": 20.00
    },
    
    "summary": {
      "transactions_count": 13,
      "total_usd": 150.50,
      "total_fc": 421400
    }
  }
}
```

---

## Création/Modification client

### Création rapide pendant une vente
```javascript
// Si le nom client n'existe pas, il sera créé automatiquement
const debt = await debtsRepo.createFromSale(saleData, {
  initialPaymentUsd: 10.00,
  rateUsed: 2800
});
// Le client est auto-créé dans la table clients
```

### API création client
```http
POST /api/debts/clients
Content-Type: application/json

{
  "name": "Jean Dupont",
  "phone": "+243123456789",
  "email": "jean@example.com"
}
```

### Recherche client (autocomplete)
```http
GET /api/debts/clients/search?q=Jean&limit=10
```

---

## Synchronisation Google Sheets

### Routing automatique
| Type | Feuille Sheets |
|------|----------------|
| Vente normale | `Ventes` |
| Vente dette | `Dettes` |
| Paiement dette | `Dettes` (mise à jour) + optionnel `Dettes_Paiements` |
| Nouveau client | `Clients` ou `Users` |

### Flux de sync
1. Opération locale (offline-first)
2. Création entrée `sync_operations` (op_type: DEBT, DEBT_PAYMENT, CLIENT)
3. Worker push vers Sheets en arrière-plan
4. Stock toujours mis à jour localement d'abord

---

## Migration

### Exécuter la migration
```bash
node run-debts-migration.js
```

### Ce que fait la migration
1. Ajoute colonnes USD à `debts` (paid_usd, remaining_usd, etc.)
2. Crée table `clients`
3. Crée table `debt_items`
4. Ajoute colonnes à `debt_payments`
5. Met à jour les données existantes (calcul USD depuis FC)
6. Crée les index de performance

---

## Exemple d'utilisation: Vente en mode dette

```javascript
// 1. Créer la vente avec mode dette
const saleData = {
  invoice_number: '20260105123456',
  client_name: 'Jean Dupont',
  client_phone: '+243123456789',
  items: [
    { product_code: 'PROD001', product_name: 'Article A', qty: 2, unit_price_usd: 50 }
  ],
  total_usd: 100,
  rate_fc_per_usd: 2800,
  isDebt: true  // <-- Mode dette
};

// 2. Créer la dette (avec paiement initial optionnel)
const debt = debtsRepo.createFromSale(saleData, {
  initialPaymentUsd: 20.00,  // Client paie 20$ maintenant
  rateUsed: 2800
});

// Résultat:
// - Dette créée: total=100$, paid=20$, remaining=80$, status='partial'
// - Paiement initial enregistré dans debt_payments (date: aujourd'hui)
// - Stats du jour: +20$ (seulement le paiement, pas le total de la dette)
// - Sync vers feuille "Dettes" (pas "Ventes")
```

---

## UX Frontend (recommandations)

### Page Vente
1. Case à cocher "Dette" (crédit)
2. Si cochée: afficher champ "Montant payé maintenant (USD)"
3. À la validation: rediriger vers page Dettes et focus sur la dette créée

### Page Dettes
1. Liste des dettes (filtrer: open, partial, paid)
2. Bouton "Ajouter paiement" → modal avec montant USD
3. Affichage du solde restant

### Dashboard
- Utiliser `/api/stats/dashboard` pour afficher:
  - Cash du jour (ventes + paiements dettes)
  - Total dettes ouvertes
  - Top 5 débiteurs
