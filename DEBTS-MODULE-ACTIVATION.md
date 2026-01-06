# 🚀 Guide d'Activation du Module Dettes/Clients Amélioré

## ✅ État Actuel

Les fichiers suivants ont été créés et sont prêts à l'emploi:

### Nouveaux fichiers créés
| Fichier | Description |
|---------|-------------|
| `src/db/repositories/debts.repo.new.js` | Repository amélioré avec USD comme référence |
| `src/db/repositories/debt-payments.repo.js` | Ledger des paiements |
| `src/db/repositories/clients.repo.js` | Gestion des clients |
| `src/services/stats/day-stats.service.js` | Service statistiques combinées |
| `src/api/routes/stats.routes.js` | Routes API statistiques |
| `src/api/routes/debts.routes.new.js` | Routes API dettes améliorées |
| `src/services/sync/debts-sync-manager.js` | Manager de synchronisation |

### Migrations (intégrées dans sqlite.js)
Les migrations s'appliqueront automatiquement au démarrage:
- ✅ Table `clients` (nouvelle)
- ✅ Table `debt_items` (nouvelle)
- ✅ Colonnes additionnelles sur `debts` (client_uuid, paid_usd, remaining_usd, items_json, etc.)
- ✅ Colonnes additionnelles sur `debt_payments` (uuid, amount_usd, rate_fc_per_usd, etc.)

## 🔧 Activation du Nouveau Module

### Option 1: Activation complète (recommandé)

1. **Backup de la base de données**
```powershell
Copy-Item "C:\Glowflixprojet\db\glowflixprojet.db" "C:\Glowflixprojet\db\glowflixprojet_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').db"
```

2. **Remplacer les fichiers**
```powershell
# Backup des anciens fichiers
Move-Item "src\db\repositories\debts.repo.js" "src\db\repositories\debts.repo.old.js"
Move-Item "src\api\routes\debts.routes.js" "src\api\routes\debts.routes.old.js"

# Activer les nouveaux fichiers
Move-Item "src\db\repositories\debts.repo.new.js" "src\db\repositories\debts.repo.js"
Move-Item "src\api\routes\debts.routes.new.js" "src\api\routes\debts.routes.js"
```

3. **Redémarrer le serveur**
```powershell
# Les migrations s'appliqueront automatiquement
npm run dev
```

### Option 2: Activation graduelle (coexistence)

Garder les deux versions en parallèle et utiliser les nouvelles routes sous un préfixe différent:

1. **Dans server.js**, ajouter:
```javascript
import debtsRoutesNew from './routes/debts.routes.new.js';
// ...
app.use('/api/debts-v2', debtsRoutesNew);
```

2. Les anciennes routes `/api/debts` continuent de fonctionner
3. Les nouvelles routes sont accessibles via `/api/debts-v2`

## 📊 Nouveaux Endpoints API

### Statistiques (déjà actif)
```
GET /api/stats/today          # Stats du jour (ventes + paiements dettes)
GET /api/stats/day/:date      # Stats d'un jour spécifique
GET /api/stats/week           # Stats de la semaine
GET /api/stats/month          # Stats du mois
GET /api/stats/period?from=&to= # Stats d'une période
GET /api/stats/dashboard      # Résumé pour dashboard
```

### Dettes (après activation)
```
GET  /api/debts                # Liste des dettes avec filtres
GET  /api/debts/:id            # Détails d'une dette
POST /api/debts                # Créer une dette
POST /api/debts/from-sale      # Créer depuis une vente
POST /api/debts/:id/pay        # Enregistrer un paiement
GET  /api/debts/:id/payments   # Historique des paiements
POST /api/debts/:id/sync       # Forcer sync vers Sheets
```

### Clients (après activation)
```
GET  /api/clients              # Liste des clients
GET  /api/clients/search       # Recherche autocomplete
GET  /api/clients/:id          # Détails d'un client
POST /api/clients              # Créer un client
PUT  /api/clients/:id          # Modifier un client
```

## 🔄 Comportement du Module

### Règles USD/FC
- **Montants stockés**: USD uniquement (`debt_amount_usd`, `paid_usd`, `remaining_usd`)
- **Affichage FC**: Calculé à la volée avec le taux du jour
- **Taux de création**: Enregistré dans `rate_fc_per_usd` pour historique

### Comptabilisation dans les stats
| Type de transaction | Compte dans stats du jour de... |
|---------------------|--------------------------------|
| Vente normale (cash) | ✅ La vente |
| Vente en Dette (acompte) | ✅ La vente (seulement l'acompte) |
| Paiement de dette | ✅ Le paiement |

### Sync vers Google Sheets
| Type | Feuille cible |
|------|---------------|
| Vente normale | "Ventes" |
| Vente dette (création) | "Dettes" |
| Paiement dette | "Dettes" (mise à jour) |
| Client nouveau | "Clients" |

## 🧪 Tests de Vérification

### 1. Vérifier les migrations
```sql
-- Vérifier la table clients
SELECT name FROM sqlite_master WHERE type='table' AND name='clients';

-- Vérifier les nouvelles colonnes sur debts
PRAGMA table_info(debts);

-- Vérifier la table debt_items
PRAGMA table_info(debt_items);
```

### 2. Tester l'API stats
```bash
curl http://localhost:3000/api/stats/today
curl http://localhost:3000/api/stats/dashboard
```

### 3. Tester création de dette (après activation)
```bash
curl -X POST http://localhost:3000/api/debts \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Jean Test",
    "client_phone": "0999999999",
    "total_usd": 150,
    "initial_payment_usd": 50,
    "note": "Test dette",
    "items": [
      { "product_code": "PROD001", "product_name": "Produit Test", "quantity": 2, "unit_price_usd": 75 }
    ]
  }'
```

## 📁 Structure des Fichiers

```
src/
├── api/
│   ├── routes/
│   │   ├── debts.routes.js       # Ancien (à remplacer)
│   │   ├── debts.routes.new.js   # Nouveau (à activer)
│   │   └── stats.routes.js       # ✅ Déjà actif
│   └── server.js                 # ✅ stats déjà intégré
├── db/
│   ├── repositories/
│   │   ├── debts.repo.js         # Ancien (à remplacer)
│   │   ├── debts.repo.new.js     # Nouveau (à activer)
│   │   ├── debt-payments.repo.js # ✅ Nouveau
│   │   └── clients.repo.js       # ✅ Nouveau
│   └── sqlite.js                 # ✅ Migrations intégrées
└── services/
    ├── stats/
    │   └── day-stats.service.js  # ✅ Nouveau
    └── sync/
        └── debts-sync-manager.js # ✅ Nouveau
```

## ⚠️ Points d'Attention

1. **Backup obligatoire** avant activation
2. Les données existantes seront migrées (UUIDs générés automatiquement)
3. Le frontend doit être adapté pour utiliser les nouveaux endpoints
4. Tester en environnement de développement avant production

## 🎯 Prochaines Étapes Frontend

Pour exploiter pleinement le nouveau module, le frontend devrait:

1. Utiliser `/api/stats/today` pour le dashboard (affiche ventes + paiements)
2. Lors de création de vente en "Dette":
   - POST vers `/api/debts/from-sale` avec les items et l'acompte
3. Pour les paiements de dettes:
   - POST vers `/api/debts/:id/pay`
4. Autocomplete clients:
   - GET `/api/clients/search?q=...`
