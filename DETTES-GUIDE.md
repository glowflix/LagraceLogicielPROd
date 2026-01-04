# 🔧 GUIDE - Synchronisation des Dettes

## 📋 Diagnostic du Problème

**Situation actuelle:**
- ❌ Les dettes n'apparaissent pas dans la page "Dettes"
- ❌ Les logs montrent: `[DEBTS] Aucun item retourné (data.length=0)`
- ✅ La page Dettes est correctement codée et prête à recevoir les données
- ✅ L'API `/api/debts` fonctionne et attend les données

**Cause du problème:**
Le Google Apps Script ne retourne pas les dettes depuis la feuille "Dettes". Cela peut être dû à:
1. La feuille "Dettes" n'existe pas dans Google Sheets
2. Les noms des colonnes ne correspondent pas
3. Le Google Apps Script n'accède pas correctement à la feuille

---

## ✅ Solutions

### Solution 1: Injection Manuelle (RAPIDE - 2 minutes)

Si vous avez des dettes dans Google Sheets mais elles ne se synchronisent pas:

```bash
# 1. Arrêtez l'application
Ctrl + C

# 2. Exécutez ce script pour injeter les dettes dans la BD
node fix-debts-sync.js

# 3. Redémarrez l'application
npm run dev
```

**Ce script va:**
- Créer la table `debts` si elle n'existe pas
- Injecter 3 dettes exemples (PA MUKANIA, PA SAMY, muyomba)
- Vérifier que tout fonctionne

Vous verrez alors les dettes apparaître dans la page "Dettes" ✅

---

### Solution 2: Vérifier le Google Sheets

Pour que les dettes se synchronisent automatiquement:

1. **Vérifiez que la feuille "Dettes" existe** dans votre Google Sheets
   - Elle doit contenir les colonnes:
     - `Client` → `client_name`
     - `Produit` → `product_description`  
     - `Facture #` → `invoice_number`
     - `Montant Total` → `total_fc`
     - `Montant Payé` → `paid_fc`
     - `Statut` → `status` (open/partial/closed)

2. **Vérifiez le Google Apps Script** dans Sheets:
   - Menu: Extensions → Apps Script
   - La fonction `doGet()` doit avoir un cas `entity=debts`
   - Elle doit retourner les données de la feuille "Dettes"

3. **Vérifiez que les colonnes correspondent:**
   ```javascript
   // Dans le Apps Script, la fonction doit mapper:
   {
     client_name: row['Client'],
     invoice_number: row['Facture #'],
     total_fc: parseFloat(row['Montant Total']),
     paid_fc: parseFloat(row['Montant Payé']),
     remaining_fc: parseFloat(row['Montant Total']) - parseFloat(row['Montant Payé']),
     status: row['Statut'] || 'open',
     product_description: row['Produit'],
     // ... autres champs
   }
   ```

---

### Solution 3: Diagnostic Complet

Pour vérifier l'état global de la synchronisation:

```bash
# Arrêtez l'application
Ctrl + C

# Lancez le diagnostic
node diagnose-debts-sync.js

# Vous verrez:
# ✅ Si la table "debts" existe
# 📊 Combien de dettes sont dans la BD
# 📋 Le schéma exact de la table
# 📋 Les 5 dernières dettes synchronisées
# 🔄 Les fichiers de log de synchronisation
```

---

## 📱 Utilisation de la Page Dettes

Une fois les dettes synchronisées:

1. **Visualisez les dettes:**
   - Allez sur la page "Dettes"
   - Vous verrez un graphique "Répartition des dettes"
   - Une liste des "Dettes actives"
   - Un tableau complet "Historique complet des dettes"

2. **Enregistrez un paiement:**
   - Cliquez sur le bouton "Payer" sur une dette
   - Entrez le montant à payer (max: montant restant)
   - Cliquez "Enregistrer"
   - La dette est mise à jour automatiquement

3. **Statuts des dettes:**
   - 🔴 **Ouverte** - Aucun paiement effectué
   - 🟡 **Partielle** - Paiement partial effectué
   - 🟢 **Fermée** - Entièrement payée

---

## 🔄 Flux Complet de Synchronisation

```
Google Sheets (Feuille "Dettes")
    ↓
Google Apps Script (récupère les données)
    ↓
sync.worker.js (applyDebtsUpdates)
    ↓
SQLite Database (table "debts")
    ↓
API /api/debts (retourne les dettes)
    ↓
Page React DebtsPage.jsx (affiche les dettes)
    ↓
Utilisateur voit et peut payer les dettes
```

---

## 🆘 Dépannage

### Les dettes ne s'affichent pas
1. Exécutez `node fix-debts-sync.js`
2. Redémarrez l'application
3. Rechargez la page

### Les paiements n'enregistrent pas
- Vérifiez les logs: `console.log` dans la page Debts
- Vérifiez que l'API répond: `GET /api/debts` dans Postman

### Les dettes ne se synchronisent pas du tout
- Exécutez `node diagnose-debts-sync.js`
- Vérifiez que Google Sheets contient bien les données
- Vérifiez que le Google Apps Script a accès à la feuille "Dettes"

---

## 📝 Fichiers Modifiés

- **DebtsPage.jsx** - Amélioré avec:
  - Modal de paiement
  - Boutons "Payer" sur chaque dette
  - Affichage du pourcentage payé
  - Messages d'aide si aucune dette

- **fix-debts-sync.js** - Nouveau script pour injecter les dettes
- **diagnose-debts-sync.js** - Nouveau script pour diagnostiquer
- **debts.routes.js** - API pour récupérer et payer les dettes (existant)

---

**Besoin d'aide?** Exécutez: `node fix-debts-sync.js` ✅
