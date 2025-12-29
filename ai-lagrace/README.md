# 🌟 AI LaGrace - Assistant Vocal Intelligent

Assistant vocal intelligent pour **La Grâce POS** qui fonctionne **100% offline** et parle **français**.

## 🎯 Fonctionnalités

### 🎤 Reconnaissance Vocale
- **Wake Word**: Dites "LaGrace" pour activer l'assistant
- **Compréhension naturelle** en français
- **100% Offline** avec Vosk

### 🔊 Synthèse Vocale (Parle en français)
- **Salutation intelligente** selon l'heure (Bonjour/Bon après-midi/Bonsoir)
- **Annonce les ventes** finalisées automatiquement
- **Annonce les impressions** lancées et terminées
- **Alerte stock bas** automatiquement

### 📡 Intégration Socket.IO
- Connecté au serveur Node.js en temps réel
- Reçoit les événements de vente, impression, connexion utilisateur
- Annonce vocalement les événements importants

## 🚀 Installation

### Étape 1 : Installer les dépendances Python

```bash
cd ai-lagrace
pip install -r requirements.txt
```

### Étape 2 : Télécharger le modèle Vosk

1. Allez sur: https://alphacephei.com/vosk/models
2. Téléchargez: `vosk-model-small-fr-0.22` (~40 MB)
3. Extrayez dans: `ai-lagrace/models/vosk-model-small-fr-0.22`

### Étape 3 : Tester

```bash
cd ai-lagrace
python main.py --test   # Mode test sans wake word
python main.py          # Démarrage normal
```

## 🎙️ Commandes Vocales

| Commande | Exemple |
|----------|---------|
| **Stock** | "LaGrace, quel est le stock de Mosquito ?" |
| **Ventes** | "LaGrace, ventes d'aujourd'hui" |
| **Prix** | "LaGrace, combien coûte le Raid ?" |
| **Dettes** | "LaGrace, qui nous doit de l'argent ?" |
| **Impression** | "LaGrace, imprime la dernière facture" |
| **Aide** | "LaGrace, qu'est-ce que tu sais faire ?" |

## 🔔 Annonces Automatiques

L'assistant parle automatiquement lors de :

| Événement | Exemple d'annonce |
|-----------|-------------------|
| **Ouverture logiciel** | "Bonjour ! Je suis LaGrace, votre assistante vocale..." |
| **Connexion utilisateur** | "Bonjour Jean ! Bienvenue sur La Grâce..." |
| **Vente finalisée** | "Vente finalisée pour Client X, total 50 dollars..." |
| **Impression lancée** | "Impression lancée pour la facture 20241229..." |
| **Impression terminée** | "Impression terminée." |
| **Stock bas** | "Attention ! Stock bas pour Mosquito, il reste 5 unités." |

## 🏗️ Architecture

```
┌─────────────────┐     Socket.IO      ┌─────────────────┐
│   AI LaGrace    │◄──────────────────►│   Node.js       │
│   (Python)      │                    │   Server        │
└─────────────────┘                    └─────────────────┘
        │                                      │
        ▼                                      ▼
   🎤 Microphone                         📱 Frontend React
   🔊 Haut-parleur                       🖨️ Module Impression
```

## 📁 Structure des Fichiers

```
ai-lagrace/
├── main.py              # Point d'entrée principal
├── requirements.txt     # Dépendances Python
├── start.bat           # Script de lancement Windows (CMD)
├── start.ps1           # Script de lancement PowerShell
├── README.md           # Ce fichier
├── config/
│   ├── __init__.py
│   └── settings.py     # Configuration (wake word, TTS, patterns)
├── services/
│   ├── __init__.py
│   ├── assistant.py    # Orchestrateur principal
│   ├── tts.py          # Synthèse vocale (parler)
│   ├── stt.py          # Reconnaissance vocale (écouter)
│   ├── wake_word.py    # Détection du mot "LaGrace"
│   ├── intent.py       # Compréhension des commandes
│   ├── socket_client.py # Communication Socket.IO
│   └── database.py     # Accès SQLite
└── models/
    └── vosk-model-small-fr-0.22/  # Modèle de reconnaissance vocale
```

## ⚙️ Configuration

Modifiez `config/settings.py` pour personnaliser :

- `WAKE_WORD` : Mot d'activation (défaut: "lagrace")
- `TTS_RATE` : Vitesse de parole (défaut: 175)
- `SOCKET_URL` : URL du serveur Node.js (défaut: "http://localhost:3030")

## 🐛 Dépannage

### Le micro ne fonctionne pas
- Vérifiez que le micro est bien configuré dans Windows
- Assurez-vous qu'aucune autre application n'utilise le micro

### Vosk ne se lance pas
- Vérifiez que le modèle est bien extrait dans `models/vosk-model-small-fr-0.22`
- Le dossier doit contenir des fichiers comme `am/final.mdl`

### La voix ne parle pas
- Installez une voix française dans Windows (Paramètres > Heure et langue > Reconnaissance vocale)
- Vérifiez le volume du système

### Connexion Socket.IO échoue
- Vérifiez que le serveur Node.js est démarré (port 3030)
- Vérifiez le pare-feu Windows

## 📜 Licence

Propriétaire - La Grâce Alimentation

