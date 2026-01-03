# 🚀 DEPLOYMENT GUIDE: Mark Fix

**Si tu dois déployer MAINTENANT, suis ce guide.**

---

## Pre-Deployment Checklist (5 minutes)

### Step 1: Vérifier les Fichiers Modifiés
```bash
git diff --name-only
# Doit voir:
# - src/ui/pages/ProductsPage.jsx
# - src/api/routes/products.routes.js
```

### Step 2: Vérifier le Contenu des Changements
```bash
# Chercher les 6 changements dans le code:
1. normalizeMark() at line 303      ✅
2. updateEditValue() at line 1305   ✅
3. onBlur at line 1920              ✅
4. Comment at line 907              ✅
5. savePendingChanges() at line 1095 ✅
6. products.routes.js at line 233   ✅
```

### Step 3: Database Check
```bash
# Aucun changement SQL requis
# Vérifier que schema.sql est INCHANGÉ

git diff src/db/schema.sql
# Résultat: (no output = inchangé ✅)
```

### Step 4: Run Tests (if you have them)
```bash
npm test
# Si tu as des tests unitaires, ils doivent passer
```

### Step 5: Build Check
```bash
npm run build
# Doit compiler sans erreurs (zéro warnings relaté)
```

---

## Deployment Steps

### Environment: Development
```bash
1. git pull origin (ou merge ta branche)
2. npm install (si dépendances changées)
3. npm run dev
4. Test les 3 scénarios ci-dessous
5. Si OK → commit et push
```

### Environment: Staging
```bash
1. git pull origin main
2. npm install --production
3. npm run build
4. npm start (ou ton script de prod)
5. Test les 3 scénarios
6. Si OK → ready for production
```

### Environment: Production
```bash
1. Backup de la base de données (important!)
   # Aucune migration requise, mais prudence = pro
2. git pull origin main
3. npm install --production
4. npm run build
5. npm start
6. Monitor les logs pendant 15 minutes
7. Test rapide (scénario 1 ci-dessous)
```

---

## Quick Post-Deployment Tests (10 minutes)

### Scénario 1: Normal Mark Edit
```
1. Va sur ProductsPage
2. Clique sur un Mark existant (ex: "DZ")
3. Change en "PQT"
4. Blur (click ailleurs)
5. Attends 3 secondes
6. Recharge la page (F5)

Expected:
✅ Mark = "PQT" persiste après reload
✅ Console: pas d'erreur (F12)
✅ Network: PUT request avec status 200

If fails: 🚨 Rollback
```

### Scénario 2: Empty Mark Blocked
```
1. Clique Mark existant
2. Supprime tout → ""
3. Clique ailleurs (blur)
4. Attends 3 secondes

Expected:
✅ Message rouge: "Le Mark (unité de vente) est obligatoire"
✅ Network: zéro request (pas de PUT)
✅ Mark original persiste

If fails: 🚨 Rollback
```

### Scénario 3: Duplicate Mark (409)
```
1. Crée deux produits avec même code, même unité, marks différents
2. Essaye de changer le 2ème mark en mark du 1er
3. Blur

Expected:
✅ Message: "Ce Mark existe déjà pour ce produit et cette unité"
✅ Network: 409 status code
✅ Mark ne change pas (reste l'original)

If fails: 🚨 Rollback
```

---

## Monitoring Après Déploiement

### Logs to Watch (15 minutes après déploiement)
```
[ProductsPage] 
[savePendingChanges]
[handleUpdateProduct]

Ne cherche pas de:
❌ "SQLITE_CONSTRAINT: NOT NULL"
❌ "500 Internal Server Error"
✅ Les autres logs sont normaux
```

### Metrics to Check
```
- Nombre de PUT requests réussis (200): doit être normal
- Nombre de 409 errors: peut augmenter (normal, c'est une bonne détection)
- Nombre de 500 errors: doit rester stable (pas de régression)
```

### User Feedback to Look For
```
✅ "The Mark saving works fine now"
✅ "Error messages are clear"
❌ "Mark still disappears"
❌ "Save doesn't work"
```

---

## Rollback Plan (Si quelque chose va mal)

### Si tu dois rollback immédiatement:
```bash
# Option 1: Git rollback
git revert HEAD
git push origin main

# Option 2: Redeploy previous version
# (dépend de ton infrastructure)

# Option 3: Quick hotfix
# Revert juste les fichiers:
git checkout HEAD~1 src/ui/pages/ProductsPage.jsx
git checkout HEAD~1 src/api/routes/products.routes.js
git push origin main
```

### Vérifier que tu as bien rollback:
```
1. Clear browser cache (Ctrl+Shift+Delete)
2. Reload ProductsPage
3. Vérifier l'ancienne UI comportement (pré-fix)
4. Si c'est OK → rollback réussi
```

---

## Undo Checklist (si rollback)

- [ ] Git reverted
- [ ] Pushed to origin
- [ ] Servers restarted
- [ ] Cache cleared
- [ ] Database still has all data (aucun danger, aucun changement DB)
- [ ] Users informed

---

## Success Criteria (Après 1 heure de déploiement)

Si tu vois tous les ✅ ci-dessous, le déploiement est un succès:

- [x] Zero "NOT NULL constraint" errors in logs
- [x] Zero "500 errors" related to Mark (autres 500s OK)
- [x] Users can save Marks correctly
- [x] Empty Marks are blocked with clear message
- [x] Duplicate Marks show 409 error
- [x] Export/Import works without Marks issues
- [x] ProductsPage loads without errors
- [x] No unusual network activity

---

## Documentation Links (For Reference)

- **CODE-CHANGES-SUMMARY.md** → Code exact changes
- **FIX-AUTOSAVE-MARK-VIDE.md** → What was fixed
- **VERIFICATION-BACKEND-MARK.md** → Backend checks
- **AVANT-APRES-FRANCAIS.md** → French visual guide

---

## Support (Si problème)

1. **Cherche dans les logs:** `[ProductsPage]` ou `[updateEditValue]`
2. **Vérife les fichiers:** productssPage.jsx et products.routes.js
3. **Consulte CODE-CHANGES-SUMMARY.md** pour les changements exacts
4. **Si jamais, rollback** (zéro impact, aucun changement DB)

---

## Timeline

```
T+0min:   Deployment starts
T+5min:   Code is live, logs monitored
T+10min:  Quick smoke tests (scénarios 1-3)
T+15min:  Monitor metrics
T+30min:  Check user feedback
T+60min:  Success criteria check ✅
```

---

## TL;DR (Too Long; Didn't Read)

1. **Deploy** the code (2 files modified)
2. **Test** 3 scenarios (10 minutes)
3. **Monitor** logs (15 minutes)
4. **Done** ✅

**Risk:** Minimal (isolated changes, no DB mutations)  
**Rollback:** Simple (just git revert)  
**Confidence:** High (6 layers of protection)

---

**Status:** Ready for Production Deployment 🚀

Good luck! 💪
