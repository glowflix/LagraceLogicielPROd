# 🚀 TEST RAPIDE : Impression Glowflixprojet

## ⚡ En 30 Secondes

```bash
# 1. Démarrer le serveur
npm run dev

# 2. Dans un autre terminal, exécuter le diagnostic
node DIAGNOSTIC-IMPRESSION-COMPLETE.js

# 3. Observer la sortie - chercher les ✅ (succès) et ❌ (erreurs)
```

---

## 📋 Commandes Essentielles

### 1. Démarrage Normal (Dev)
```bash
npm run dev
```
**Logs attendus** :
```
📁 [PATHS] Root: C:\Users\Jeariss Director\AppData\Roaming\Glowflixprojet
🖨️  [PRINT-MODULE] INITIALISATION
✅ [PRINT] Watcher actif
```

---

### 2. Diagnostic Complet
```bash
node DIAGNOSTIC-IMPRESSION-COMPLETE.js
```
**Ce que ça fait** :
- ✅ Vérifie tous les chemins
- ✅ Teste les permissions
- ✅ Crée un job de test
- ✅ Affiche une checklist

---

### 3. Vérifier le Contenu du Dossier Printer

**En DEV** :
```powershell
dir "C:\Glowflixprojet\printer"
```

**En BUILD** :
```powershell
dir "%APPDATA%\Glowflixprojet\printer"
```

**Ce que vous devriez voir** :
```
ok\
err\
tmp\
templates\
assets\
```

---

### 4. Créer un Job de Test Manuellement

**En DEV** :
```powershell
echo {"template":"receipt-80","data":{"factureNum":"TEST-123"}} > "C:\Glowflixprojet\printer\job-test-manuel.json"
```

**En BUILD** :
```powershell
echo {"template":"receipt-80","data":{"factureNum":"TEST-123"}} > "%APPDATA%\Glowflixprojet\printer\job-test-manuel.json"
```

**Résultat attendu** :
- Le watcher détecte le fichier en 1-2 secondes
- Logs : `✅ [PRINT] NOUVEAU JOB DÉTECTÉ`
- Le fichier est traité et déplacé vers `ok/` ou `err/`

---

### 5. Lire les Logs du Serveur (Après une Vente)

**Windows** :
```powershell
Get-Content "%APPDATA%\Glowflixprojet\logs\combined.log" -Tail 50
```

**Chercher ces lignes** :
```
🖨️  [PRINT] DÉBUT CRÉATION JOB D'IMPRESSION
✅ [PRINT] Job créé avec succès!
✅ [PRINT] NOUVEAU JOB DÉTECTÉ
```

---

### 6. Vérifier les Erreurs d'Impression

**Liste les jobs en erreur** :
```powershell
dir "%APPDATA%\Glowflixprojet\printer\err"
```

**Lire le détail d'une erreur** :
```powershell
type "%APPDATA%\Glowflixprojet\printer\err\job-XXXX.error.json"
```

---

### 7. Forcer une Impression via API (Test Backend)

**Créer un fichier `test-print.json`** :
```json
{
  "template": "receipt-80",
  "copies": 1,
  "data": {
    "factureNum": "TEST-API-001",
    "client": "Client Test",
    "taux": 2800,
    "lignes": [
      {
        "code": "A1",
        "nom": "Produit Test",
        "unite": "piece",
        "mark": "",
        "qty": 1,
        "qteLabel": "1",
        "puFC": 1000,
        "totalFC": 1000
      }
    ],
    "totalFC": 1000,
    "totalUSD": 0.36,
    "printCurrency": "FC",
    "entreprise": {
      "nom": "ALIMENTATION LA GRACE",
      "rccm": "CD/KIS/RCCM 22-A-00172",
      "impot": "A220883T",
      "tel": "+243 896 885 373",
      "adresse": "Avenue Lac Tanganyika, Makiso, Kisangani"
    }
  }
}
```

**Envoyer via curl** (Windows PowerShell) :
```powershell
Invoke-RestMethod -Uri "http://localhost:3030/api/print/jobs" -Method POST -ContentType "application/json" -Body (Get-Content test-print.json -Raw)
```

**Résultat attendu** :
```json
{
  "success": true,
  "message": "Job d'impression créé",
  "jobFile": "job-TEST-API-001-1704365445.json"
}
```

---

## 🔍 Checklist Rapide (Avant de Contacter Support)

1. **Le serveur démarre-t-il sans erreur ?**
   ```bash
   npm run dev
   # Chercher : "✅ [PRINT] Watcher actif"
   ```

2. **Le dossier printer existe-t-il ?**
   ```powershell
   dir "%APPDATA%\Glowflixprojet\printer"
   # Doit afficher : ok, err, tmp, templates, assets
   ```

3. **Les permissions sont-elles OK ?**
   ```bash
   node DIAGNOSTIC-IMPRESSION-COMPLETE.js
   # Chercher : "✅ Écriture: OK"
   ```

4. **Le job est-il créé lors de la vente ?**
   ```
   Finaliser une vente → Logs : "✅ [PRINT] Job créé"
   ```

5. **Le watcher détecte-t-il le job ?**
   ```
   Logs : "✅ [PRINT] NOUVEAU JOB DÉTECTÉ"
   ```

6. **L'imprimante est-elle configurée ?**
   ```powershell
   Get-Printer | Where-Object { $_.Default -eq $true }
   # Doit retourner une imprimante
   ```

---

## 🎯 Scénario de Test Complet (5 Minutes)

### Étape 1 : Démarrage (1 min)
```bash
npm run dev
```
**Attendu** : Logs affichent "PRINT WATCHER START"

### Étape 2 : Diagnostic (1 min)
```bash
node DIAGNOSTIC-IMPRESSION-COMPLETE.js
```
**Attendu** : Tous les ✅ sont verts, un job test est créé

### Étape 3 : UI - Vente (2 min)
1. Ouvrir http://localhost:5173
2. Aller sur "Point de Vente"
3. Ajouter un produit
4. Renseigner le client
5. Cliquer "Finaliser"

**Attendu** :
- Toast de succès dans l'UI
- Logs serveur : "Job créé avec succès"
- Impression physique sur l'imprimante

### Étape 4 : Vérification (1 min)
```powershell
dir "%APPDATA%\Glowflixprojet\printer\ok"
```
**Attendu** : Le fichier `job-XXXX.json` y est présent

---

## 🐛 Problème ? Diagnostic en 3 Commandes

```bash
# 1. Vérifier les dossiers
node DIAGNOSTIC-IMPRESSION-COMPLETE.js

# 2. Lire les derniers logs
Get-Content "%APPDATA%\Glowflixprojet\logs\combined.log" -Tail 100

# 3. Vérifier les erreurs d'impression
dir "%APPDATA%\Glowflixprojet\printer\err"
```

**Copier la sortie de ces 3 commandes** si vous devez demander de l'aide.

---

## 📞 Support Rapide

**Problème : Job non créé**  
→ Exécuter : `node DIAGNOSTIC-IMPRESSION-COMPLETE.js`  
→ Chercher : `❌ [PRINT] ERREUR`

**Problème : Job créé mais pas détecté**  
→ Vérifier : Logs contiennent "PRINT WATCHER START"  
→ Redémarrer : `npm run dev`

**Problème : Job va dans err/**  
→ Lire : `type "%APPDATA%\Glowflixprojet\printer\err\job-XXXX.error.json"`  
→ Vérifier : Imprimante par défaut configurée

---

## ✅ Tout Fonctionne Si...

- ✅ Au démarrage : "PRINT WATCHER START" dans les logs
- ✅ Lors d'une vente : "Job créé avec succès" dans les logs
- ✅ 1-2 secondes après : "NOUVEAU JOB DÉTECTÉ" dans les logs
- ✅ Fichier job dans `printer/` pendant quelques secondes
- ✅ Fichier déplacé vers `ok/` après traitement
- ✅ Impression physique sur l'imprimante

---

**Astuce** : Garder ce fichier ouvert pendant les tests pour référence rapide ! 🚀

