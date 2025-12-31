# 🧪 GUIDE DE TEST - LOGS DÉTAILLÉS

## 📋 Traces Complètes Attendues

Après avoir ajouté les logs "pro", voici ce que vous devriez voir **de bout en bout**:

---

## 🔴 CÔTÉ PYTHON (Terminal IA)

### 1. Démarrage TTS
```
[07:05:32.123] [TTS] 🎤 [07:05:32.123] ========== SYNTHÈSE TTS #1 ==========
[07:05:32.123] [TTS]    📝 Texte: 'Bonjour! Je suis LaGrace, votre assistante vocale.'
[07:05:32.123] [TTS]    🔹 Taille: 54 caractères
```

### 2. Synthèse Piper
```
[07:05:32.125] [TTS]    🎛️ Moteur: Piper (Offline UPMC)
[07:05:32.250] [TTS]    ✅ Piper synthèse OK - Envoyé au navigateur
[07:05:32.251] [TTS]    📊 Audio final: 88200 samples (2.00s)
```

### 3. Envoi Socket.IO
```
[07:05:32.252] [TTS]    📡 Socket.IO: CONNECTÉ (socket_id: a1b2c3d4...)
[07:05:32.253] [TTS]    📡 Encodage audio en base64...
[07:05:32.300] [TTS]    📦 Taille WAV: 176500 bytes | Base64: 235334 chars
[07:05:32.301] [TTS]    📤 Émission événement 'ai:speak'...
[07:05:32.302] [TTS]    ✅ Événement 'ai:speak' émis au navigateur!
[07:05:32.302] [TTS]    📊 Détails: Texte='Bonjour! Je suis LaGrace...' | Durée=2.00s
```

### 4. Fin
```
[07:05:32.302] [TTS]    🎵 Lecture locale via sounddevice...
[07:05:32.350] [TTS]    ✅ Lecture locale Electron OK
[07:05:34.250] [TTS] 🏁 Fin synthèse #1
[07:05:34.250] [TTS] =======================================================
```

---

## 🔵 CÔTÉ NAVIGATEUR (Chrome DevTools - Console)

### 1. Réception événement Socket.IO
```
[07:05:32.350] [AudioHandler] 🎤 ========== RÉCEPTION AUDIO ==========
[07:05:32.350] [AudioHandler]    📝 Texte: "Bonjour! Je suis LaGrace, votre assistante vocale."
[07:05:32.350] [AudioHandler]    📊 Durée annoncée: 2.00s
[07:05:32.350] [AudioHandler]    📦 Taille payload: 235334 chars
[07:05:32.350] [AudioHandler]    ⏱️ Timestamp serveur: 2025-12-30T07:05:32.302Z
[07:05:32.351] [AudioHandler] 🔍 Décodage audio...
```

### 2. Décodage WAV
```
[07:05:32.352] [AudioHandler]    🔹 Extraction base64...
[07:05:32.352] [AudioHandler]    📦 Données binaires: 176500 bytes
[07:05:32.360] [AudioHandler]    🔊 Décodage WAV via AudioContext...
[07:05:32.380] [AudioHandler]    ✅ Audio décodé!
[07:05:32.380] [AudioHandler]       • Durée: 2.00s
[07:05:32.380] [AudioHandler]       • Sample rate: 22050 Hz
[07:05:32.380] [AudioHandler]       • Canaux: 1
```

### 3. Ajout à queue
```
[07:05:32.380] [AudioHandler] ✅ Audio ajouté à la queue (1 items)
[07:05:32.380] [AudioHandler] ========================================

```

### 4. Lecture
```
[07:05:32.381] [AudioHandler] 🎵 ========== LECTURE AUDIO ==========
[07:05:32.381] [AudioHandler]    ⏳ Items restants en queue: 0
[07:05:32.381] [AudioHandler]    ▶️ Démarrage lecture... Durée: 2.00s
[07:05:32.381] [AudioHandler]    🔊 AudioContext state: running
```

### 5. Fin de lecture
```
[07:05:34.381] [AudioHandler]    ✅ Fin de la lecture
[07:05:34.381] [AudioHandler] ========================================

```

---

## 🔍 COMMENT LIRE LES LOGS

### Python (Electron + Navigateur)
```
🔊 LaGrace PARLE: ...        ← Appel speak() depuis app
📝 Texte reçu (XX chars):   ← Texte arrivé dans TTS
🎤 SYNTHÈSE TTS #1          ← Démarrage synthèse
🎛️ Moteur: Piper            ← Quel moteur TTS
✅ Piper synthèse OK         ← Synthèse réussie
📡 Socket.IO: CONNECTÉ      ← Vérifier si connecté au navigateur!
📤 Émission événement        ← Audio envoyé au navigateur
✅ Événement émis!          ← Succès = audio en route
🎵 Lecture locale OK         ← Audio joué sur Electron
```

### Navigateur (Chrome)
```
[AudioHandler] ✅ Contexte audio initialisé    ← Web Audio API OK
📡 Configuration écouteurs Socket.IO           ← Prêt à écouter
🎤 RÉCEPTION AUDIO                             ← Audio arrivé!
📝 Texte: "..."                                ← Le texte reçu
📦 Taille payload: XXX chars                   ← Taille base64
🔍 Décodage audio...                           ← En train de décoder
✅ Audio décodé!                               ← Décodage OK
🎵 LECTURE AUDIO                               ← En train de jouer
▶️ Démarrage lecture... Durée: 2.00s           ← Lecture lancée
🔊 AudioContext state: running                 ← Web Audio API actif
✅ Fin de la lecture                           ← Audio terminé
```

---

## ❌ PROBLÈMES À CHERCHER

### Si Python ne parle pas:
```
❌ Problème: "IA n'est pas en train de tourner"
Solution: Lancer python main.py dans un terminal
```

### Si pas de Socket.IO:
```
❌ [TTS] ⚠️ Socket.IO non connecté
🔹 Fallback: Lecture locale uniquement...

Cela veut dire:
- L'IA parle sur Electron (sounddevice)
- Mais ne peut PAS envoyer au navigateur
```

### Si navigateur ne reçoit rien:
```
❌ [AudioHandler] ne reçoit pas 'ai:speak'

Vérifier:
1. Socket.IO connecté côté navigateur? (useStore logs)
2. AudioHandler initialisé? (audioHandler.js logs)
3. Événement émis côté Python? (TTS logs)
```

### Si audio ne joue pas:
```
❌ [AudioHandler] ❌ Erreur lecture: ...

Regarder l'erreur exacte
Possibilités:
- AudioContext suspendu (état: suspended)
- Problème décodage WAV
- Permissions navigateur
```

---

## 🚀 ÉTAPES DE TEST

### 1. Lancer Python IA
```bash
cd d:\logiciel\La Grace pro\v1\ai-lagrace
python main.py
```

Attendre:
```
✅ AI LaGrace PRÊTE !
```

### 2. Ouvrir navigateur Chrome
```
http://localhost:5173
```

Ouvrir DevTools: `F12` → Onglet `Console`

### 3. Déclencher la parole
```
Déclenchez une action qui fait parler l'IA
```

### 4. Regarder les DEUX consoles
```
[Terminal Python]    ← Synthèse TTS + Socket.IO
[Chrome DevTools]    ← Réception + Lecture audio
```

Vous devriez voir le **flux complet**!

---

## 📊 TABLEAU DE DIAGNOSTIC

| Étape | Python | Navigateur | Résultat |
|-------|--------|-----------|----------|
| 1. TTS synthétise | ✅ `Piper OK` | - | Audio créé |
| 2. Envoie Socket | ✅ `Émission` | - | En route |
| 3. Navigateur reçoit | - | ✅ `Réception` | Arrivé |
| 4. Décode | - | ✅ `Décodé` | Prêt à jouer |
| 5. Joue | - | ✅ `Lecture` | 🔊 AUDIO! |

---

## 💾 Fichiers à Consulter

```
ai-lagrace/services/tts.py
├── Logs de synthèse (speak, _speak)
├── Logs de Socket.IO (ai:speak event)
└── Logs d'erreur

src/ui/utils/audioHandler.js
├── Logs de réception (handleAiSpeak)
├── Logs de décodage (decodeAudio)
└── Logs de lecture (playNext)

src/ui/store/useStore.js
└── Logs de Socket.IO (AudioHandler init)
```

---

## 🎯 CE QUE VOUS CHERCHEZ

```
✅ SUCCÈS = Vous voyez:
  [Python] ✅ Événement 'ai:speak' émis
  [Chrome] 🎵 LECTURE AUDIO
  [Chrome] 🔊 AudioContext state: running
  
❌ PROBLÈME = Vous voyez UNE de ces lacunes:
  [Python] AUCUN log Socket.IO
  [Chrome] AUCUN log AudioHandler
  [Python] ⚠️ Socket.IO non connecté
  [Chrome] ❌ Erreur quelconque
```

---

## 📞 Si Vous Êtes Bloqué

Copiez-collez **TOUS ces logs**:

### De Python:
```
[TTS] de "Texte reçu" jusqu'à "Fin synthèse"
```

### De Chrome DevTools:
```
[AudioHandler] tous les logs pertinents
```

Ainsi je peux **exactement** voir où ça bloque! 🎯

