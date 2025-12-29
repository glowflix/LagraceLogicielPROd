"""
Text-to-Speech Service (TTS) - Version PIPER NEURAL
====================================================
Synthèse vocale ULTRA NATURELLE en français - 100% OFFLINE

Utilise Piper TTS (moteur neuronal) = voix comme humain réel
Avec pyttsx3 en fallback si Piper non disponible
"""

import threading
import queue
import random
import re
import time
import sys
from datetime import datetime
from typing import Optional
from pathlib import Path

# Colorama pour les couleurs Windows
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    class Fore:
        GREEN = YELLOW = RED = CYAN = MAGENTA = WHITE = BLUE = ""
    class Style:
        RESET_ALL = BRIGHT = ""

# Configuration des chemins
BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models" / "piper"
MODEL_ONNX = MODELS_DIR / "fr_FR-siwis-medium.onnx"
MODEL_JSON = MODELS_DIR / "fr_FR-siwis-medium.onnx.json"

# Import pyttsx3 avec gestion d'erreur (fallback)
try:
    import pyttsx3
    PYTTSX3_AVAILABLE = True
except ImportError:
    PYTTSX3_AVAILABLE = False

# Import Piper TTS
try:
    from piper import PiperVoice
    PIPER_AVAILABLE = True
except ImportError:
    PIPER_AVAILABLE = False

# Import sounddevice pour la lecture audio
try:
    import sounddevice as sd
    import numpy as np
    SOUNDDEVICE_AVAILABLE = True
except ImportError:
    SOUNDDEVICE_AVAILABLE = False

sys.path.insert(0, str(BASE_DIR))
from config.settings import settings, VOICE_RESPONSES


def log_debug(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.WHITE}[{ts}] [TTS] {msg}{Style.RESET_ALL}")


def log_info(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.CYAN}[{ts}] [TTS] {msg}{Style.RESET_ALL}")


def log_success(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.GREEN}[{ts}] [TTS] ✅ {msg}{Style.RESET_ALL}")


def log_warn(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.YELLOW}[{ts}] [TTS] ⚠️  {msg}{Style.RESET_ALL}")


def log_error(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.RED}[{ts}] [TTS] ❌ {msg}{Style.RESET_ALL}")


# ============================================================================
# PROCESSEUR DE TEXTE - OPTIMISATION PRONONCIATION FRANÇAISE
# ============================================================================

class HumanSpeechProcessor:
    """
    Processeur de texte pour optimiser la prononciation française
    Convertit les nombres, corrige les abréviations, etc.
    """
    
    # Corrections de prononciation
    PRONUNCIATION_FIXES = {
        # Abréviations courantes
        r'\bFC\b': 'francs congolais',
        r'\bCDF\b': 'francs congolais',
        r'\bUSD\b': 'dollars américains',
        r'\b\$\b': 'dollars',
        r'\bN°\b': 'numéro',
        r'\bn°\b': 'numéro',
        r'\bKg\b': 'kilogrammes',
        r'\bkg\b': 'kilogrammes',
        r'\bml\b': 'millilitres',
        r'\bL\b(?=\s|$)': 'litres',
        r'\bl\b(?=\s|$)': 'litres',
        r'\bg\b(?=\s|$)': 'grammes',
        
        # Termes techniques
        r'\bPOS\b': 'point de vente',
        r'\bPDF\b': 'P D F',
    }
    
    @classmethod
    def humanize_text(cls, text: str) -> str:
        """Optimiser le texte pour une prononciation naturelle"""
        if not text:
            return text
        
        result = text.strip()
        
        # Appliquer les corrections de prononciation
        for pattern, replacement in cls.PRONUNCIATION_FIXES.items():
            result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
        
        # Convertir les nombres en mots
        result = cls._numbers_to_words(result)
        
        # Nettoyer les espaces multiples
        result = re.sub(r'\s+', ' ', result).strip()
        
        return result
    
    @classmethod
    def _numbers_to_words(cls, text: str) -> str:
        """Convertir les nombres en mots français"""
        
        def convert_number(match):
            num = int(match.group(0))
            
            special = {
                0: 'zéro', 1: 'un', 2: 'deux', 3: 'trois', 4: 'quatre',
                5: 'cinq', 6: 'six', 7: 'sept', 8: 'huit', 9: 'neuf',
                10: 'dix', 11: 'onze', 12: 'douze', 13: 'treize', 14: 'quatorze',
                15: 'quinze', 16: 'seize', 17: 'dix-sept', 18: 'dix-huit', 19: 'dix-neuf',
                20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante',
                60: 'soixante', 70: 'soixante-dix', 80: 'quatre-vingt', 90: 'quatre-vingt-dix',
                100: 'cent', 1000: 'mille'
            }
            
            if num in special:
                return special[num]
            
            # Nombres complexes
            if num >= 1000000:
                millions = num // 1000000
                reste = num % 1000000
                if reste == 0:
                    return f"{millions} millions"
                return f"{millions} millions {reste}"
            
            if num >= 1000:
                milliers = num // 1000
                reste = num % 1000
                if reste == 0:
                    return "mille" if milliers == 1 else f"{milliers} mille"
                return f"{milliers} mille {reste}"
            
            if num >= 100:
                centaines = num // 100
                reste = num % 100
                if reste == 0:
                    return "cent" if centaines == 1 else f"{centaines} cents"
                prefix = "cent" if centaines == 1 else f"{centaines} cent"
                return f"{prefix} {cls._convert_under_100(reste)}"
            
            return cls._convert_under_100(num)
        
        # Remplacer les nombres (max 7 chiffres)
        return re.sub(r'\b\d{1,7}\b', convert_number, text)
    
    @classmethod
    def _convert_under_100(cls, num: int) -> str:
        """Convertir un nombre de 0 à 99"""
        special = {
            0: '', 1: 'un', 2: 'deux', 3: 'trois', 4: 'quatre',
            5: 'cinq', 6: 'six', 7: 'sept', 8: 'huit', 9: 'neuf',
            10: 'dix', 11: 'onze', 12: 'douze', 13: 'treize', 14: 'quatorze',
            15: 'quinze', 16: 'seize', 17: 'dix-sept', 18: 'dix-huit', 19: 'dix-neuf',
            20: 'vingt', 21: 'vingt et un', 30: 'trente', 31: 'trente et un',
            40: 'quarante', 41: 'quarante et un', 50: 'cinquante', 51: 'cinquante et un',
            60: 'soixante', 61: 'soixante et un', 70: 'soixante-dix', 71: 'soixante et onze',
            80: 'quatre-vingts', 81: 'quatre-vingt-un', 90: 'quatre-vingt-dix', 91: 'quatre-vingt-onze'
        }
        
        if num in special:
            return special[num]
        
        if num < 20:
            return str(num)
        
        if num < 70:
            dizaine = (num // 10) * 10
            unite = num % 10
            return f"{special.get(dizaine, str(dizaine))}-{special.get(unite, str(unite))}"
        
        if num < 80:
            return f"soixante-{cls._convert_under_100(num - 60)}"
        
        if num < 100:
            return f"quatre-vingt-{special.get(num - 80, str(num - 80))}"
        
        return str(num)


# ============================================================================
# MOTEUR PIPER TTS - VOIX NEURONALE ULTRA NATURELLE
# ============================================================================

class PiperTTSEngine:
    """
    Moteur Piper TTS - Synthèse vocale neuronale
    Voix française TRÈS naturelle (comme humain réel)
    100% OFFLINE
    """
    
    def __init__(self):
        self.voice = None
        self.available = False
        self.sample_rate = 22050
        self._init_piper()
    
    def _init_piper(self):
        """Initialiser Piper TTS"""
        if not PIPER_AVAILABLE:
            log_warn("Piper TTS non installé - pip install piper-tts")
            return
        
        if not SOUNDDEVICE_AVAILABLE:
            log_warn("sounddevice non installé - pip install sounddevice")
            return
        
        if not MODEL_ONNX.exists():
            log_warn(f"Modèle Piper non trouvé: {MODEL_ONNX}")
            log_info("Téléchargez le modèle français depuis:")
            log_info("https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/fr/fr_FR/siwis/medium")
            return
        
        try:
            log_debug(f"Chargement du modèle Piper: {MODEL_ONNX.name}")
            
            config_path = str(MODEL_JSON) if MODEL_JSON.exists() else None
            self.voice = PiperVoice.load(str(MODEL_ONNX), config_path=config_path)
            
            self.sample_rate = self.voice.config.sample_rate
            self.available = True
            
            log_success(f"Piper TTS chargé! Voix: fr_FR-siwis-medium ({self.sample_rate} Hz)")
            
        except Exception as e:
            log_error(f"Erreur chargement Piper: {e}")
    
    def synthesize(self, text: str) -> Optional[bytes]:
        """Synthétiser le texte en audio"""
        if not self.available or not self.voice:
            return None
        
        try:
            audio_data = b''
            for audio_chunk in self.voice.synthesize(text):
                audio_data += audio_chunk.audio_int16_bytes
            return audio_data
        except Exception as e:
            log_error(f"Erreur synthèse Piper: {e}")
            return None
    
    def speak(self, text: str):
        """Synthétiser et jouer l'audio"""
        audio_data = self.synthesize(text)
        
        if audio_data and SOUNDDEVICE_AVAILABLE:
            try:
                audio_array = np.frombuffer(audio_data, dtype=np.int16)
                sd.play(audio_array, samplerate=self.sample_rate)
                sd.wait()
            except Exception as e:
                log_error(f"Erreur lecture audio: {e}")


# ============================================================================
# MOTEUR PYTTSX3 - FALLBACK
# ============================================================================

class Pyttsx3Engine:
    """Moteur pyttsx3 (fallback si Piper non disponible)"""
    
    def __init__(self):
        self.engine = None
        self.available = PYTTSX3_AVAILABLE
    
    def init(self) -> bool:
        """Initialiser le moteur"""
        if not self.available:
            log_warn("pyttsx3 non disponible")
            return False
        
        try:
            self.engine = pyttsx3.init()
            self.engine.setProperty('rate', 160)
            self.engine.setProperty('volume', 0.95)
            
            # Chercher voix française
            voices = self.engine.getProperty('voices')
            for voice in voices:
                if 'french' in voice.name.lower() or 'fr' in voice.id.lower():
                    self.engine.setProperty('voice', voice.id)
                    log_info(f"Voix pyttsx3: {voice.name}")
                    break
            
            return True
            
        except Exception as e:
            log_error(f"Erreur init pyttsx3: {e}")
            return False
    
    def speak(self, text: str):
        """Parler avec pyttsx3"""
        if self.engine:
            try:
                self.engine.say(text)
                self.engine.runAndWait()
            except Exception as e:
                log_error(f"Erreur pyttsx3: {e}")
    
    def stop(self):
        """Arrêter le moteur"""
        if self.engine:
            try:
                self.engine.stop()
            except:
                pass


# ============================================================================
# SERVICE TTS PRINCIPAL - HYBRIDE PIPER + PYTTSX3
# ============================================================================

class TTSService:
    """
    Service TTS Principal - Voix Neuronale Ultra Naturelle
    
    Priorité:
    1. Piper TTS (voix neuronale naturelle) 
    2. pyttsx3 (fallback, voix système)
    """
    
    def __init__(self):
        self.speech_queue = queue.Queue()
        self.is_speaking = False
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._speech_count = 0
        
        # Moteurs TTS
        self.piper: Optional[PiperTTSEngine] = None
        self.pyttsx3: Optional[Pyttsx3Engine] = None
        self.using_piper = False
        
        # Processeur de texte
        self._humanizer = HumanSpeechProcessor()
        
        log_debug("TTSService initialisé")
    
    def start(self) -> bool:
        """Démarrer le service TTS"""
        log_info("=" * 50)
        log_info("🎤 DÉMARRAGE TTS - VOIX NEURONALE NATURELLE")
        log_info("=" * 50)
        
        # Essayer Piper TTS d'abord (voix naturelle)
        log_debug("Initialisation Piper TTS (voix neuronale)...")
        self.piper = PiperTTSEngine()
        
        if self.piper.available:
            self.using_piper = True
            log_success("🌟 Piper TTS activé - Voix française ultra naturelle!")
        else:
            # Fallback vers pyttsx3
            log_debug("Piper non disponible, initialisation pyttsx3...")
            self.pyttsx3 = Pyttsx3Engine()
            if not self.pyttsx3.init():
                log_error("Aucun moteur TTS disponible!")
                return False
            log_success("pyttsx3 activé (fallback - voix moins naturelle)")
        
        # Démarrer thread de parole
        self.running = True
        self._thread = threading.Thread(target=self._speech_loop, daemon=True, name="TTS-Neural")
        self._thread.start()
        log_debug(f"Thread de parole démarré: {self._thread.name}")
        
        # Afficher le résumé
        if self.using_piper:
            log_success("🎯 Mode: PIPER NEURAL - Voix française ultra naturelle")
            log_info("   Modèle: fr_FR-siwis-medium (voix féminine)")
        else:
            log_info("🎯 Mode: PYTTSX3 - Voix système Windows")
            log_info("💡 Pour voix naturelle: voir README pour installer Piper")
        
        return True
    
    def _speech_loop(self):
        """Boucle principale de parole"""
        log_debug("Boucle de parole démarrée")
        
        while self.running:
            try:
                text = self.speech_queue.get(timeout=0.5)
                if text is None:
                    break
                
                self._speech_count += 1
                self._speak_internal(text)
                self.speech_queue.task_done()
                
            except queue.Empty:
                continue
            except Exception as e:
                log_error(f"Erreur boucle parole: {e}")
        
        log_debug("Boucle de parole terminée")
    
    def _speak_internal(self, text: str):
        """Parler avec le moteur approprié"""
        # Optimiser le texte pour la prononciation
        processed_text = self._humanizer.humanize_text(text)
        
        with self._lock:
            self.is_speaking = True
            try:
                if self.using_piper and self.piper:
                    self.piper.speak(processed_text)
                elif self.pyttsx3:
                    self.pyttsx3.speak(processed_text)
            except Exception as e:
                log_error(f"Erreur parole: {e}")
            finally:
                self.is_speaking = False
    
    def speak(self, text: str, priority: bool = False):
        """Ajouter du texte à la queue de parole"""
        if not self.running:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"{Fore.YELLOW}[{ts}] [TTS OFF] {text}{Style.RESET_ALL}")
            return
        
        # Log visible
        ts = datetime.now().strftime("%H:%M:%S")
        engine_name = "PIPER" if self.using_piper else "SAPI5"
        print(f"{Fore.MAGENTA}[{ts}] 🔊 [{engine_name}] LaGrace: {text}{Style.RESET_ALL}")
        
        if priority:
            # Vider la queue pour la priorité
            while not self.speech_queue.empty():
                try:
                    self.speech_queue.get_nowait()
                except:
                    pass
        
        self.speech_queue.put(text)
    
    def speak_response(self, response_type: str, **kwargs):
        """Parler une réponse prédéfinie aléatoire"""
        responses = VOICE_RESPONSES.get(
            response_type, 
            VOICE_RESPONSES.get("not_understood", ["Désolé, je n'ai pas compris."])
        )
        text = random.choice(responses)
        
        # Remplacer les placeholders
        if kwargs:
            for key, value in kwargs.items():
                text = text.replace(f"{{{key}}}", str(value))
        
        self.speak(text)
    
    def stop_speaking(self):
        """Arrêter de parler immédiatement"""
        if self.is_speaking:
            if SOUNDDEVICE_AVAILABLE:
                try:
                    sd.stop()
                except:
                    pass
            if self.pyttsx3 and self.pyttsx3.engine:
                try:
                    self.pyttsx3.engine.stop()
                except:
                    pass
    
    def wait_until_done(self):
        """Attendre que toute la parole soit terminée"""
        self.speech_queue.join()
    
    def get_status(self) -> dict:
        """Obtenir le statut du TTS"""
        return {
            'running': self.running,
            'is_speaking': self.is_speaking,
            'queue_size': self.speech_queue.qsize(),
            'speech_count': self._speech_count,
            'engine': 'piper' if self.using_piper else 'pyttsx3',
            'piper_available': self.piper.available if self.piper else False
        }
    
    def stop(self):
        """Arrêter le service TTS"""
        log_info("Arrêt du service TTS...")
        
        self.running = False
        self.speech_queue.put(None)
        
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        
        if self.pyttsx3:
            self.pyttsx3.stop()
        
        log_success(f"TTS arrêté (total paroles: {self._speech_count})")


# Instance globale
_tts_instance: Optional[TTSService] = None


def get_tts() -> TTSService:
    """Obtenir l'instance TTS globale"""
    global _tts_instance
    if _tts_instance is None:
        _tts_instance = TTSService()
    return _tts_instance
