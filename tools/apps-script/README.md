# Google Apps Script pour Glowflixprojet

Ce script permet la synchronisation bidirectionnelle entre la base SQLite locale et Google Sheets.

## Installation

### Spreadsheet ID
```
111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI
```

### Étapes d'installation

1. **Ouvrez votre Google Spreadsheet** : 
   https://docs.google.com/spreadsheets/d/111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI/edit

2. **Allez dans `Extensions` > `Apps Script`**

3. **Collez le contenu de `Code.gs`** (l'ID du Spreadsheet est déjà configuré dans le code)

4. **Déployez comme application web** :
   - Cliquez sur `Déployer` > `Nouveau déploiement`
   - Type: `Application Web`
   - Exécuter en tant que: `Moi`
   - Accès: `Toute personne`
   - Copiez l'URL du déploiement

5. **Configurez dans votre application** :
   - Ajoutez l'URL dans `config.env` : `GOOGLE_SHEETS_WEBAPP_URL`
   - L'ID du Spreadsheet : `GOOGLE_SHEETS_SPREADSHEET_ID`

## Feuilles supportées

- **Carton**: Produits vendus par carton
- **Milliers**: Produits vendus par millier
- **Piece**: Produits vendus à la pièce
- **Ventes**: Historique des ventes
- **Dettes**: Dettes clients
- **Taux**: Taux de change FC/USD
- **Compter Utilisateur**: Comptes utilisateurs
- **Stock de prix effectué**: Logs des prix vendus

## Endpoints

### POST (Push Local → Sheets)
```
POST https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
Content-Type: application/json

{
  "entity": "products|product_units|sales|debts|rates|users|price_logs",
  "entity_id": "identifiant",
  "op": "upsert|delete|void",
  "payload": { ... }
}
```

### GET (Pull Sheets → Local)
```
GET https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?entity=products&since=2024-01-01T00:00:00Z
```

## Colonnes techniques

Chaque feuille contient des colonnes techniques pour la synchronisation:
- `_origin`: LOCAL|MOBILE|SHEETS
- `_syncedAt`: Date de dernière synchronisation (ISO)
- `_rev`: Numéro de révision

## Notes

- Les feuilles sont créées automatiquement si elles n'existent pas
- Les en-têtes sont initialisés automatiquement
- La recherche se fait par identifiant unique (code produit, numéro facture, etc.)
- Les conflits sont gérés via `_rev` et `_syncedAt`

