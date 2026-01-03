# 🎯 GUIDE ACTIONNEL - FIX SYNCHRONISATION PRODUIT '1'

## 🚀 SITUATION

✅ **Votre base de données est CORRECTE**
- Chemin: `C:\Glowflixprojet\db\glowflixprojet.db` ✅
- Produit code '1': Nom = `'crist'` ✅
- Tous les chemins pointent correctement ✅

❌ **LE PROBLÈME**: 
- Le nom du produit '1' **NE SE SYNCHRONISE PAS** vers Google Sheets
- **138 opérations** sont en attente de synchronisation
- Le flux push vers Google Apps Script semble échouer

---

## 📋 VÉRIFICATIONS À FAIRE

### ✅ Vérification 1: Google Apps Script URL
Exécutez dans le terminal:
```bash
echo $env:GOOGLE_SHEETS_WEBAPP_URL
```

**Résultat attendu**: URL commençant par `https://script.google.com/...`

**Si vide** ❌: 
1. Ouvrir [la Google Sheet](https://sheets.google.com)
2. Tools → Script Editor
3. Deploy → New Deployment → Select type → Web app
4. Copier l'URL de déploiement
5. Mettre à jour `.env`:
```
GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/d/XXX/userweb
```

### ✅ Vérification 2: Tester la synchronisation
```bash
cd "d:\logiciel\La Grace pro\v1"
node TEST-SYNC-PRODUCT-1.js
```

**Résultat attendu**:
```
✅ Produit trouvé: code=1, name='crist'
✅ Réponse reçue: Success=true, Acked count=1
```

**Si échoue** ❌:
- Vérifier que Google Apps Script URL est correcte
- Vérifier que `Code.gs` est bien deploié
- Vérifier les logs de Code.gs pour les erreurs

### ✅ Vérification 3: Vérifier Google Sheets
1. Ouvrir [Google Sheets](https://sheets.google.com)
2. Aller dans l'onglet **"Carton"** (car le produit '1' est en CARTON)
3. Chercher la ligne avec code = `1`
4. Vérifier que la colonne **"Nom du produit"** a la valeur `'crist'`

**Si vide** ❌:
- Le push ne fonctionne pas correctement
- Voir "Solutions" ci-dessous

### ✅ Vérification 4: Consulter les logs de Code.gs
1. Ouvrir Google Sheets
2. Tools → Script Editor
3. Cliquer sur **"Logs"** (en bas)
4. Chercher les messages:
   - `[handleBatchPush]` 
   - `[handleProductUpsert]`
   - `code='1', name='crist'`

---

## 🔧 SOLUTIONS

### Solution A: Forcer une Resync Complète
```bash
cd "d:\logiciel\La Grace pro\v1"
node TEST-SYNC-PRODUCT-1.js
```

Puis attendre 10 secondes et vérifier Google Sheets.

### Solution B: Redémarrer le Worker de Sync
Si l'app Electron est ouverte:
1. Fermer Electron
2. Rouvrir Electron
3. Attendre 30 secondes (le worker redémarre)
4. Vérifier Google Sheets

### Solution C: Vérifier les 138 Opérations en Attente
Ces opérations ne se sont pas synchronisées. Pour les forcer:

```bash
cd "d:\logiciel\La Grace pro\v1"
node resync-pending-operations.js
```

### Solution D: Reset Complet de la Synchronisation
**⚠️ À faire que si les solutions A-C n'ont pas marché**

```bash
# 1. Nettoyer les opérations en attente
cd "d:\logiciel\La Grace pro\v1"
node clear-pending-operations.js

# 2. Relancer Electron
# (le worker va redémarrer automatiquement)

# 3. Laisser sync 30 secondes

# 4. Vérifier Google Sheets
```

---

## 📊 DIAGNOSTIC FAIT

Voir [RAPPORT-DIAGNOSTIC-COMPLET.md](RAPPORT-DIAGNOSTIC-COMPLET.md) pour les détails techniques.

**Résumé**:
- ✅ Base de données: IMPECCABLE
- ✅ Produit code '1': Nom = 'crist'
- ❌ Synchronisation Google Sheets: À corriger

---

## 🆘 SI RIEN NE FONCTIONNE

1. **Vérifier la connexion Internet** ✅
2. **Redémarrer Electron** ✅
3. **Attendre 2-3 minutes** (sync automatique toutes les 10s)
4. **Chercher les erreurs dans**:
   - Logs Electron: `C:\Glowflixprojet\logs\sync.log`
   - Logs Code.gs: Google Sheets → Tools → Script Editor → Logs

---

## ✅ CHECKLIST FINALE

Avant de déclarer "résolu":

- [ ] `echo $env:GOOGLE_SHEETS_WEBAPP_URL` retourne une URL
- [ ] `node TEST-SYNC-PRODUCT-1.js` retourne "Success=true"
- [ ] Google Sheets onglet "Carton" → Produit code '1' → Colonne "Nom du produit" = 'crist'
- [ ] Les 138 opérations sont résolues
- [ ] La synchronisation automatique fonctionne toutes les 10 secondes

---

## 📞 SUPPORT

Pour questions:
1. Vérifier les logs: `C:\Glowflixprojet\logs\sync.log`
2. Vérifier Code.gs logs: Google Sheets → Tools → Script Editor → Logs
3. Re-exécuter le diagnostic: `diagnostic-product-1.py`
