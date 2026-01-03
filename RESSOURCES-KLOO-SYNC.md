# 📚 RESSOURCES: Tous les fichiers et liens de diagnostic

## 📑 Fichiers créés pour tester la synchronisation "kloo"

### 1. DOCUMENTS À LIRE

#### 🚀 START HERE: [RESUME-KLOO-SYNC.md](RESUME-KLOO-SYNC.md)
- **Durée:** 5 minutes
- **Public:** Tous
- **Contient:** Résumé, correction rapide, 3 commandes essentielles
- **Actions:** Lisez ce fichier EN PREMIER

#### ⚡ [ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md)
- **Durée:** 20 minutes
- **Public:** Tous les niveaux
- **Contient:** 7 étapes détaillées avec commandes
- **Actions:** Suivez les étapes dans l'ordre

#### 📚 [GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md)
- **Durée:** Reference document
- **Public:** Technique + troubleshooting
- **Contient:** Flux complet, tous les problèmes possibles, solutions
- **Actions:** Consultez quand vous avez un problème spécifique

#### 🔬 [TECHNICAL-GUIDE-KLOO-SYNC.md](TECHNICAL-GUIDE-KLOO-SYNC.md)
- **Durée:** Reference document
- **Public:** Développeurs
- **Contient:** Explication du code, flux de données, points clés
- **Actions:** Lisez pour comprendre comment ça fonctionne

#### 📇 [INDEX-VERIFICATION-KLOO.md](INDEX-VERIFICATION-KLOO.md)
- **Durée:** Navigation
- **Public:** Tous
- **Contient:** Index de tous les guides, flux rapide, checklist
- **Actions:** Utilisez pour naviguer entre les documents

---

### 2. SCRIPTS À EXÉCUTER

#### 🔍 [VERIFY-KLOO-SYNC.js](VERIFY-KLOO-SYNC.js)
```bash
node VERIFY-KLOO-SYNC.js
```
- **Teste:** Produit en BD, UUID, unités, OUTBOX, synced_at
- **Temps:** 2 secondes
- **Output:** Rapport détaillé + recommandations
- **À exécuter:** Étape 2 du ACTION-PLAN

#### 🔬 [SIMULATE-KLOO-SYNC.js](SIMULATE-KLOO-SYNC.js)
```bash
node SIMULATE-KLOO-SYNC.js
```
- **Teste:** Flux complet de synchronisation
- **Simule:** Connexion à Sheets, payload, réponse
- **Temps:** 5 secondes
- **À exécuter:** Étape 4 du ACTION-PLAN

---

### 3. TESTS GOOGLE SHEETS

#### 📊 [tools/apps-script/TEST-KLOO-SYNC.gs](tools/apps-script/TEST-KLOO-SYNC.gs)
**Comment utiliser:**
1. Allez à Google Sheets
2. Tools → Apps Script
3. Copiez le contenu de TEST-KLOO-SYNC.gs dans l'éditeur
4. Exécutez: `testKlooSyncComplete()`
5. Vérifiez Tools → Logs

**Fonctions:**
- `testKlooSyncComplete()` - Test complet
- `testDoProPushKilo()` - Test du push doProPush

#### 🔤 [tools/apps-script/TEST-SEARCH-LOGIC.gs](tools/apps-script/TEST-SEARCH-LOGIC.gs)
**Comment utiliser:**
1. Allez à Google Sheets
2. Tools → Apps Script
3. Copiez le contenu dans l'éditeur
4. Exécutez: `testProductSearchLogic()`
5. Vérifiez Tools → Logs

**Fonctions:**
- `testProductSearchLogic()` - Simule la recherche de produit
- `testCodeNormalization()` - Teste la normalisation du code

---

## 🎯 Commandes rapides par besoin

### Je veux vérifier rapidement (2 min)
```bash
# 1. Vérifier le produit en BD
node VERIFY-KLOO-SYNC.js

# 2. Vérifier la config
echo $env:GOOGLE_SHEETS_WEBAPP_URL

# 3. Chercher "kloo" en Google Sheets manuellement
```

### Je veux simuler la synchronisation (5 min)
```bash
# 1. Simuler le flux complet
node SIMULATE-KLOO-SYNC.js

# 2. Tester depuis Google Sheets
# → Allez à Google Sheets
# → Tools → Apps Script
# → Exécutez testKlooSyncComplete()
```

### Je veux voir les logs (ongoing)
```bash
# Logs de synchronisation
tail -f logs/sync.log | grep -E "kloo|PRODUCT_PATCH|PUSH"

# Logs d'erreurs
tail -f logs/error.log

# Tout les logs
tail -f logs/*.log
```

### Je veux consulter la BD (queries)
```bash
# Vérifier le produit
sqlite3 database.db "SELECT * FROM products WHERE name='kloo';"

# Vérifier les unités
sqlite3 database.db "SELECT * FROM product_units WHERE product_id=1;"

# Vérifier les opérations OUTBOX
sqlite3 database.db "SELECT * FROM outbox WHERE entity_code='kloo' ORDER BY created_at DESC LIMIT 5;"

# Vérifier synced_at
sqlite3 database.db "SELECT synced_at FROM product_units WHERE product_id=1;"
```

### Je veux forcer une synchronisation
```bash
# Option 1: Modifier le produit dans l'app
# → Changez le prix ou le nom
# → Sauvegardez
# → Attendez 10 secondes

# Option 2: Insérer une opération en BD
sqlite3 database.db "INSERT INTO outbox (entity_code, entity_uuid, entity_type, op_type, payload_json, status) VALUES ('kloo', '96a8387d-b9ff-4bf0-bd9a-e5568e81e190', 'product', 'PRODUCT_PATCH', '{\"name\":\"kloo\",\"is_active\":1}', 'pending');"
```

### Je veux redémarrer le serveur
```bash
# Arrêtez
Ctrl+C

# Attendez 5 secondes

# Redémarrez
npm start

# Vérifiez que le worker démarre
# → Cherchez "🚀 Démarrage du worker de synchronisation"
```

---

## 📊 Checklist d'utilisation

### Pour comprendre le problème
- [ ] Lire [RESUME-KLOO-SYNC.md](RESUME-KLOO-SYNC.md) (5 min)
- [ ] Exécuter `node VERIFY-KLOO-SYNC.js` (2 min)
- [ ] Vérifier Google Sheets manuellement (3 min)

### Pour déboguer
- [ ] Exécuter `node SIMULATE-KLOO-SYNC.js` (5 min)
- [ ] Vérifier `GOOGLE_SHEETS_WEBAPP_URL` (1 min)
- [ ] Consulter `logs/sync.log` (5 min)

### Pour tester
- [ ] Créer opération OUTBOX (2 min)
- [ ] Attendre 10 secondes
- [ ] Vérifier `synced_at` (2 min)

### Pour résoudre
- [ ] Lire [ACTION-PLAN-KLOO-SYNC.md](ACTION-PLAN-KLOO-SYNC.md) (20 min)
- [ ] Suivre les 7 étapes dans l'ordre
- [ ] Consulter [GUIDE-VERIFICATION-KLOO-SYNC.md](GUIDE-VERIFICATION-KLOO-SYNC.md) si bloqué

---

## 🔗 Liens relatifs

```
À partir de la racine du projet:

├── RESUME-KLOO-SYNC.md                     ← START HERE
├── ACTION-PLAN-KLOO-SYNC.md
├── GUIDE-VERIFICATION-KLOO-SYNC.md
├── TECHNICAL-GUIDE-KLOO-SYNC.md
├── INDEX-VERIFICATION-KLOO.md
├── VERIFY-KLOO-SYNC.js                     ← node VERIFY-KLOO-SYNC.js
├── SIMULATE-KLOO-SYNC.js                   ← node SIMULATE-KLOO-SYNC.js
│
└── tools/apps-script/
    ├── Code.gs                             ← handleProductUpsert(), doProPush()
    ├── TEST-KLOO-SYNC.gs                   ← testKlooSyncComplete()
    └── TEST-SEARCH-LOGIC.gs                ← testProductSearchLogic()
```

---

## 🎯 Flux de navigation recommandé

```
START
  │
  ├─→ 📖 RESUME-KLOO-SYNC.md (5 min)
  │    ├─→ Problème compris?
  │    │    ├─ OUI → Exécutez VERIFY-KLOO-SYNC.js
  │    │    └─ NON → Relisez
  │    │
  │    └─→ ⚡ ACTION-PLAN-KLOO-SYNC.md (7 étapes)
  │         ├─→ Exécutez VERIFY-KLOO-SYNC.js (étape 2)
  │         ├─→ Vérifiez Google Sheets (étape 3)
  │         ├─→ Exécutez SIMULATE-KLOO-SYNC.js (étape 4)
  │         ├─→ Testez depuis Google Sheets (étape 4)
  │         ├─→ Forcez sync (étape 5)
  │         ├─→ Vérifiez logs (étape 6)
  │         └─→ Vérifiez synced_at (étape 7)
  │
  ├─ Si bloqué:
  │    └─→ 📚 GUIDE-VERIFICATION-KLOO-SYNC.md
  │         └─→ Cherchez votre symptôme
  │              └─→ Suivez la solution
  │
  ├─ Si vous voulez comprendre:
  │    └─→ 🔬 TECHNICAL-GUIDE-KLOO-SYNC.md
  │         ├─→ Lire flux de données
  │         ├─→ Lire points clés du code
  │         └─→ Consulter les problèmes courants
  │
  └─ Pour naviguer:
       └─→ 📇 INDEX-VERIFICATION-KLOO.md
            └─→ Utilisez l'index pour sauter entre sections
```

---

## 💡 Tips & Tricks

### Copier rapidement un UUID
```bash
# UUID de test
96a8387d-b9ff-4bf0-bd9a-e5568e81e190

# Copie-coller dans Google Sheets
```

### Vérifier que tout fonctionne
```bash
# Test complet (2 minutes)
node VERIFY-KLOO-SYNC.js && \
node SIMULATE-KLOO-SYNC.js && \
echo "✅ Tests basiques passés"
```

### Obtenir les logs en temps réel
```bash
# Terminal 1: Lancer le serveur
npm start

# Terminal 2: Suivre les logs
tail -f logs/sync.log
```

### Réinitialiser synced_at pour tester
```bash
# Marquer comme non synchronisé
sqlite3 database.db "UPDATE product_units SET synced_at = NULL WHERE product_id=1;"

# Créer une opération OUTBOX
sqlite3 database.db "INSERT INTO outbox (entity_code, entity_type, op_type, payload_json, status) VALUES ('kloo', 'product', 'PRODUCT_PATCH', '{\"name\":\"kloo\"}', 'pending');"

# Redémarrer et attendre 10s
npm start
```

---

## ⏰ Estimation de temps

| Tâche | Temps | Difficulté |
|-------|-------|---|
| Lire RESUME-KLOO-SYNC.md | 5 min | ⭐ |
| Exécuter VERIFY-KLOO-SYNC.js | 2 min | ⭐ |
| Vérifier Google Sheets | 3 min | ⭐ |
| Exécuter ACTION-PLAN complet | 20 min | ⭐⭐ |
| Déboguer avec GUIDE-VERIFICATION | Variable | ⭐⭐⭐ |
| Lire TECHNICAL-GUIDE | 30 min | ⭐⭐⭐⭐ |

**Total pour résoudre:** ~30-40 minutes en moyenne

---

## ✅ Qu'est-ce qui indique que c'est "OK"?

```
✅ node VERIFY-KLOO-SYNC.js affiche "✅ TROUVÉ"
✅ GOOGLE_SHEETS_WEBAPP_URL configurée
✅ "kloo" existe en Google Sheets (Carton)
✅ node SIMULATE-KLOO-SYNC.js réussit (HTTP 200)
✅ UUID en Sheets = 96a8387d-b9ff-4bf0-bd9a-e5568e81e190
✅ synced_at ≠ NULL
✅ Aucune erreur dans logs/sync.log
✅ Les logs affichent "✅ Batch acked" pour "kloo"

RÉSULTAT: 🎉 SYNCHRONISATION RÉUSSIE!
```

---

## 📞 Support

Si vous êtes bloqué après avoir suivi tous les guides:

1. **Vérifiez les basics:**
   - Internet est connecté? (ping google.com)
   - Serveur tourne? (npm start)
   - Base de données existe? (ls database.db)

2. **Consultez les logs:**
   - `logs/sync.log` → cherchez "kloo"
   - `logs/error.log` → cherchez erreurs
   - Google Sheets → Tools → Logs → erreurs Apps Script

3. **Essayez de redémarrer:**
   ```bash
   Ctrl+C
   # Attendez 5 secondes
   npm start
   ```

4. **En dernier recours:**
   - Vérifiez que la BD n'est pas corrompue
   - Vérifiez les permissions fichier
   - Re-déployez le Apps Script

---

**🎉 Vous avez tous les outils pour résoudre ce problème!**

**Commencez par:** [RESUME-KLOO-SYNC.md](RESUME-KLOO-SYNC.md)
