"""
Speech-to-Text Service (STT)
============================
Reconnaissance vocale en français - OFFLINE avec Vosk
"""

import json
import queue
import threading
import sys
from pathlib import Path
from typing import Optional, Callable

# Colorama pour les couleurs Windows
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    class Fore:
        GREEN = YELLOW = RED = CYAN = BLUE = ""
    class Style:
        RESET_ALL = ""

# Imports audio
try:
    import sounddevice as sd
    import numpy as np
    AUDIO_AVAILABLE = True
except ImportError:
    AUDIO_AVAILABLE = False
    print(f"{Fore.YELLOW}⚠️  sounddevice/numpy non installés{Style.RESET_ALL}")

# Import Vosk
try:
    from vosk import Model, KaldiRecognizer
    VOSK_AVAILABLE = True
except ImportError:
    VOSK_AVAILABLE = False
    print(f"{Fore.YELLOW}⚠️  vosk non installé - STT désactivé{Style.RESET_ALL}")

sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])
from config.settings import settings


class STTService:
    """Service de reconnaissance vocale offline avec Vosk"""
    
    def __init__(self):
        self.model: Optional[Model] = None
        self.recognizer: Optional[KaldiRecognizer] = None
        self.audio_queue = queue.Queue()
        self.running = False
        self.listening = False
        self._thread: Optional[threading.Thread] = None
        self._stream: Optional[sd.InputStream] = None
        self._on_text_callback: Optional[Callable[[str], None]] = None
        self._on_partial_callback: Optional[Callable[[str], None]] = None
        
    def start(self) -> bool:
        """Démarrer le service STT"""
        if not VOSK_AVAILABLE:
            print(f"{Fore.YELLOW}⚠️  Vosk non disponible{Style.RESET_ALL}")
            return False
            
        if not AUDIO_AVAILABLE:
            print(f"{Fore.YELLOW}⚠️  Audio non disponible{Style.RESET_ALL}")
            return False
        
        # Charger le modèle Vosk
        if not self._load_model():
            return False
        
        # Démarrer le thread de reconnaissance
        self.running = True
        self._thread = threading.Thread(target=self._recognition_loop, daemon=True)
        self._thread.start()
        
        print(f"{Fore.GREEN}✅ STT initialisé avec Vosk{Style.RESET_ALL}")
        return True
    
    def _load_model(self) -> bool:
        """Charger le modèle Vosk français"""
        model_path = Path(settings.vosk_model_path)
        
        if not model_path.exists():
            print(f"{Fore.RED}❌ Modèle Vosk non trouvé: {model_path}{Style.RESET_ALL}")
            print(f"{Fore.YELLOW}💡 Téléchargez le modèle depuis:{Style.RESET_ALL}")
            print(f"{Fore.CYAN}   https://alphacephei.com/vosk/models{Style.RESET_ALL}")
            print(f"{Fore.YELLOW}   Puis extrayez dans: {model_path.parent}{Style.RESET_ALL}")
            return False
        
        try:
            print(f"{Fore.CYAN}📦 Chargement du modèle Vosk...{Style.RESET_ALL}")
            self.model = Model(str(model_path))
            self.recognizer = KaldiRecognizer(self.model, settings.sample_rate)
            self.recognizer.SetWords(True)
            print(f"{Fore.GREEN}✅ Modèle Vosk chargé{Style.RESET_ALL}")
            return True
        except Exception as e:
            print(f"{Fore.RED}❌ Erreur chargement modèle: {e}{Style.RESET_ALL}")
            return False
    
    def _audio_callback(self, indata, frames, time, status):
        """Callback pour capturer l'audio du microphone"""
        if status:
            print(f"{Fore.YELLOW}⚠️  Audio status: {status}{Style.RESET_ALL}")
        if self.listening:
            self.audio_queue.put(bytes(indata))
    
    def _recognition_loop(self):
        """Boucle de reconnaissance vocale"""
        while self.running:
            try:
                data = self.audio_queue.get(timeout=0.5)
                if data is None:  # Signal d'arrêt
                    break
                
                if self.recognizer and self.listening:
                    if self.recognizer.AcceptWaveform(data):
                        result = json.loads(self.recognizer.Result())
                        text = result.get("text", "").strip()
                        if text and self._on_text_callback:
                            self._on_text_callback(text)
                    else:
                        # Résultat partiel
                        partial = json.loads(self.recognizer.PartialResult())
                        partial_text = partial.get("partial", "").strip()
                        if partial_text and self._on_partial_callback:
                            self._on_partial_callback(partial_text)
                            
            except queue.Empty:
                continue
            except Exception as e:
                print(f"{Fore.RED}❌ Erreur recognition: {e}{Style.RESET_ALL}")
    
    def start_listening(self, 
                        on_text: Optional[Callable[[str], None]] = None,
                        on_partial: Optional[Callable[[str], None]] = None):
        """Commencer à écouter le microphone"""
        if not self.running:
            print(f"{Fore.YELLOW}⚠️  STT non démarré{Style.RESET_ALL}")
            return False
        
        self._on_text_callback = on_text
        self._on_partial_callback = on_partial
        
        try:
            self._stream = sd.InputStream(
                samplerate=settings.sample_rate,
                blocksize=settings.chunk_size,
                dtype=np.int16,
                channels=settings.channels,
                callback=self._audio_callback
            )
            self._stream.start()
            self.listening = True
            print(f"{Fore.BLUE}🎤 Écoute active...{Style.RESET_ALL}")
            return True
        except Exception as e:
            print(f"{Fore.RED}❌ Erreur démarrage micro: {e}{Style.RESET_ALL}")
            return False
    
    def stop_listening(self):
        """Arrêter d'écouter"""
        self.listening = False
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except:
                pass
            self._stream = None
        
        # Vider la queue
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except:
                pass
        
        # Reset le recognizer pour la prochaine écoute
        if self.recognizer:
            self.recognizer.Reset()
    
    def get_final_result(self) -> str:
        """Obtenir le résultat final de la reconnaissance"""
        if self.recognizer:
            result = json.loads(self.recognizer.FinalResult())
            return result.get("text", "").strip()
        return ""
    
    def stop(self):
        """Arrêter le service STT"""
        self.stop_listening()
        self.running = False
        self.audio_queue.put(None)  # Signal d'arrêt
        
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        
        self.model = None
        self.recognizer = None
        print(f"{Fore.YELLOW}🎤 STT arrêté{Style.RESET_ALL}")


# Instance globale
_stt_instance: Optional[STTService] = None

def get_stt() -> STTService:
    """Obtenir l'instance STT globale"""
    global _stt_instance
    if _stt_instance is None:
        _stt_instance = STTService()
    return _stt_instance


