# Intégration du Module d'Impression

## ✅ Modifications effectuées

### 1. Module `print/module.js` amélioré
- ✅ Utilise maintenant `C:\Glowflixprojet\printer` au lieu de `C:\Lagrace\printer`
- ✅ Dossiers automatiques : `ok`, `err`, `tmp`, `templates`, `assets`
- ✅ Copie automatique des templates depuis `print/templates` vers `C:\Glowflixprojet\printer\templates`
- ✅ Support du project root via `GLOWFLIX_ROOT_DIR` ou chemin par défaut

### 2. Intégration dans le serveur API
- ✅ Module d'impression initialisé au démarrage
- ✅ Routes d'impression disponibles sur `/api/print/*`
- ✅ WebSocket intégré pour les événements d'impression
- ✅ Démarrage automatique du watcher de fichiers

### 3. Structure des dossiers

```
C:\Glowflixprojet\
└── printer\
    ├── ok\          # Jobs imprimés avec succès
    ├── err\         # Jobs en erreur
    ├── tmp\         # Fichiers temporaires (PDF générés)
    ├── templates\   # Templates Handlebars (.hbs)
    └── assets\      # Assets (logos, images)
```

## 📋 Routes API disponibles

### GET `/api/print/printers`
Liste toutes les imprimantes disponibles

### GET `/api/print/default`
Récupère l'imprimante par défaut

### GET `/api/print/templates`
Liste les templates disponibles

### GET `/api/print/queue`
État de la file d'impression

### GET `/api/print/errors`
Liste les erreurs d'impression

### POST `/api/print/jobs`
Dépose un job d'impression (JSON)

**Exemple** :
```json
{
  "template": "receipt-80",
  "data": {
    "factureNum": "FAC-2024-001",
    "client": "Client Test",
    "taux": 2800,
    "lignes": [
      {
        "code": "A1",
        "nom": "Produit Test",
        "unite": "carton",
        "mark": "JUTE",
        "qteLabel": "1",
        "puFC": 50000,
        "totalFC": 50000
      }
    ],
    "totalFC": 50000,
    "entreprise": {
      "nom": "ALIMENTATION LA GRACE",
      "rccm": "CD/KIS/RCCM 22-A-00172",
      "impot": "A220883T"
    }
  }
}
```

### POST `/api/print/test`
Test d'impression avec données de démo

### POST `/api/print/errors/retry`
Réessayer un job en erreur

## 🖨️ Utilisation depuis les routes Sales

Pour imprimer une facture après une vente, utilisez :

```javascript
// Dans src/api/routes/sales.routes.js
import { getPrintDir } from '../../core/paths.js';
import fs from 'fs';
import path from 'path';

// Après création d'une vente
const printJob = {
  template: 'receipt-80',
  data: {
    factureNum: sale.invoice_number,
    client: sale.client_name,
    taux: sale.rate_fc_per_usd,
    lignes: saleItems.map(item => ({
      code: item.product_code,
      nom: item.product_name,
      unite: item.unit_level,
      mark: item.unit_mark,
      qty: item.qty,
      puFC: item.unit_price_fc,
      totalFC: item.subtotal_fc
    })),
    totalFC: sale.total_fc,
    totalUSD: sale.total_usd,
    printCurrency: sale.payment_mode === 'usd' ? 'USD' : 'FC',
    entreprise: {
      nom: "ALIMENTATION LA GRACE",
      rccm: "CD/KIS/RCCM 22-A-00172",
      impot: "A220883T",
      tel: "+243 896 885 373 / +243 819 082 637"
    }
  }
};

const printDir = getPrintDir();
const jobFile = path.join(printDir, `job-${Date.now()}.json`);
fs.writeFileSync(jobFile, JSON.stringify(printJob, null, 2));
```

## 🔧 Configuration

Variables d'environnement disponibles :

```env
# Chemin du projet (optionnel)
GLOWFLIX_ROOT_DIR=C:\Glowflixprojet

# Impression
PRINTER_NAME=Nom de l'imprimante
PRINT_DEFAULT_TEMPLATE=receipt-80
PRINT_GUARDIAN_AUTO=1
PRINT_KEEP_PDF_ON_OK=0
```

## 📝 Notes

- Les templates sont automatiquement copiés au premier démarrage
- Le module surveille le dossier `printer/` pour les fichiers `.json` et `.pdf`
- Les jobs sont traités automatiquement en arrière-plan
- Les erreurs sont enregistrées dans `printer/err/` avec détails

