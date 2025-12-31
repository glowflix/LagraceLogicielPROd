# 🤖 Guide IA Python - Intégration avec Architecture Pro

## 📂 Accès aux Répertoires

L'IA Python doit écrire ses caches et résultats dans `C:\Glowflixprojet\cache\ai\`

### Configuration pour `ai-lagrace/main.py`

```python
import os
from pathlib import Path

# Point de montage commun (partagé avec Electron/Node)
GLOWFLIX_PATH = Path("C:/Glowflixprojet")

# Répertoires IA spécifiques
AI_CACHE_DIR = GLOWFLIX_PATH / "cache" / "ai"
AI_MODELS_DIR = AI_CACHE_DIR / "models"
AI_EMBEDDINGS_DIR = AI_CACHE_DIR / "embeddings"
AI_TEMP_DIR = AI_CACHE_DIR / "tmp"

# Créer les dossiers s'ils n'existent pas
for directory in [AI_MODELS_DIR, AI_EMBEDDINGS_DIR, AI_TEMP_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

print(f"IA Cache: {AI_CACHE_DIR}")
```

## 🗣️ Services IA Disponibles

### 1. TTS (Text-to-Speech) avec Piper

```python
# ai-lagrace/services/tts.py
from pathlib import Path

class TTSService:
    def __init__(self):
        # Cache les voix téléchargées
        self.cache_dir = Path("C:/Glowflixprojet/cache/ai/piper_voices")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def synthesize(self, text: str, voice: str = "fr_FR-harpa-medium") -> bytes:
        """
        Génère l'audio à partir du texte
        Voice sera cachée dans C:\Glowflixprojet\cache\ai\piper_voices\
        """
        # Piper télécharge les voix dans le cache
        # On contrôle le cache via la variable PIPER_CACHE_DIR
        os.environ["PIPER_CACHE_DIR"] = str(self.cache_dir)
        
        # ... reste du code ...
        return audio_bytes
```

### 2. STT (Speech-to-Text) avec Whisper

```python
# ai-lagrace/services/stt.py
class STTService:
    def __init__(self):
        # Cache les modèles Whisper
        self.cache_dir = Path("C:/Glowflixprojet/cache/ai/whisper_models")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def transcribe(self, audio_path: str) -> str:
        """
        Transcrit l'audio en texte
        Modèles cachés dans C:\Glowflixprojet\cache\ai\whisper_models\
        """
        os.environ["XDG_CACHE_HOME"] = str(self.cache_dir.parent)
        
        # Charger le modèle (une fois, depuis le cache)
        model = whisper.load_model("small", download_root=str(self.cache_dir))
        
        result = model.transcribe(audio_path)
        return result["text"]
```

### 3. Intent Recognition (NLU)

```python
# ai-lagrace/services/intent.py
from pathlib import Path

class IntentService:
    def __init__(self):
        # Cache les modèles NLU
        self.cache_dir = Path("C:/Glowflixprojet/cache/ai/intent_models")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.model_path = self.cache_dir / "intent_model.pkl"
    
    def recognize(self, text: str) -> dict:
        """
        Reconnaît l'intention de l'utilisateur
        Modèle sauvegardé dans C:\Glowflixprojet\cache\ai\intent_models\
        """
        # Charger ou entraîner le modèle
        if self.model_path.exists():
            model = pickle.load(open(self.model_path, 'rb'))
        else:
            model = self._train_model()
            pickle.dump(model, open(self.model_path, 'wb'))
        
        # Prédire l'intention
        return model.predict(text)
```

### 4. Embeddings & RAG

```python
# ai-lagrace/services/embeddings.py
from pathlib import Path

class EmbeddingService:
    def __init__(self):
        # Cache les vecteurs d'embedding
        self.cache_dir = Path("C:/Glowflixprojet/cache/ai/embeddings")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.embeddings_db = self.cache_dir / "embeddings.npz"
    
    def store_embedding(self, text: str, vector: list):
        """Sauvegarde un embedding"""
        # Stocker dans C:\Glowflixprojet\cache\ai\embeddings\
        np.savez(self.embeddings_db, vectors=vector, texts=text)
    
    def search_similar(self, query_vector: list, top_k: int = 5):
        """Recherche les embeddings similaires"""
        if self.embeddings_db.exists():
            data = np.load(self.embeddings_db)
            # Recherche cosinus similarity
            return self._find_top_similar(query_vector, data, top_k)
```

## 📝 Logging depuis l'IA

```python
# ai-lagrace/main.py

import logging
from pathlib import Path

# Configurer les logs pour écrire dans C:\Glowflixprojet\logs\ai.log
log_file = Path("C:/Glowflixprojet/logs/ai.log")
log_file.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=str(log_file),
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)

# Utiliser
logger.info("IA LaGrace démarrée")
logger.info("Modèle Whisper chargé depuis cache")
logger.error("Erreur processing", exc_info=True)
```

## 🔌 Communication avec Node/Electron

### Via Socket (recommandé pour l'IA)

```python
# ai-lagrace/services/socket_client.py

import socket
import json

class SocketClient:
    def __init__(self, host='localhost', port=3030):
        self.host = host
        self.port = port
    
    def send_transcription(self, text: str):
        """Envoyer la transcription au serveur Node"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect((self.host, self.port))
            
            data = json.dumps({
                'type': 'transcription',
                'text': text,
                'timestamp': time.time()
            })
            
            sock.sendall(data.encode())
            sock.close()
        except Exception as e:
            logger.error(f"Socket error: {e}")
    
    def request_print_template(self, template_name: str):
        """Demander un template au serveur"""
        # Envoyer une requête pour récupérer un template
        pass
```

### Via HTTP (alternative)

```python
import requests

class HTTPClient:
    def __init__(self, base_url='http://localhost:3030'):
        self.base_url = base_url
    
    def log_ai_event(self, event_type: str, data: dict):
        """Envoyer un événement au backend"""
        try:
            response = requests.post(
                f'{self.base_url}/api/ai/event',
                json={'type': event_type, 'data': data},
                timeout=5
            )
            response.raise_for_status()
        except requests.RequestException as e:
            logger.error(f"HTTP error: {e}")
    
    def fetch_data(self, endpoint: str):
        """Récupérer des données du backend"""
        try:
            response = requests.get(
                f'{self.base_url}{endpoint}',
                timeout=5
            )
            return response.json()
        except Exception as e:
            logger.error(f"Fetch error: {e}")
```

## 🎯 Exemple: Assistant Complet

```python
# ai-lagrace/services/assistant.py

from pathlib import Path
from tts import TTSService
from stt import STTService
from intent import IntentService
import logging

logger = logging.getLogger(__name__)

class LaGraceAssistant:
    def __init__(self):
        self.cache_root = Path("C:/Glowflixprojet/cache/ai")
        self.tts = TTSService()
        self.stt = STTService()
        self.intent = IntentService()
        
        logger.info("Assistant initié")
    
    def process_audio(self, audio_data: bytes) -> bytes:
        """
        Traite l'audio:
        1. Transcrit (STT)
        2. Reconnaît intention
        3. Génère réponse (TTS)
        """
        try:
            # 1. Transcrire l'audio
            text = self.stt.transcribe(audio_data)
            logger.info(f"Transcription: {text}")
            
            # 2. Reconnaître l'intention
            intent = self.intent.recognize(text)
            logger.info(f"Intention détectée: {intent}")
            
            # 3. Générer la réponse (selon l'intention)
            response_text = self._generate_response(intent)
            logger.info(f"Réponse générée: {response_text}")
            
            # 4. Synthétiser la réponse audio
            response_audio = self.tts.synthesize(response_text)
            
            return response_audio
        
        except Exception as e:
            logger.error(f"Erreur processing: {e}", exc_info=True)
            return b""
    
    def _generate_response(self, intent: dict) -> str:
        """Génère une réponse selon l'intention"""
        intent_type = intent.get('type')
        
        if intent_type == 'greeting':
            return "Bonjour! Comment puis-je vous aider?"
        elif intent_type == 'invoice':
            return "Créer une facture? D'accord, quel est le montant?"
        elif intent_type == 'print':
            return "Imprimer un document? Quel type de document?"
        else:
            return "Je n'ai pas bien compris. Pouvez-vous répéter?"
```

## 🚀 Configuration au Démarrage

```python
# ai-lagrace/main.py

import sys
from pathlib import Path
import logging

# Ajouter src au path pour les imports
sys.path.insert(0, str(Path(__file__).parent))

# Configurer les répertoires de cache
GLOWFLIX_PATH = Path("C:/Glowflixprojet")
os.environ["XDG_CACHE_HOME"] = str(GLOWFLIX_PATH / "cache")
os.environ["PIPER_CACHE_DIR"] = str(GLOWFLIX_PATH / "cache" / "ai" / "piper_voices")

# Logger
log_file = GLOWFLIX_PATH / "logs" / "ai.log"
logging.basicConfig(
    filename=str(log_file),
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)

logger = logging.getLogger(__name__)

def main():
    logger.info("🤖 AI LaGrace démarrée")
    logger.info(f"Cache directory: {GLOWFLIX_PATH / 'cache' / 'ai'}")
    
    assistant = LaGraceAssistant()
    
    # Boucle principale
    while True:
        # Écouter, traiter, répondre
        pass

if __name__ == "__main__":
    main()
```

## 📊 Monitoring & Maintenance

```python
# Nettoyer les vieux caches tous les jours
import shutil
from datetime import datetime, timedelta

def cleanup_old_cache(max_age_days=30):
    """Supprime les fichiers de cache > 30 jours"""
    cache_dir = Path("C:/Glowflixprojet/cache/ai")
    cutoff = datetime.now() - timedelta(days=max_age_days)
    
    for file in cache_dir.rglob('*'):
        if file.is_file():
            mtime = datetime.fromtimestamp(file.stat().st_mtime)
            if mtime < cutoff:
                file.unlink()
                logger.info(f"Deleted old cache: {file}")

# Appeler quotidiennement
import schedule
schedule.every().day.at("02:00").do(cleanup_old_cache)
```

---

## ✨ Résumé

- ✅ Tous les caches IA dans `C:\Glowflixprojet\cache\ai\`
- ✅ Logs dans `C:\Glowflixprojet\logs\ai.log`
- ✅ Communication avec Node via socket ou HTTP
- ✅ Persistant à travers les redémarrages
- ✅ Partagé avec Electron/Node (pas de duplication)

L'IA Python s'intègre seamlessly avec l'architecture pro!
