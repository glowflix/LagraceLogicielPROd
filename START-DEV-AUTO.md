# 🚀 AUTO-DÉMARRAGE AI AVEC NPM RUN DEV

## ✅ Mise à Jour

`npm run dev` démarre maintenant **AUTOMATIQUEMENT**:

```
┌─────────────────────────────────────────────────────┐
│                 npm run dev                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ✅ Backend Node.js   (port 3030)     [cyan]       │
│  ✅ Frontend Vite     (port 5173)     [magenta]    │
│  ✅ AI LaGrace Python (Socket.IO)     [yellow]     │
│  ✅ Electron          (await)         [green]      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 🎯 Utilisation

### Développement Web (Navigateur)
```bash
npm run dev
```

Puis ouvrir: **http://localhost:5173/**

✅ L'IA démarre automatiquement en parallèle
✅ Vous pouvez entendre la parole dans le navigateur

### Développement Electron
```bash
npm run dev
```

✅ L'IA démarre automatiquement
✅ Electron s'ouvre après que tout soit prêt
✅ Vous avez les logs de 4 processus

### IA Seule (pour tester)
```bash
npm run dev:ai
```

ou 

```bash
cd ai-lagrace
python main.py
```

---

## 🖥️ Ce Que Vous Verrez dans le Terminal

### Avec `npm run dev`:

```
> concurrently ...

 backend   ✅ Serveur démarré sur port 3030
 ui        ✅ Vite prêt à http://localhost:5173/
 ai        🎤 AI LaGrace - DÉMARRAGE
 ai        ✅ AI LaGrace PRÊTE !
 electron  ▶️ Attente de http://localhost:3030...
 electron  ✅ Connexion établie, lancement Electron...
```

### Couleurs Concurrently:
- **Cyan** = Backend Node.js
- **Magenta** = Frontend Vite
- **Yellow** = IA Python ← NOUVEAU!
- **Green** = Electron

---

## 🔌 Architecture

```
┌────────────────────────────────────────────────────┐
│              Terminal npm run dev                  │
├────────────────────────────────────────────────────┤
│                                                    │
│  [Backend]           [UI]          [AI]          │
│  Node.js             Vite          Python        │
│  :3030               :5173         Socket.IO     │
│     │                  │              │          │
│     └──────────────────┴──────────────┘          │
│              Communique via                       │
│         Socket.IO + REST API                     │
│                                                    │
│  [Electron] (optionnel)                          │
│  Utilise http://localhost:3030 et :5173         │
│  + Socket.IO pour recevoir l'audio IA           │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## 📊 Scripts Disponibles

```bash
# Démarrer tout (Backend + UI + AI + Electron)
npm run dev

# Démarrer tout SANS Electron (Web uniquement)
npm run dev:ui
# ... mais vous devez lancer AI manuellement

# Démarrer IA seule
npm run dev:ai

# Démarrage Electron complet
npm run dev:electron

# Démarrage application complète
npm run dev:app
```

---

## ⚠️ Points Importants

### 1️⃣ Python Doit Être Installé
```bash
python --version
# Doit afficher Python 3.8+
```

### 2️⃣ Dépendances Python Requises
```bash
cd ai-lagrace
pip install -r requirements.txt
```

### 3️⃣ La IA Démarre Après le Backend
```
1. Backend Node.js démarre
2. UI Vite démarre
3. AI Python démarre (attend backend)
4. Electron se lance (attend UI + backend)
```

### 4️⃣ Arrêter Tout
```
Ctrl+C dans le terminal
Ou touche 'q' si demandé
```

---

## 🔍 Dépannage

### "python: command not found"
```bash
# Vérifier que Python est installé
python --version

# Si c'est python3:
# Modifier package.json et remplacer python par python3
```

### "ModuleNotFoundError" en Python
```bash
cd ai-lagrace
pip install -r requirements.txt
```

### "Port 3030 already in use"
```bash
# Trouver le processus
netstat -ano | findstr :3030

# Tuer le processus (Windows)
taskkill /PID <PID> /F
```

### IA ne démarre pas avec npm run dev
```bash
# Vérifier que ça fonctionne manuellement
cd ai-lagrace
python main.py

# Si ça marche, mais pas avec npm run dev,
# vérifier les permissions ou PATH Python
```

---

## 📝 Fichiers Modifiés

```
package.json
├── ✅ "dev" ajouté "python ai-lagrace/main.py"
├── ✅ "dev:ai" nouveau script
├── ✅ "dev:electron" ajouté IA
├── ✅ "dev:app" ajouté IA
└── ✅ Couleur yellow pour IA dans concurrently
```

---

## ✨ Avantages

✅ **Un seul commande** pour démarrer tout
✅ **Logs de tous les processus** visibles
✅ **Gestion automatique** des dépendances
✅ **IA active** dès que Backend est prêt
✅ **Développement fluide** sans scripts manuels

---

## 🎯 Flux De Développement Recommandé

```bash
# Terminal 1 - Démarrer tout
npm run dev

# Attendre:
# ✅ Backend démarré
# ✅ UI démarré
# ✅ AI démarrée
# ✅ Electron lancé (si voulu)

# Terminal 2 - Ouvrir navigateur (si pas Electron)
# http://localhost:5173

# Commencer à développer!
```

---

## 💬 Commandes Utiles Pendant le Développement

```bash
# Redémarrer juste l'IA
# (Ctrl+C sur la ligne jaune ai-lagrace, puis Ctrl+C global)

# Redémarrer juste l'UI
# (Ctrl+C sur la ligne magenta vite, puis Ctrl+C global)

# Arrêter tout proprement
# (Ctrl+C global, puis attendre fermeture)
```

---

## 🚀 Prêt!

```bash
npm run dev
```

Et c'est tout! 🎉

