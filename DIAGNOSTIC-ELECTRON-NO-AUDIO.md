# 🔍 DIAGNOSTIC - L'IA Ne Parle Pas sur Electron

## 📋 Checklist de Diagnostic

### Étape 1: Vérifier que l'IA Synthétise
```
[TTS] 🎤 SYNTHÈSE TTS #1
[TTS]    📝 Texte: '...'
[TTS]    ✅ Piper synthèse OK
```

**Si vous voyez ces logs** → Go to Étape 2
**Si vous ne les voyez PAS** → L'IA n'est pas appelée (problème d'intent/activation)

---

### Étape 2: Vérifier Sounddevice
```
[TTS] 🔊 Sounddevice disponible - X device(s)
[TTS] 📻 Device par défaut: Haut-parleurs (ou votre device)
```

**Si vous voyez le device** → Go to Étape 3
**Si vous voyez ERREUR** → Sounddevice ne fonctionne pas

---

### Étape 3: Vérifier la Lecture
```
[TTS]    🎵 Lecture locale via sounddevice...
[TTS]    ✅ Lecture locale Electron OK
```

**Si vous voyez OK** → Le son DEVRAIT sortir des haut-parleurs
**Si vous voyez ❌ ERREUR** → Allez à "Problèmes Courants"

---

### Étape 4: Vérifier le Volume
```
Assurez-vous que:
✅ Le volume Windows n'est pas à 0
✅ Les haut-parleurs ne sont pas en sourdine
✅ L'app Electron n'a pas les perms audio bloquées
```

---

## ❌ Problèmes Courants et Solutions

### Problème 1: "Sounddevice non disponible"
```
[TTS] ⚠️ Sounddevice non disponible
```

**Solution:**
```bash
cd ai-lagrace
pip install sounddevice
```

---

### Problème 2: "Pas de device output par défaut"
```
[TTS] ⚠️ Pas de device output par défaut configuré
```

**Solutions:**
1. Vérifier que vous avez des haut-parleurs branchés
2. Vérifier les paramètres Windows audio
3. Si sur VM/Remote, sounddevice ne fonctionne peut-être pas

---

### Problème 3: "Port audio occupé"
```
[TTS] ❌ Sounddevice: [Error 1] No application is currently available
```

**Solution:**
1. Fermer les autres apps utilisant l'audio
2. Redémarrer le terminal PowerShell

---

### Problème 4: "PermissionError"
```
[TTS] ❌ Sounddevice: [PermissionError]
```

**Solution:**
1. Démarrer PowerShell en Admin
2. Ou donner les permissions audio à l'app

---

## 🧪 Test Manuel de Sounddevice

```bash
# Terminal Python dans ai-lagrace/
cd ai-lagrace
python
```

Puis:
```python
import sounddevice as sd
import numpy as np

# Lister les devices
print("Devices disponibles:")
print(sd.query_devices())

# Créer un son test
sr = 22050
duration = 1
freq = 440  # La
t = np.linspace(0, duration, int(sr * duration))
audio = np.sin(2 * np.pi * freq * t) * 0.3

# Jouer
print("Lecture du son test...")
sd.play(audio, sr)
sd.wait()
print("Fini!")

exit()
```

**Si le son sort** → Sounddevice fonctionne
**Si pas de son ou erreur** → Problème système audio

---

## 🎯 Flux Complet de Test

### 1. Terminal Python
```bash
npm run dev
```

Attendre les logs:
```
[TTS] 🔊 Sounddevice disponible
[TTS] 📻 Device par défaut: ...
✅ AI LaGrace PRÊTE !
```

### 2. Déclencher une action IA
```
Dans Electron: Déclencher un événement qui fait parler l'IA
```

### 3. Regarder les logs JAUNE (IA)
```
[TTS] 🎤 SYNTHÈSE TTS
[TTS] ✅ Piper synthèse OK
[TTS] 🎵 Lecture locale via sounddevice...
[TTS] ✅ Lecture locale Electron OK
```

### 4. Écouter
```
Les haut-parleurs devraient sortir du son!
```

---

## 📊 Matrice de Diagnostic

| État | Logs Jaune | Logs Chrome | Résultat |
|------|-----------|----------|----------|
| ✅ OK | ✅ Synthèse + ✅ Lecture locale | ✅ Réception + ▶️ Lecture | Son sur les 2 côtés |
| ⚠️ Partiel | ✅ Synthèse | ✅ Réception + ▶️ Lecture | Son UNIQUEMENT sur navigateur |
| ❌ Non | ❌ Pas de synthèse | ❌ Pas de réception | Pas de son du tout |

---

## 💡 Debugging Avancé

### Si sounddevice plante silencieusement:
```python
# Dans ai-lagrace/services/tts.py
# Ajouter avant sd.play():
print(f"DEBUG: Audio shape: {full_audio.shape}")
print(f"DEBUG: Audio dtype: {full_audio.dtype}")
print(f"DEBUG: Audio min/max: {full_audio.min()}/{full_audio.max()}")
print(f"DEBUG: Sample rate: {self.sample_rate}")
```

### Si c'est un problème d'encodage:
```bash
# Vérifier les paramètres WAV
python -c "
import soundfile as sf
# Tester lecture d'un WAV
sf.read('test.wav')
"
```

---

## ✅ Checklist Finale

Avant de dire "ça ne marche pas", assurez-vous que:

- [ ] Python est installé et fonctionnel
- [ ] `pip install sounddevice` a été exécuté
- [ ] Vous avez des haut-parleurs branchés/visibles
- [ ] Volume Windows n'est pas à 0
- [ ] Vous avez lancé `npm run dev` (PAS d'autres instances Python)
- [ ] L'IA dit "PRÊTE" au démarrage
- [ ] Vous avez déclenché une action IA
- [ ] Vous avez ATTENDU le texte dans les logs JAUNE

---

## 🆘 Si Rien Ne Marche

**Copiez TOUS ces logs et envoyez:**

### De Terminal (logs JAUNE):
```
[TTS] 🔊 Sounddevice...
[TTS] 🎤 SYNTHÈSE TTS
[TTS] ✅ Piper synthèse OK
[TTS] 🎵 Lecture locale...
```

### Ou si erreur:
```
[TTS] ❌ Sounddevice: [ERREUR EXACTE ICI]
```

Ainsi je peux voir **exactement** ce qui se passe! 🔍

