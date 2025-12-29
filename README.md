# Glowflixprojet

Système de gestion de point de vente (POS) offline-first avec synchronisation Google Sheets.

## Caractéristiques principales

- ✅ **Offline-first**: Fonctionne 100% hors ligne, synchronisation en arrière-plan
- ✅ **SQLite local**: Base de données locale rapide et fiable
- ✅ **Synchronisation Google Sheets**: Bidirectionnelle, par lots toutes les 10 secondes
- ✅ **WebSocket temps réel**: Mises à jour en temps réel sur tous les clients
- ✅ **Gestion multi-unités**: Carton, Millier, Pièce avec conversion automatique
- ✅ **Quantités fractionnées**: Support 0.25, 0.5, 1.5, etc.
- ✅ **Impression par queue**: Système de jobs d'impression robuste
- ✅ **Annulation factures**: Restauration automatique du stock
- ✅ **Licence offline**: Clé fixe 0987654321, aucune connexion requise

## Structure du projet

```
Glowflixprojet-app/
├── src/
│   ├── core/           # Utilitaires de base (paths, logger, etc.)
│   ├── db/            # Base de données SQLite (schema, migrations, repositories)
│   ├── services/      # Services métier (stock, ventes, sync, print)
│   ├── api/           # API REST + WebSocket (routes, middlewares)
│   └── ui/            # Interface utilisateur (HTML/JS)
├── tools/
│   └── apps-script/   # Code Google Apps Script pour la synchronisation
└── package.json
```

## Installation

1. **Cloner le projet**
```bash
git clone <repository>
cd Glowflixprojet-app
```

2. **Installer les dépendances**
```bash
npm install
```

3. **Configurer l'environnement**
```bash
# Créer le fichier .env à la racine du projet
# Copiez le contenu de config.env dans .env
# IMPORTANT: Ajoutez vos identifiants Google Sheets :
GOOGLE_SHEETS_SPREADSHEET_ID=111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI
GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec
```

4. **Initialiser la base de données**
```bash
npm run migrate
```

5. **Démarrer le serveur**
```bash
npm start
```

Le serveur démarre sur `http://localhost:3030` par défaut.

## Configuration Google Sheets

### Identifiants
- **Spreadsheet ID**: `111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI`
- **URL du Spreadsheet**: https://docs.google.com/spreadsheets/d/111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI/edit
- **Apps Script Web App URL**: https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec

### Étapes de configuration

1. Ouvrez votre Google Spreadsheet: https://docs.google.com/spreadsheets/d/111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI/edit
2. Allez dans `Extensions` > `Apps Script`
3. Copiez le contenu de `tools/apps-script/Code.gs` (l'ID du Spreadsheet est déjà configuré)
4. Déployez comme application web et copiez l'URL
5. Ajoutez l'ID et l'URL dans votre `.env` :
   - `GOOGLE_SHEETS_SPREADSHEET_ID`
   - `GOOGLE_SHEETS_WEBAPP_URL`

## Feuilles Google Sheets

Le système synchronise avec ces feuilles:
- **Carton**: Produits vendus par carton
- **Milliers**: Produits vendus par millier  
- **Piece**: Produits vendus à la pièce
- **Ventes**: Historique des ventes
- **Dettes**: Dettes clients
- **Taux**: Taux de change FC/USD
- **Compter Utilisateur**: Comptes utilisateurs
- **Stock de prix effectué**: Logs des prix vendus

## Arborescence de données

Le système crée automatiquement cette structure sur Windows:
```
C:\Glowflixprojet\
├── db\                 # Base de données SQLite
├── data\               # Cache, imports, exports, backups
├── printer\            # Queue d'impression (ok, err, tmp, templates)
├── logs\               # Fichiers de logs
└── config\             # Configuration et secrets
```

## API Principale

### Authentification
- `POST /api/auth/login` - Connexion utilisateur

### Produits
- `GET /api/products` - Liste des produits
- `POST /api/products` - Créer/modifier produit
- `GET /api/stock?level=carton|millier|piece` - Stock par unité

### Ventes
- `POST /api/sales` - Créer une vente
- `GET /api/sales` - Liste des ventes
- `GET /api/sales/:invoice` - Détail d'une vente
- `POST /api/sales/:invoice/void` - Annuler une vente
- `POST /api/sales/:invoice/print` - Imprimer une facture

### Dettes
- `GET /api/debts` - Liste des dettes
- `POST /api/debts/from-sale/:invoice` - Créer dette depuis vente
- `POST /api/debts/:id/payments` - Ajouter un paiement

### Analytics
- `GET /api/analytics/today` - Statistiques du jour
- `GET /api/analytics/range?from=&to=` - Statistiques par période
- `GET /api/analytics/top-products` - Top produits

### Synchronisation
- `GET /api/sync/status` - État de la synchronisation
- `POST /api/sync/push-now` - Forcer push vers Sheets
- `POST /api/sync/pull-now` - Forcer pull depuis Sheets

## Licence

Licence offline avec clé fixe: `0987654321`

## Développement

```bash
# Mode développement avec watch
npm run dev

# Migrations base de données
npm run migrate
```

## Débogage avec Chrome DevTools MCP

Pour améliorer le débogage avec l'IA dans Cursor, configurez Chrome DevTools MCP :

🚀 **Installation rapide** : Voir [INSTALLATION-MCP.md](./INSTALLATION-MCP.md) (5 minutes)

📖 **Documentation complète** : Voir [SETUP-CHROME-DEVTOOLS-MCP.md](./SETUP-CHROME-DEVTOOLS-MCP.md)

Cette configuration permet à l'IA d'analyser automatiquement :
- Les erreurs de la console
- Les requêtes réseau qui échouent
- Les stack traces
- Les problèmes de performance

**Vérification des prérequis** :
```bash
npm run check:mcp
```

**Configuration guidée (Windows)** :
```bash
npm run setup:mcp
```

## Support

Pour toute question ou problème, consultez la documentation dans `projet IDEEE.txt`.

