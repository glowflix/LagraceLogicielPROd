# 🎤 Problème TTS: L'IA Parle Seulement sur Electron, Pas sur le Navigateur

## 📋 Le Problème

Vous avez remarqué que:
- ✅ **Electron**: L'IA parle normalement
- ❌ **Navigateur** (http://localhost:5173/): L'IA ne parle pas

## 🔍 Cause Identifiée

Le service TTS utilise **sounddevice** pour jouer l'audio via les **haut-parleurs locaux de l'ordinateur**:

```python
sd.play(full_audio, samplerate=self.sample_rate)  # Joue sur speakers locaux
sd.wait()  # Attend la fin
```

### Pourquoi ça fonctionne sur Electron mais pas navigateur:
- **Electron**: Tourne **localement** sur votre machine → peut accéder aux haut-parleurs
- **Navigateur**: L'IA tourne **sur la même machine** mais le navigateur n'a **PAS ACCÈS** aux haut-parleurs du serveur

## 📊 Comment Fonctionne le Système Actuellement

```
┌─────────────────────────────────────────────────────────┐
│                    VOTRE ORDINATEUR                      │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐       ┌──────────────┐               │
│  │   Python AI  │       │   Electron   │               │
│  │  (Port 3030) │       │   App        │               │
│  │              │       │              │               │
│  │  🎤 TTS      │◄─────►│  🎧 Écoute   │               │
│  │  (sounddev)  │       │  Port: Built-in│              │
│  │              │       │              │               │
│  │  🔊 Haut-    │       │  🔊 Haut-    │               │
│  │  parleurs    │       │  parleurs    │               │
│  └──────────────┘       └──────────────┘               │
│         ▲                       ▲                        │
│         │ sounddevice.play()    │ Native Audio API       │
│         ▼                       ▼                        │
│      🔊 SPEAKERS (OK! ✅)       🔊 SPEAKERS (OK! ✅)   │
│                                                           │
│  ┌──────────────┐                                       │
│  │   Port 3030  │                                       │
│  │ Node Server  │                                       │
│  │              │                                       │
│  │  ◄─────────────► Navigateur (http://localhost:5173)│
│  │   Socket.IO  │                                       │
│  └──────────────┘         ❌ Ne peut pas jouer         │
│                              sur speakers serveur      │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## ✅ Solutions

### Solution 1: Envoyer l'Audio au Navigateur (RECOMMANDÉE)

Modifier le TTS pour envoyer l'audio **WAV ou MP3** au navigateur via Socket.IO:

```python
# Au lieu de:
sd.play(full_audio, samplerate=self.sample_rate)

# Faire:
audio_bytes = convert_to_wav(full_audio)
socket.emit('ai:speak', {'audio': base64.b64encode(audio_bytes)})
```

Le navigateur reçoit l'audio et le joue avec Web Audio API.

### Solution 2: Utiliser Text-to-Speech du Navigateur (Web Speech API)

Envoyer juste le **texte** au navigateur et le faire parler avec **sa propre voix**:

```javascript
// Dans le navigateur
const utterance = new SpeechSynthesisUtterance(text);
utterance.lang = 'fr-FR';
speechSynthesis.speak(utterance);
```

**Avantages**: 
- Simple et rapide
- Pas de données audio
- Voix naturelles du navigateur

**Inconvénients**:
- Voix différente de Piper
- Moins de contrôle

### Solution 3: Audio WebRTC/Streaming

Streamer l'audio en temps réel du serveur Python vers le navigateur.

---

## 🛠️ Logs Ajoutés pour Déboguer

J'ai ajouté des logs détaillés dans le TTS. Regardez la console pour:

```
[TTS] 🔍 Vérification dépendances TTS:
[TTS]    • PIPER_AVAILABLE: True/False ← Voir si Piper est OK
[TTS]    • SOUNDDEVICE_AVAILABLE: True/False ← Voir si sounddevice existe
[TTS]    • SCIPY_AVAILABLE: True/False

[TTS] 🎤 Synthèse Piper - Texte: '...'
[TTS]    📊 5 segments détectés
[TTS]    🔹 Segment 1/5: '...'
[TTS]       ✓ Audio synthétisé (88200 samples)
[TTS]    🔊 Lecture via sounddevice...
[TTS] ✅ Lecture audio complète OK
```

Si vous voyez des erreurs **sounddevice**, c'est normal en navigateur.

---

## 📝 Prochaines Étapes Recommandées

### Court terme (Quick Fix):
1. ✅ Les logs sont en place - vérifiez si les erreurs apparaissent
2. Ajouter un endpoint Node.js `/api/ai/speak` qui synthétise l'audio
3. Envoyer l'audio au navigateur
4. Le navigateur joue avec `new Audio(url).play()`

### Moyen terme:
- Créer un fichier `ai-speak-handler.js` dans le serveur
- Ajouter un route `/api/ai/audio` pour servir les fichiers audio
- Mettre en cache les audios synthétisés (stockage local)

### Long terme:
- WebRTC streaming pour une latence ultra-basse
- Compression audio (MP3, Opus)
- Gestion de la queue audio côté serveur

---

## 🧪 Comment Tester

### Sur Electron:
```bash
npm run electron
# L'IA parle ✅
```

### Sur Navigateur avec Tests:
```bash
npm run dev
# Aller à http://localhost:5173/
# Ouvrir DevTools (F12)
# Console → Regarder les logs [TTS]
# Vous verrez les erreurs sounddevice (c'est normal)
```

---

## ⚡ Status des Fichiers Modifiés

```
ai-lagrace/services/tts.py
├── ✅ start() - Logs des dépendances
├── ✅ _loop() - Logs du traitement queue
├── ✅ _speak() - Logs détaillés par moteur
├── ✅ _init() - Logs du chargement modèle
└── ✅ speak() - Logs complets de la synthèse

✅ Toutes les opérations TTS sont maintenant loggées
```

---

## 📞 Commandes Utiles pour Tester

```bash
# Lancer la console Python et tester TTS
cd ai-lagrace
python -c "from services.tts import TTSService; tts = TTSService(); tts.start(); tts.speak('Bonjour')"

# Vérifier les dépendances TTS
python -c "from services.tts import PIPER_AVAILABLE, SOUNDDEVICE_AVAILABLE, SCIPY_AVAILABLE; print(f'Piper: {PIPER_AVAILABLE}, SD: {SOUNDDEVICE_AVAILABLE}, Scipy: {SCIPY_AVAILABLE}')"
```

