# 📊 GUIDE LOGS - SYNCHRONISATION PRODUIT '1'

## 🎯 COMMENT UTILISER LES LOGS AMÉLIORÉS

### Étape 1: Lancer l'application
```bash
cd "d:\logiciel\La Grace pro\v1"
# Si CLI:
node start.js

# Si Electron:
Ouvrir l'appli Electron depuis le menu Démarrer
```

### Étape 2: Ouvrir le terminal pour voir les logs
Le terminal affichera les logs **EN TEMPS RÉEL** lorsque:
- ✅ Le worker de sync démarre
- ✅ Un patch produit est créé
- ✅ Le push vers Google Sheets commence
- ✅ Les réponses arrivent

### Étape 3: Modifier un produit
Dans l'interface Electron, modifier le **nom du produit code '1'**:
```
Code '1' → Changer le nom à "nouveau-nom-test"
```

### Étape 4: Observer les logs
Dans le terminal, vous verrez les logs ultra-détaillés!

---

## 🔍 LIRE LES LOGS ÉTAPE PAR ÉTAPE

### Phase 1: DÉBUT DU PUSH
```
════════════════════════════════════════════════════════════════════════════════
📤 [pushProductPatches] DÉBUT PUSH PATCHES PRODUITS
════════════════════════════════════════════════════════════════════════════════
   ⏱️ Heure: 2026-01-01T12:34:56.789Z
   📊 Patches à traiter: 1
   🌐 Sheets URL: ✅ CONFIGURÉE
```

**À vérifier**:
- ✅ Heure correcte?
- ✅ Nombre de patches > 0?
- ✅ Sheets URL configurée?

---

### Phase 2: TRAITEMENT PATCH (une ligne par patch)
```
  [PATCH 1/1] Traitement opération op_id='op-sync-12345'
    ├─ entity_code: '1'
    ├─ status: pending
    └─ payload_json type: string
```

**À vérifier**:
- ✅ entity_code = '1' (le produit)?
- ✅ status = 'pending' (à traiter)?
- ✅ payload_json type = 'string' ou 'object'?

---

### Phase 3: PARSING DU JSON (CRITIQUE!)
```
    ✅ JSON parsed successfully
       ├─ name: 'crist'
       ├─ is_active: 1
       └─ Keys: name,is_active,uuid
```

**À vérifier**:
- ✅ Parse réussi?
- ✅ name = 'crist'? (le nom qu'on s'attend)
- ✅ Les keys attendues sont là?

**❌ Si Parse échoue**:
```
    ❌ JSON parse error: Unexpected token
       Raw (first 150 chars): {invalid json...
```
→ Le payload JSON est malformé!

---

### Phase 4: EXTRACTION DU NOM (🔴 CRITIQUE!)
```
    📝 NAME EXTRACTION:
       ├─ payload.name: 'crist'
       ├─ finalName: 'crist'
       └─ isEmpty: ✅ NO (bon)
```

**À vérifier**:
- ✅ payload.name = le nom attendu?
- ✅ finalName après trim = le même?
- ✅ isEmpty = "NO"? (✅ bon) ou "YES"? (❌ problème!)

**❌ Si isEmpty = YES**:
```
       ├─ payload.name: undefined
       └─ isEmpty: ⚠️ YES (problème!)
```
→ Le nom n'est pas dans le payload! Problème critique.

---

### Phase 5: CHARGEMENT DU PRODUIT
```
    📦 CHARGEMENT PRODUIT:
       ✅ Produit trouvé (id=1)
       ├─ name en DB: 'crist'
       ├─ uuid en DB: 1d6f6b3b-f378-471c-94e4-41ee1d069095
       ├─ Unités trouvées: 1
       │  [1] CARTON/ (uuid=96a8387d...)
```

**À vérifier**:
- ✅ Produit trouvé avec le bon ID?
- ✅ name en DB = le nom correct?
- ✅ UUID présent?
- ✅ Unités créées?

**❌ Si Produit NOT FOUND**:
```
       ❌ Produit NOT FOUND en DB pour code='1'
```
→ Le produit n'existe pas en base! Problème de synchronisation initiale.

---

### Phase 6: CRÉATION DES OPÉRATIONS
```
       🔄 Création opération [UNIT 1]:
          ├─ code: '1'
          ├─ name: 'crist' ✅
          ├─ unit_level: CARTON
          ├─ unit_mark: ''
          └─ uuid: 1d6f6b3b...
```

**À vérifier**:
- ✅ code = '1'?
- ✅ name = 'crist' ✅? (Doit voir le checkmark!)
- ✅ unit_level correct?
- ✅ uuid présent?

**❌ Si name vide**:
```
          ├─ name: '' ❌
```
→ LE PROBLÈME! Le nom n'est pas inclus dans l'opération!

---

### Phase 7: RÉSUMÉ PRÉPARATION
```
  📊 RÉSUMÉ PRÉPARATION:
     ├─ Patches traités: 1
     └─ Opérations créées: 1
```

**À vérifier**:
- ✅ Nombre de patches et opérations cohérent?

---

### Phase 8: ENVOI PAR BATCH
```
  📤 ENVOI PAR BATCH:
     [BATCH 1/1] Ops 1-1 of 1
        └─ Taille: 1 opérations
        📨 Envoi vers Google Sheets...
        🔍 Premier op détails:
           ├─ entity: products
           ├─ op: upsert
           └─ payload.name: 'crist' ✅
```

**À vérifier**:
- ✅ Batch envoyé?
- ✅ payload.name = 'crist' ✅?

**❌ Si payload.name vide**:
```
           └─ payload.name: '' ❌
```
→ LE NOM N'EST PAS ENVOYÉ À GOOGLE SHEETS!

---

### Phase 9: RÉPONSE DE GOOGLE SHEETS
```
        📨 Réponse reçue:
           ├─ success: ✅ YES
           ├─ acked: 1/1
           └─ error: none
        ✅ Batch traité avec succès
```

**À vérifier**:
- ✅ success = YES?
- ✅ acked = 1/1?
- ✅ error = none?

**❌ Si success = NO**:
```
           ├─ success: ❌ NO
           └─ error: "403 Forbidden"
        ❌ Batch ÉCHOUÉ: 403 Forbidden
```
→ Google Sheets a rejeté la demande!

**❌ Si erreur HTTP**:
```
        ❌ ERREUR lors de l'envoi: ECONNREFUSED
        Code: ECONNREFUSED
```
→ Impossible de joindre Google Sheets!

---

### Phase 10: FINALISATION
```
  ✅ FINALISATION:
     └─ 1 opération(s) marquée(s) comme 'acked'
```

**À vérifier**:
- ✅ Opérations marquées comme 'acked'?

---

### Phase 11: RÉSUMÉ FINAL
```
════════════════════════════════════════════════════════════════════════════════
📤 [pushProductPatches] FIN PUSH
════════════════════════════════════════════════════════════════════════════════
   ⏱️ Temps total: 245ms
   📊 Envoyé: 1/1
   ✅ Acked: 1/1
════════════════════════════════════════════════════════════════════════════════
```

**À vérifier**:
- ✅ Temps total raisonnable (< 1 seconde généralement)?
- ✅ Envoyé = Acked (tout est allé)?

---

## 🆘 DÉPANNAGE RAPIDE

### ❌ Problème 1: "JSON parse error"
**Symptôme**:
```
    ❌ JSON parse error: Unexpected token
```
**Cause**: Le payload JSON est malformé
**Solution**: Vérifier le code qui crée le patch

### ❌ Problème 2: "isEmpty: YES"
**Symptôme**:
```
    📝 NAME EXTRACTION:
       └─ isEmpty: ⚠️ YES (problème!)
```
**Cause**: Le nom n'est pas dans le patch
**Solution**: Vérifier où le patch est créé (il manque la clé `name`)

### ❌ Problème 3: "Produit NOT FOUND"
**Symptôme**:
```
       ❌ Produit NOT FOUND en DB pour code='1'
```
**Cause**: Le produit n'existe pas localement
**Solution**: Faire un sync complet (pull) depuis Google Sheets

### ❌ Problème 4: "success: NO"
**Symptôme**:
```
           ├─ success: ❌ NO
           └─ error: "403 Forbidden"
```
**Cause**: Google Sheets a rejeté la demande
**Solution**: Vérifier les permissions sur Google Sheets

### ❌ Problème 5: "ECONNREFUSED"
**Symptôme**:
```
        ❌ ERREUR lors de l'envoi: ECONNREFUSED
        Code: ECONNREFUSED
```
**Cause**: Impossible de joindre Google Sheets (internet?)
**Solution**: Vérifier la connexion Internet

---

## 📋 CHECKLIST COMPLÈTE LOGS

Après modification du produit code '1', vous devez voir:

- [ ] Phase 1: DÉBUT DU PUSH
- [ ] Phase 2: PATCH trouvé pour code='1'
- [ ] Phase 3: JSON parsed avec name='crist'
- [ ] Phase 4: NAME EXTRACTION isEmpty = NO
- [ ] Phase 5: PRODUIT trouvé en DB avec name='crist'
- [ ] Phase 6: OPÉRATION créée avec name='crist' ✅
- [ ] Phase 7: 1 patch traité, 1 opération créée
- [ ] Phase 8: Batch envoyé avec payload.name='crist' ✅
- [ ] Phase 9: Réponse reçue success=YES, acked=1/1
- [ ] Phase 10: Opération marquée comme 'acked'
- [ ] Phase 11: Temps total < 1 seconde

✅ **Si TOUS les checks sont OK** → La synchronisation est correcte!
❌ **Si un check échoue** → C'est là que le problème se situe

---

## 🎯 EXEMPLE COMPLET DE LOGS RÉUSSIS

```
════════════════════════════════════════════════════════════════════════════════
📤 [pushProductPatches] DÉBUT PUSH PATCHES PRODUITS
════════════════════════════════════════════════════════════════════════════════
   ⏱️ Heure: 2026-01-01T13:45:23.456Z
   📊 Patches à traiter: 1
   🌐 Sheets URL: ✅ CONFIGURÉE

  [PATCH 1/1] Traitement opération op_id='op-2026-01-01-13-45-23'
    ├─ entity_code: '1'
    ├─ status: pending
    └─ payload_json type: string
    ✅ JSON parsed successfully
       ├─ name: 'NOUVEAU NOM TEST'
       ├─ is_active: 1
       └─ Keys: name,is_active,uuid
    📝 NAME EXTRACTION:
       ├─ payload.name: 'NOUVEAU NOM TEST'
       ├─ finalName: 'NOUVEAU NOM TEST'
       └─ isEmpty: ✅ NO (bon)
    📦 CHARGEMENT PRODUIT:
       ✅ Produit trouvé (id=1)
       ├─ name en DB: 'crist'
       ├─ uuid en DB: 1d6f6b3b-f378-471c-94e4-41ee1d069095
       ├─ Unités trouvées: 1
       │  [1] CARTON/ (uuid=96a8387d-b9ff-4bf0-bd9a-e5568e81e190)
       🔄 Création opération [UNIT 1]:
          ├─ code: '1'
          ├─ name: 'NOUVEAU NOM TEST' ✅
          ├─ unit_level: CARTON
          ├─ unit_mark: ''
          └─ uuid: 1d6f6b3b-f378-471c-94e4-41ee1d069095

  📊 RÉSUMÉ PRÉPARATION:
     ├─ Patches traités: 1
     └─ Opérations créées: 1

  📤 ENVOI PAR BATCH:
     [BATCH 1/1] Ops 1-1 of 1
        └─ Taille: 1 opérations
        📨 Envoi vers Google Sheets...
        🔍 Premier op détails:
           ├─ entity: products
           ├─ op: upsert
           └─ payload.name: 'NOUVEAU NOM TEST' ✅
        📨 Réponse reçue:
           ├─ success: ✅ YES
           ├─ acked: 1/1
           └─ error: none
        ✅ Batch traité avec succès

  ✅ FINALISATION:
     └─ 1 opération(s) marquée(s) comme 'acked'

════════════════════════════════════════════════════════════════════════════════
📤 [pushProductPatches] FIN PUSH
════════════════════════════════════════════════════════════════════════════════
   ⏱️ Temps total: 156ms
   📊 Envoyé: 1/1
   ✅ Acked: 1/1
════════════════════════════════════════════════════════════════════════════════
```

→ **Logs PARFAITS! Tout fonctionne!** ✅

---

**Status**: ✅ Logs améliorés déployés  
**Prochaine Étape**: Tester et observer les logs  
**Besoin**: Juste modifier un produit et regarder le terminal!
