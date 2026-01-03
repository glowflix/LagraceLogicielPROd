# ✅ PIÈGES CRITIQUES - CORRIGÉS

## Piège 1 : resolve() "magiques" sans validation réelle ❌

### Le problème
Dans `startServer()`, il y avait du code qui faisait `resolve()` juste parce que :
- Les logs stdout contenaient "Serveur démarré"
- Ou stderr contenait une erreur de port utilisé

**Résultat** : L'app créait la fenêtre UI et tentait de se connecter au serveur, qui n'était pas vraiment prêt.

**Symptôme visible** : 
```
ERR_CONNECTION_REFUSED
netstat :3030 → vide
```

### La correction ✅
**SUPPRIMÉ** :
```javascript
// ❌ AVANT - NE PLUS FAIRE ÇA
if (output.includes('Serveur démarré')) {
  resolve(); // ← Piège! Les logs ne garantissent rien
}
```

**CONSERVÉ** :
```javascript
// ✅ APRÈS - Seule source de vérité
waitForServer(40).then(ok => {
  if (ok) {
    console.log('[SERVER] ✅ Backend prêt sur /api/health');
    resolve();
  } else {
    reject(new Error('Backend n\'a pas répondu sur /api/health après 20s'));
  }
}).catch(reject);
```

### Règle d'or
**Les logs stdout/stderr ≠ disponibilité réelle du serveur.**

Toujours tester `/api/health` avec une vraie requête HTTP.

---

## Piège 2 : Chemin AI incorrect en production ❌

### Le problème
Le code pointait toujours :
```javascript
const AI_DIR = path.join(__dirname, '..', 'ai-lagrace'); // ❌ En prod = inexistant
```

Mais en production, l'AI est packagée dans `resources/ai` (via `electron-builder.json`).

**C'était OK temporairement** car `AI_AUTOSTART = false` en prod, donc l'AI ne démarre jamais.

**Mais plus tard** si on veut l'IA en prod → crash.

### La correction ✅
```javascript
// ✅ APRÈS - Chemins conditionnels
const AI_DIR = app.isPackaged 
  ? path.join(process.resourcesPath, 'ai')      // Prod: resources/ai
  : path.join(__dirname, '..', 'ai-lagrace');    // Dev: racine/ai-lagrace
```

### Structure réelle
```
Production (EXE) :
  resources/
    ai/                 ← L'IA est ici (extraResources)
      main.py
      
Développement :
  ai-lagrace/           ← L'IA est ici
    main.py
```

---

## Checklist : avant de rebuilder l'EXE 🚀

- [ ] Suppression des `resolve()` sur logs → uniquement `waitForServer()`
- [ ] Chemin AI conditionnel : `app.isPackaged ? resources/ai : ai-lagrace`
- [ ] `electron-builder.json` : `extraResources` avec `dist/ui`, `print`, `config.env`, `ai`
- [ ] `npm run build` (Vite) ✓
- [ ] `npm run build:exe` (electron-builder) ✓
- [ ] Vérifier `dist/release/` : `ui/assets/index-*.js` existe
- [ ] Installer l'EXE et lancer
- [ ] Vérifier `%APPDATA%\LA GRACE POS\logs\main.log` → pas d'erreur
- [ ] Tester `/api/health` en local

---

## Symptômes de succès ✅

Après correction et rebuild :

```bash
# Terminal 1: EXE lancé
# Voir dans les logs:
[BACKEND] ✅ Backend prêt sur /api/health
[WINDOW] ✅ Fenêtre créée avec succès

# Terminal 2: Vérifier le port
netstat -ano | findstr :3030
# Résultat: TCP 127.0.0.1:3030 LISTENING

# Terminal 3: Tester /api/health
curl http://127.0.0.1:3030/api/health
# Résultat: {"status":"ok","timestamp":"..."}

# Browser: Ouvrir http://127.0.0.1:3030
# Résultat: UI charge, pas d'erreur "index-*.js not found"
```

---

## Ressources

- [CHECK-EXE-STRUCTURE.md](CHECK-EXE-STRUCTURE.md) - Structure du build
- [check-exe-structure.ps1](check-exe-structure.ps1) - Diagnostic PowerShell
- [build-checklist.js](build-checklist.js) - Vérifications pré-build
