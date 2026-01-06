# Guide d'Intégration - Mode Dette dans les Ventes

## Résumé des modifications

### Fichiers modifiés
1. **src/api/routes/sales.routes.js** - Ajout du mode dette complet
2. **src/api/server.js** - Switch vers debts.routes.new.js
3. **src/db/sqlite.js** - Correction migration table clients

### Fichiers créés précédemment (à activer)
- `src/db/repositories/debts.repo.new.js` - Repo dettes amélioré
- `src/db/repositories/debt-payments.repo.js` - Ledger paiements
- `src/db/repositories/clients.repo.js` - Gestion clients
- `src/api/routes/debts.routes.new.js` - Routes API dettes
- `src/api/routes/stats.routes.js` - Routes statistiques
- `src/services/day-stats.service.js` - Calcul stats du jour

---

## Utilisation Frontend - Mode Dette

### 1. Structure de la requête POST /api/sales

```javascript
// Vente normale
const salePayload = {
  items: [...],
  total_fc: 100000,
  total_usd: 35.71,
  rate_fc_per_usd: 2800,
  printCurrency: 'FC',
  client_name: 'Client Comptant',
  payment_mode: 'cash'
};

// Vente en mode DETTE
const debtPayload = {
  items: [...],
  total_fc: 100000,
  total_usd: 35.71,
  rate_fc_per_usd: 2800,
  
  // ✅ Activer le mode dette
  isDebt: true,
  
  // ✅ Client OBLIGATOIRE (doit exister ou être créé)
  client_name: 'Jean Bosco',
  client_phone: '+243 899 123 456',
  
  // ✅ Paiement initial (optionnel, 0 si rien payé)
  paid_amount_usd: 10.00,
  
  // Mode impression automatique USD pour dettes
  printCurrency: 'USD',
};
```

### 2. Réponse de l'API

```javascript
// Réponse vente normale
{
  success: true,
  sale: { id: 123, invoice_number: "20260612143022", ... },
  sync_status: 'pending',
  print_status: 'pending'
}

// Réponse mode dette
{
  success: true,
  isDebt: true,
  debt: {
    id: 45,
    uuid: "d1e2f3...",
    invoice_number: "20260612143022",
    client_name: "Jean Bosco",
    total_usd: 35.71,
    paid_usd: 10.00,
    remaining_usd: 25.71,
    status: "partial"
  },
  sync_status: 'pending',
  print_status: 'pending'
}
```

---

## Flux Frontend Recommandé

### Étape 1: Recherche/Création Client

```javascript
// Rechercher un client existant
const searchClients = async (query) => {
  const response = await fetch(`/api/sales/clients/search?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  return data.results; // Array de clients avec { id, name, phone, source: 'user'|'client' }
};

// Créer un nouveau client (si pas trouvé)
const createClient = async (name, phone = null) => {
  const response = await fetch('/api/sales/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone })
  });
  return response.json(); // { success: true, client: {...}, existed: false }
};
```

### Étape 2: Composant Mode Dette

```jsx
// React/Vue pseudo-code
const SaleForm = () => {
  const [isDebtMode, setIsDebtMode] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientSearch, setClientSearch] = useState([]);
  const [paidAmountUsd, setPaidAmountUsd] = useState(0);
  const [currency, setCurrency] = useState('FC');
  
  // ✅ Quand mode dette activé → forcer USD
  useEffect(() => {
    if (isDebtMode) {
      setCurrency('USD');
    }
  }, [isDebtMode]);
  
  // ✅ Autocomplete client
  const handleClientSearch = async (query) => {
    if (query.length >= 2) {
      const results = await searchClients(query);
      setClientSearch(results);
    }
  };
  
  // ✅ Soumission
  const handleSubmit = async () => {
    // Validation mode dette
    if (isDebtMode && !clientName.trim()) {
      alert('Client obligatoire pour une dette');
      return;
    }
    
    const payload = {
      items,
      total_fc: totalFC,
      total_usd: totalUSD,
      rate_fc_per_usd: exchangeRate,
      client_name: clientName,
      printCurrency: currency,
      
      // Mode dette
      isDebt: isDebtMode,
      paid_amount_usd: isDebtMode ? paidAmountUsd : null,
    };
    
    const response = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (result.isDebt) {
      // Rediriger vers la page des dettes ou afficher message
      alert(`Dette créée: ${result.debt.remaining_usd} USD restant`);
    } else {
      // Vente normale
      alert(`Vente effectuée: ${result.sale.invoice_number}`);
    }
  };
  
  return (
    <form>
      {/* ... items, totaux ... */}
      
      {/* Checkbox Mode Dette */}
      <label>
        <input 
          type="checkbox" 
          checked={isDebtMode} 
          onChange={(e) => setIsDebtMode(e.target.checked)} 
        />
        Mode Dette
      </label>
      
      {/* Afficher champs dette si activé */}
      {isDebtMode && (
        <div className="debt-fields">
          {/* Client obligatoire */}
          <input
            type="text"
            placeholder="Nom du client (obligatoire)"
            value={clientName}
            onChange={(e) => {
              setClientName(e.target.value);
              handleClientSearch(e.target.value);
            }}
            required
          />
          
          {/* Autocomplete résultats */}
          {clientSearch.length > 0 && (
            <ul className="autocomplete">
              {clientSearch.map(c => (
                <li key={c.id} onClick={() => setClientName(c.name)}>
                  {c.name} {c.phone && `(${c.phone})`}
                </li>
              ))}
            </ul>
          )}
          
          {/* Paiement initial optionnel */}
          <input
            type="number"
            placeholder="Montant payé maintenant (USD)"
            value={paidAmountUsd}
            onChange={(e) => setPaidAmountUsd(parseFloat(e.target.value) || 0)}
            min="0"
            step="0.01"
          />
          
          {/* Info: reste à payer */}
          <div className="debt-info">
            <p>Total dette: {totalUSD.toFixed(2)} USD</p>
            <p>Payé maintenant: {paidAmountUsd.toFixed(2)} USD</p>
            <p><strong>Reste à payer: {(totalUSD - paidAmountUsd).toFixed(2)} USD</strong></p>
          </div>
        </div>
      )}
      
      <button type="submit">
        {isDebtMode ? 'Créer Dette' : 'Valider Vente'}
      </button>
    </form>
  );
};
```

---

## API Endpoints Disponibles

### Ventes/Dettes
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/sales/clients/search?q=...` | Recherche clients (autocomplete) |
| POST | `/api/sales/clients` | Créer nouveau client |
| POST | `/api/sales` | Créer vente OU dette selon `isDebt` |

### Dettes
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/debts` | Liste toutes les dettes |
| GET | `/api/debts/open` | Dettes non soldées |
| GET | `/api/debts/:id` | Détails d'une dette |
| POST | `/api/debts/:id/payments` | Ajouter un paiement |
| GET | `/api/debts/:id/payments` | Liste des paiements |
| GET | `/api/debts/payments/day/:date` | Paiements d'un jour |

### Statistiques
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/stats/today` | Stats du jour (ventes + paiements dettes) |
| GET | `/api/stats/day/:date` | Stats d'un jour spécifique |
| GET | `/api/stats/period?from=&to=` | Stats d'une période |
| GET | `/api/stats/dashboard` | Tableau de bord complet |

---

## Format Google Sheets - Feuille "Dettes"

Les dettes sont synchronisées avec ces colonnes:

| Colonne | Description |
|---------|-------------|
| Client | Nom du client |
| Produit | Description des produits |
| Argent | Devise (toujours "USD") |
| prix a payer | Total en USD |
| prix payer deja | Montant déjà payé |
| reste | Montant restant |
| date | Date création (YYYY-MM-DD) |
| numero de facture | Numéro facture |
| Dollars | Total USD (duplicate) |
| objet\Description | Description des items |
| Dettes Fc en usd | Équivalent FC |
| _uuid | UUID unique |
| _updated_at | Date dernière MAJ |
| _device_id | ID appareil |

---

## Règles Métier Rappel

1. **USD = Devise de référence** pour toutes les dettes
2. **FC = Affichage uniquement**, calculé via taux du jour
3. **Client obligatoire** pour créer une dette
4. **Paiements tracés** avec date → comptent dans stats du jour de paiement
5. **Stock réduit** immédiatement (comme vente normale)
6. **Impression** génère un reçu avec mention "DETTE"

---

## Test Rapide

```bash
# 1. Créer une dette
curl -X POST http://localhost:3333/api/sales \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"product_code": "001", "product_name": "Test", "qty": 1, "unit_price_usd": 10, "unit_price_fc": 28000, "subtotal_usd": 10, "subtotal_fc": 28000, "unit_level": "piece"}],
    "total_usd": 10,
    "total_fc": 28000,
    "rate_fc_per_usd": 2800,
    "isDebt": true,
    "client_name": "Test Client",
    "paid_amount_usd": 3
  }'

# 2. Voir les dettes ouvertes
curl http://localhost:3333/api/debts/open

# 3. Ajouter un paiement
curl -X POST http://localhost:3333/api/debts/1/payments \
  -H "Content-Type: application/json" \
  -d '{"amount_usd": 5}'
```
