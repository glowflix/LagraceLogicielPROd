# Configuration Google Sheets Synchronisation

## ✅ Identifiants Google Sheets configurés

### Spreadsheet ID
```
111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI
```

**URL du Spreadsheet** : https://docs.google.com/spreadsheets/d/111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI/edit

### Google Apps Script Web App URL
```
https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec
```

## 📝 Configuration dans `.env`

Ajoutez ces lignes dans votre fichier `.env` à la racine du projet :

```env
# ID du Google Spreadsheet
GOOGLE_SHEETS_SPREADSHEET_ID=111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI

# URL du Google Apps Script Web App
GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec

# Intervalle de synchronisation (ms)
SYNC_INTERVAL_MS=10000
```

## 🔧 Vérification

### 1. Test de l'URL Apps Script

Vous pouvez tester l'URL directement dans votre navigateur ou avec curl :

```bash
# Test GET (devrait retourner une erreur "entity requis" - c'est normal)
curl "https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec?entity=products"

# Test POST (avec données de test)
curl -X POST "https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec" \
  -H "Content-Type: application/json" \
  -d '{"entity":"products","entity_id":"TEST","op":"upsert","payload":{"code":"TEST","name":"Test Product"}}'
```

### 2. Vérifier que le serveur utilise l'URL

Au démarrage du serveur, vous devriez voir :

```
🔄 Worker de synchronisation démarré
```

Si l'URL n'est pas configurée, vous verrez :

```
⚠️  GOOGLE_SHEETS_WEBAPP_URL non configuré, synchronisation désactivée
```

## 📊 Fonctionnement

### Push (Local → Sheets)
- Les opérations sont ajoutées dans `sync_outbox` automatiquement
- Le worker de synchronisation les envoie toutes les 10 secondes (configurable via `SYNC_INTERVAL_MS`)
- Format : `POST` avec `{ entity, entity_id, op, payload }`

### Pull (Sheets → Local)
- Le worker récupère les mises à jour depuis Sheets
- Format : `GET` avec `?entity=...&since=...`
- Les conflits sont gérés selon les règles définies

## 🔐 Permissions Google Apps Script

Assurez-vous que votre Google Apps Script :
1. ✅ Est déployé en tant qu'**application Web**
2. ✅ L'exécution est configurée pour **"Moi"** ou **"Tout le monde"**
3. ✅ L'accès est configuré pour **"Tout le monde, même anonyme"** (pour les appels depuis votre serveur)

## 📋 Entités synchronisées

- ✅ `products` / `product_units` → Feuilles Carton, Milliers, Piece
- ✅ `sales` → Feuille Ventes
- ✅ `sale_items` → Feuille Ventes (lignes)
- ✅ `debts` → Feuille Dettes
- ✅ `rates` → Feuille Taux
- ✅ `users` → Feuille Compter Utilisateur
- ✅ `price_logs` → Feuille Stock de prix effectué

## 🐛 Dépannage

### Erreur : "Paramètre entity requis"
- ✅ Normal si vous testez l'URL sans paramètres
- L'URL fonctionne correctement

### Erreur : "GOOGLE_SHEETS_WEBAPP_URL non configuré"
- Vérifiez que le fichier `.env` existe à la racine
- Vérifiez que la variable est bien définie
- Redémarrez le serveur après modification du `.env`

### Erreur : "CORS" ou "Access denied"
- Vérifiez les permissions du Google Apps Script
- Assurez-vous que l'accès est ouvert à "Tout le monde"

## 📝 Notes

- L'URL est stockée dans la variable d'environnement `GOOGLE_SHEETS_WEBAPP_URL`
- Le code utilise cette URL dans `src/services/sync/sheets.client.js`
- Le worker de synchronisation tourne automatiquement toutes les 10 secondes
- Les logs de synchronisation sont dans `C:\Glowflixprojet\logs\sync.log`

