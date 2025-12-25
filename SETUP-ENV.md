# Configuration des fichiers d'environnement

## Problème résolu

Le fichier `.env` était mélangé entre backend (Node.js) et frontend (Vite), causant des conflits.

## Solution : Séparation Backend / Frontend

### 1. Fichier `.env` (Backend Node.js)

Copiez `config.env` vers `.env` :

```bash
# Windows PowerShell
Copy-Item config.env .env
```

Le fichier `.env` contient toutes les variables backend (NODE_ENV, PORT, DB_PATH, etc.)

### 2. Fichier `.env.development` (Frontend Vite)

Créez un fichier `.env.development` à la racine avec :

```env
# Configuration Vite/UI (DÉVELOPPEMENT)
# NE PAS mettre NODE_ENV ici (Vite le gère automatiquement)

VITE_API_URL=http://localhost:3030
VITE_DEV_MODE=1
VITE_PORT=5173
```

## Corrections apportées dans config.env

1. ✅ **Doublon APP_BASE_URL supprimé** (gardé ligne 40: `http://localhost:3030`)
2. ✅ **EXE_MODE=0** en développement (au lieu de 1)
3. ✅ **SYNC_TIMEOUT_MS=60000** (augmenté de 30s à 60s pour Sales/Products)

## Bootstrap automatique implémenté

Le système détecte maintenant automatiquement si la table `products` est vide et fait un **full pull** même si `initial_import_done = 1`.

Plus besoin de reset manuel du flag !

## Timeouts corrigés

Les timeouts utilisent maintenant les variables d'environnement :
- `SYNC_TIMEOUT_MS` (défaut: 60000ms)
- `SHEETS_TIMEOUT_PRODUCTS_MS` (défaut: 30000ms)
- `SHEETS_TIMEOUT_SALES_MS` (défaut: 30000ms)

## Prochaines étapes

1. Copiez `config.env` vers `.env`
2. Créez `.env.development` avec le contenu ci-dessus
3. Relancez `npm run dev`

Le système devrait maintenant :
- ✅ Télécharger automatiquement les produits si la table est vide
- ✅ Utiliser les timeouts corrects (60s pour Sales)
- ✅ Ne plus afficher le warning Vite sur NODE_ENV

