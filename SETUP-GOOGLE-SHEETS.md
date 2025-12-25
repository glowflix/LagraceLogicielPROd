# 🚀 Configuration Google Sheets - Guide Rapide

## ✅ Identifiants Google Sheets

### Spreadsheet ID
```
111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI
```

**URL du Spreadsheet** : https://docs.google.com/spreadsheets/d/111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI/edit

### Google Apps Script Web App URL
```
https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec
```

## 📝 Étape 1 : Créer le fichier `.env`

Créez un fichier `.env` à la racine du projet avec ce contenu :

```env
# Google Sheets Synchronisation
GOOGLE_SHEETS_SPREADSHEET_ID=111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI
GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec
SYNC_INTERVAL_MS=10000

# Autres configurations (voir config.env)
PORT=3030
JWT_SECRET=your-secret-key
GLOWFLIX_ROOT_DIR=C:\Glowflixprojet
```

## 📋 Étape 2 : Vérifier le Google Apps Script

1. Ouvrez votre Google Spreadsheet
2. Allez dans **Extensions** → **Apps Script**
3. Vérifiez que le code `Code.gs` est déployé
4. **Déployez** → **Nouveau déploiement** → **Type : Application Web**
5. Configurez :
   - **Exécuter en tant que** : Moi
   - **Qui a accès** : Tout le monde
6. Copiez l'URL de déploiement (déjà dans votre `.env`)

## ✅ Étape 3 : Tester la connexion

Démarrez le serveur :

```bash
npm start
```

Vous devriez voir :

```
🔄 Worker de synchronisation démarré
```

Si vous voyez :

```
⚠️  GOOGLE_SHEETS_WEBAPP_URL non configuré, synchronisation désactivée
```

→ Vérifiez que le fichier `.env` existe et contient bien `GOOGLE_SHEETS_WEBAPP_URL`

## 🧪 Test manuel de l'URL

Testez l'URL dans votre navigateur :

```
https://script.google.com/macros/s/AKfycbzgVzlNRk6Juz70KgHb8nzYA7bbXyiDKVOfuONeTmpViZADsLK7VaVPretdN7azOXj4Ig/exec?entity=products
```

Vous devriez voir :
```json
{"success":true,"data":[],"count":0}
```

Ou si aucune donnée :
```json
{"success":false,"error":"Paramètre entity requis"}
```

## 📊 Synchronisation automatique

Une fois configuré, la synchronisation se fait automatiquement :

- **Push** : Toutes les 10 secondes, les opérations locales sont envoyées vers Sheets
- **Pull** : Les mises à jour depuis Sheets sont récupérées et appliquées localement

## 🔍 Vérifier les logs

Les logs de synchronisation sont dans :

```
C:\Glowflixprojet\logs\sync.log
```

## ❓ Problèmes courants

### "Paramètre entity requis"
✅ **Normal** - L'URL fonctionne, il faut juste passer le paramètre `entity`

### "CORS error" ou "Access denied"
→ Vérifiez que le Google Apps Script est déployé avec l'accès "Tout le monde"

### "GOOGLE_SHEETS_WEBAPP_URL non configuré"
→ Vérifiez que le fichier `.env` existe et contient la variable

---

**Tout est prêt ! La synchronisation fonctionne automatiquement.** 🎉

