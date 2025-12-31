"""
Text-to-Speech Service (TTS) - NATURAL PRO v5
==============================================
Traitement audio optimisé pour UPMC - référence chaleureuse et professionnelle
Style Microsoft Edge avec modèle UPMC prioritaire - 100% OFFLINE

Améliorations v5:
✅ Prononciation française naturelle (corrections discrètes)
✅ Audio propre sans exagération (traitement minimal)
✅ Voix UPMC chaleureuse et professionnelle (votre référence)
✅ Égalisation légère optimisée pour UPMC
✅ Compression minimale préservant la dynamique
✅ Normalisation douce (niveau naturel)
✅ Fade subtil et équilibré
✅ 100% OFFLINE
"""

import threading
import queue
import random
import re
import time
import sys
import base64
import io
from datetime import datetime
from typing import Optional, List, Tuple
from pathlib import Path

# Colorama
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    class Fore:
        GREEN = YELLOW = RED = CYAN = MAGENTA = WHITE = BLUE = ""
    class Style:
        RESET_ALL = BRIGHT = ""

# Configuration
BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models" / "piper"

# Modèles Piper - UPMC en priorité (référence utilisateur)
PIPER_MODELS = [
    ("fr_FR-upmc-medium", "UPMC"),  # Référence chaleureuse et professionnelle
    ("fr_FR-siwis-medium", "SIWIS"),
]

# Imports
try:
    from piper import PiperVoice
    PIPER_AVAILABLE = True
except ImportError:
    PIPER_AVAILABLE = False

try:
    import pyttsx3
    PYTTSX3_AVAILABLE = True
except ImportError:
    PYTTSX3_AVAILABLE = False

try:
    import sounddevice as sd
    import numpy as np
    SOUNDDEVICE_AVAILABLE = True
except ImportError:
    SOUNDDEVICE_AVAILABLE = False

try:
    from scipy import signal
    from scipy.ndimage import uniform_filter1d
    import soundfile as sf
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    sf = None

sys.path.insert(0, str(BASE_DIR))
from config.settings import VOICE_RESPONSES


def log_info(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Fore.CYAN}[{ts}] [TTS] {msg}{Style.RESET_ALL}")

def log_success(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Fore.GREEN}[{ts}] [TTS] ✅ {msg}{Style.RESET_ALL}")

def log_warn(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Fore.YELLOW}[{ts}] [TTS] ⚠️  {msg}{Style.RESET_ALL}")

def log_error(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Fore.RED}[{ts}] [TTS] ❌ {msg}{Style.RESET_ALL}")


def get_best_audio_device():
    """Obtenir le meilleur device audio disponible"""
    if not SOUNDDEVICE_AVAILABLE:
        return None
    
    try:
        # sd.default.device retourne un _InputOutputPair (tuple-like)
        # Accéder à l'index [1] pour le device output
        default_device = -1
        try:
            default_obj = sd.default.device
            # _InputOutputPair peut être accédé par index
            if default_obj is not None:
                # Essayer accès par index [1] (output device)
                try:
                    default_device = int(default_obj[1])
                except:
                    # Fallback: essayer index [0]
                    try:
                        default_device = int(default_obj[0])
                    except:
                        default_device = -1
        except Exception as e:
            log_warn(f"   ⚠️ Erreur lecture default_device: {e}")
        
        # Essayer le device par défaut d'abord
        if default_device >= 0:
            try:
                device_info = sd.query_devices(default_device)
                if device_info['max_output_channels'] > 0:
                    dev_name = device_info.get('name', f'Device {default_device}')
                    log_info(f"   ✓ Device par défaut OK: {dev_name}")
                    return default_device
            except Exception as e:
                log_warn(f"   ⚠️ Device défaut (ID={default_device}) erreur: {e}")
        
        # Si device par défaut ne fonctionne pas, chercher le meilleur
        log_info(f"   🔍 Énumération des devices disponibles...")
        try:
            devices = sd.query_devices()
        except Exception as e:
            log_error(f"   ❌ query_devices erreur: {e}")
            return None
        
        if not isinstance(devices, list):
            log_warn(f"   ⚠️ query_devices retourné non-list: {type(devices)}")
            return None
        
        log_info(f"   📊 {len(devices)} device(s) trouvé(s)")
        for idx, device in enumerate(devices):
            channels = device.get('max_output_channels', 0)
            dev_name = device.get('name', f'Device {idx}')
            if channels > 0:
                log_info(f"   ✓ [{idx}] {dev_name} ({channels} ch. output)")
                return idx
        
        log_error(f"   ❌ Aucun device audio avec output channels trouvé")
        return None
        
    except Exception as e:
        log_error(f"   ❌ Erreur get_best_audio_device: {e}")
        import traceback
        traceback.print_exc()
        return None


# ============================================================================
# UTILITAIRES AUDIO
# ============================================================================

def audio_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    """Convertir numpy array en WAV bytes"""
    try:
        if sf is None:
            log_warn("soundfile non disponible - fallback WAV simple")
            # Fallback: WAV simple sans scipy
            import struct
            wav_buffer = io.BytesIO()
            
            # WAV header
            num_samples = len(audio)
            num_channels = 1
            
            # Header
            wav_buffer.write(b'RIFF')
            wav_buffer.write(struct.pack('<I', 36 + num_samples * 2))  # File size - 8
            wav_buffer.write(b'WAVE')
            
            # Format subchunk
            wav_buffer.write(b'fmt ')
            wav_buffer.write(struct.pack('<I', 16))  # Subchunk1Size
            wav_buffer.write(struct.pack('<H', 1))   # AudioFormat (PCM)
            wav_buffer.write(struct.pack('<H', num_channels))
            wav_buffer.write(struct.pack('<I', sample_rate))
            wav_buffer.write(struct.pack('<I', sample_rate * num_channels * 2))  # ByteRate
            wav_buffer.write(struct.pack('<H', num_channels * 2))  # BlockAlign
            wav_buffer.write(struct.pack('<H', 16))  # BitsPerSample
            
            # Data subchunk
            wav_buffer.write(b'data')
            wav_buffer.write(struct.pack('<I', num_samples * 2))
            wav_buffer.write(audio.astype(np.int16).tobytes())
            
            return wav_buffer.getvalue()
        else:
            # Utiliser soundfile
            wav_buffer = io.BytesIO()
            sf.write(wav_buffer, audio, sample_rate, format='WAV')
            return wav_buffer.getvalue()
    except Exception as e:
        log_error(f"Erreur conversion WAV: {e}")
        return b''


# ============================================================================
# PROCESSEUR AUDIO ULTRA PRO (SANS BRUIT - VERSION AMÉLIORÉE)
# ============================================================================

class CleanAudioProcessor:
    """Processeur audio naturel - Traitement subtil pour voix professionnelle"""
    
    def __init__(self, sample_rate: int = 22050):
        self.sample_rate = sample_rate
        self.enabled = SCIPY_AVAILABLE
    
    def process(self, audio: np.ndarray) -> np.ndarray:
        """Traitement subtil pour qualité naturelle (style Microsoft Edge)"""
        if not self.enabled or len(audio) == 0:
            return audio
        
        # Convertir en float
        audio_f = audio.astype(np.float32) / 32768.0
        
        # 1. Nettoyage subtil du bruit
        audio_f = self._gentle_noise_reduction(audio_f)
        
        # 2. Anti-sibilance léger
        audio_f = self._subtle_de_essing(audio_f)
        
        # 3. Égalisation naturelle discrète
        audio_f = self._natural_voice_eq(audio_f)
        
        # 4. Compression légère
        audio_f = self._light_compression(audio_f)
        
        # 5. Normalisation douce
        audio_f = self._gentle_normalize(audio_f, 0.85)
        
        # 6. Fade subtil
        audio_f = self._subtle_fade(audio_f)
        
        # Reconvertir
        audio_f = np.clip(audio_f, -1.0, 1.0)
        return (audio_f * 32767).astype(np.int16)
        
        # 3. Égalisation vocale optimisée
        audio_f = self._voice_eq(audio_f)
        
        # 4. Compression adaptative douce
        audio_f = self._adaptive_compression(audio_f)
        
        # 5. Normalisation intelligente
        audio_f = self._intelligent_normalize(audio_f, 0.92)
        
        # 6. Fade subtil
        audio_f = self._subtle_fade(audio_f)
        
        # Reconvertir
        audio_f = np.clip(audio_f, -1.0, 1.0)
        return (audio_f * 32767).astype(np.int16)
    
    def _gentle_noise_reduction(self, audio: np.ndarray) -> np.ndarray:
        """Réduction de bruit douce et naturelle"""
        try:
            # Filtre passe-haut léger (80 Hz seulement)
            nyquist = self.sample_rate / 2
            cutoff = 80 / nyquist
            if cutoff < 1.0:
                b, a = signal.butter(3, cutoff, btype='high')
                audio = signal.filtfilt(b, a, audio)
            
            # Filtre passe-bas doux (10 kHz pour garder les harmoniques)
            cutoff_high = 10000 / nyquist
            if cutoff_high < 1.0:
                b, a = signal.butter(2, cutoff_high, btype='low')
                audio = signal.filtfilt(b, a, audio)
            
            # Porte de bruit très légère
            audio = self._light_noise_gate(audio)
            
            return audio
        except:
            return audio
    
    def _light_noise_gate(self, audio: np.ndarray) -> np.ndarray:
        """Porte de bruit très légère pour naturel"""
        try:
            # Seulement pour les bruits très forts
            noise_threshold = np.std(audio) * 3.0  # Plus permissif
            
            # Lissage très doux
            mask = np.abs(audio) > noise_threshold
            mask_smooth = uniform_filter1d(mask.astype(float), size=int(self.sample_rate * 0.02))
            
            # Application douce
            return audio * (0.95 + 0.05 * mask_smooth)  # Réduction maximale de 5%
        except:
            return audio
    
    def _subtle_de_essing(self, audio: np.ndarray) -> np.ndarray:
        """Anti-sibilance très léger pour naturel"""
        try:
            nyquist = self.sample_rate / 2
            # Cible les fréquences de sibilance (4-8 kHz)
            low = 4000 / nyquist
            high = min(8000 / nyquist, 0.95)
            if low < high:
                b, a = signal.butter(2, [low, high], btype='band')
                sibilance = signal.filtfilt(b, a, audio)
                
                # Seulement les sibilances très fortes (95e percentile)
                threshold = np.percentile(np.abs(sibilance), 97)  # Plus permissif
                mask = np.abs(sibilance) > threshold
                sibilance[mask] = np.sign(sibilance[mask]) * threshold * 0.85  # Réduction de 15% seulement
                
                # Remettre dans l'audio
                audio = audio - sibilance + signal.filtfilt(b, a, sibilance)
            return audio
        except:
            return audio
    
    def _natural_voice_eq(self, audio: np.ndarray) -> np.ndarray:
        """Égalisation naturelle optimisée pour UPMC (référence)"""
        try:
            nyquist = self.sample_rate / 2
            
            # Boost très léger des fréquences vocales (300-800 Hz) - 3% seulement
            low = 300 / nyquist
            high = 800 / nyquist
            if low < high:
                b, a = signal.butter(2, [low, high], btype='band')
                mids = signal.filtfilt(b, a, audio)
                audio = audio + mids * 0.03  # Boost de 3% seulement
            
            # Boost minimal des harmoniques (2-4 kHz) pour clarté - 2% seulement
            low = 2000 / nyquist
            high = min(4000 / nyquist, 0.95)
            if low < high:
                b, a = signal.butter(2, [low, high], btype='band')
                highs = signal.filtfilt(b, a, audio)
                audio = audio + highs * 0.02  # Boost de 2% seulement
            
            return audio
        except:
            return audio
    
    def _light_compression(self, audio: np.ndarray) -> np.ndarray:
        """Compression minimale pour préserver la dynamique naturelle d'UPMC"""
        try:
            # Seulement pour les pics très très forts
            threshold = 0.8  # Plus haut (0.8 au lieu de 0.7)
            ratio = 1.2      # Ratio plus doux (1.2 au lieu de 1.5)
            
            mask = np.abs(audio) > threshold
            result = audio.copy()
            result[mask] = np.sign(audio[mask]) * (
                threshold + (np.abs(audio[mask]) - threshold) / ratio
            )
            return result
        except:
            return audio
    
    def _gentle_normalize(self, audio: np.ndarray, target: float = 0.80) -> np.ndarray:
        """Normalisation douce pour niveau naturel comme UPMC"""
        try:
            # Normalisation peak plus douce pour préserver la dynamique
            max_val = np.max(np.abs(audio))
            if max_val > 0:
                # Laisser plus de headroom (80% au lieu de 85%)
                return audio * (target / max_val)
            return audio
        except:
            return audio
    
    def _subtle_fade(self, audio: np.ndarray) -> np.ndarray:
        """Fade subtil pour naturel - adapté aux segments courts"""
        try:
            # Durée de fade proportionnelle à la longueur (max 8% du signal)
            fade_len = min(int(len(audio) * 0.08), 300)  # Max 300 échantillons
            fade_len = max(fade_len, 50)  # Minimum 50 échantillons pour les courts segments
            
            if fade_len > 15 and len(audio) > fade_len * 2:
                # Fade plus doux pour les segments courts
                fade_in = np.linspace(0, 1, fade_len)
                fade_out = np.linspace(1, 0, fade_len)
                
                audio[:fade_len] *= fade_in
                audio[-fade_len:] *= fade_out
            return audio
        except:
            return audio


# ============================================================================
# PROCESSEUR DE PRONONCIATION FRANÇAISE v2
# ============================================================================

class FrenchPronunciationV5:
    """
    Correcteur de prononciation française naturel v5
    Optimisé pour UPMC - corrections minimales pour naturel maximal
    """
    
    # Corrections phonétiques pour Piper - VERSION ULTRA
    # Format: (pattern, remplacement)
    PHONETIC_FIXES = [
        # Terminaisons en -ée/-é (souvent mal prononcées)
        (r'\bfinalis[ée]+e?\b', 'finalizé'),
        (r'\bfinaliz[ée]+e?\b', 'finalizé'),
        (r'\bcr[ée]+[ée]?\b', 'créé'),
        (r'\btermin[ée]+e?\b', 'terminé'),
        (r'\bvalid[ée]+e?\b', 'validé'),
        (r'\bconfirm[ée]+e?\b', 'confirmé'),
        (r'\bimprim[ée]+e?\b', 'imprimé'),
        (r'\benregistr[ée]+e?\b', 'enregistré'),
        (r'\beffectu[ée]+e?\b', 'effectué'),
        (r'\bréalis[ée]+e?\b', 'réalizé'),
        (r'\blancé+e?\b', 'lancé'),
        (r'\bsupprim[ée]+e?\b', 'supprimé'),
        (r'\bcharg[ée]+e?\b', 'chargé'),
        (r'\bconfigur[ée]+e?\b', 'configuré'),
        (r'\bsynchronis[ée]+e?\b', 'synchronizé'),
        
        # Mots difficiles pour Piper - corrections subtiles
        (r'\bexcellente?\b', 'excellente'),  # Plus naturel
        (r'\bbienvenue?\b', 'bienvenue'),   # Plus naturel
        (r'\bmerci beaucoup\b', 'merci beaucoup'),  # Garder naturel
        (r'\baujourd\'?hui\b', 'aujourd\'hui'),  # Plus naturel
        (r'\bs\'il vous pla[iî]t\b', 's\'il vous plaît'),  # Plus naturel
        (r'\bLaGrace\b', 'La Grâce'),  # Correction nécessaire
        (r'\bassistante?\b', 'assistante'),  # Naturel
        (r'\bintelligente?\b', 'intelligente'),  # Naturel
        (r'\bsystème\b', 'système'),  # Naturel
        (r'\bopérationnel\b', 'opérationnel'),  # Naturel
        
        # Nombres et mesures
        (r'\bFC\b', 'francs congolais'),
        (r'\bCDF\b', 'francs congolais'),
        (r'\bUSD\b', 'dolars américains'),
        (r'\bEUR\b', 'euros'),
        (r'\bN°\s*', 'numéro '),
        (r'\bn°\s*', 'numéro '),
        (r'\bkg\b', 'kilogrammes'),
        (r'\bml\b', 'millilitres'),
        (r'\bcl\b', 'centilitres'),
        (r'\bcm\b', 'centimètres'),
        (r'\bmm\b', 'millimètres'),
        (r'\bkm\b', 'kilomètres'),
        (r'\bkm/h\b', 'kilomètres par heure'),
        (r'\b%\b', ' pour cent'),
        (r'\b°\b', ' degrés'),
        
        # Termes techniques courants - corrections légères
        (r'\bPOS\b', 'point de vente'),
        (r'\bstock\b', 'stock'),  # Plus naturel
        (r'\binventaire\b', 'inventaire'),  # Plus naturel
        (r'\bcommande\b', 'commande'),  # Naturel
        (r'\bfournisseur\b', 'fournisseur'),  # Naturel
        (r'\bclient\b', 'client'),  # Plus naturel que "cliàn"
        (r'\bclientèle\b', 'clientèle'),  # Plus naturel
        (r'\btransaction\b', 'transaction'),  # Naturel
        (r'\bfacture\b', 'facture'),  # Naturel
        (r'\breçu\b', 'reçu'),  # Naturel
        (r'\bticket\b', 'ticket'),  # Naturel
        (r'\bimpression\b', 'impression'),  # Naturel
        (r'\bconnexion\b', 'connexion'),  # Naturel
        (r'\bsynchronisation\b', 'synchronisation'),  # Naturel
        
        # Jours et périodes
        (r'\blundi\b', 'lundi'),
        (r'\bmardi\b', 'mardi'),
        (r'\bmercredi\b', 'mercredi'),
        (r'\bjeudi\b', 'jeudi'),
        (r'\bvendredi\b', 'vendredi'),
        (r'\bsamedi\b', 'samedi'),
        (r'\bdimanche\b', 'dimanche'),
        (r'\bhier\b', 'ièr'),
        (r'\bdemain\b', 'demain'),
        (r'\bce matin\b', 'ce matin'),
        (r'\bce soir\b', 'ce soir'),
        (r'\bcette nuit\b', 'cette nuit'),
        (r'\bcette semaine\b', 'cette semaine'),
        (r'\bce mois\b', 'ce mois'),
        (r'\bcette année\b', 'cette année'),
        
        # Expressions courantes - corrections minimales
        (r'\bs\'il vous pla[iî]t\b', 's\'il vous plaît'),  # Plus naturel
        (r'\bje vous en prie\b', 'je vous en prie'),  # Naturel
        (r'\bde rien\b', 'de rien'),  # Naturel
        (r'\bil n\'?y a pas de quoi\b', 'il n\'y a pas de quoi'),  # Naturel
        (r'\bavec plaisir\b', 'avec plaisir'),  # Naturel
        (r'\btout de suite\b', 'tout de suite'),  # Naturel
        (r'\bimmédiatement\b', 'immédiatement'),  # Naturel
        (r'\binstantanément\b', 'instantanément'),  # Naturel
        (r'\brapidement\b', 'rapidement'),  # Naturel
        
        # Dates
        (r'(\d{1,2})/(\d{1,2})/(\d{4})', r'\1 \2 \3'),
        
        # Nettoyage final
        (r'\s+', ' '),
    ]
    
    # Nombres en français
    NUMBERS = {
        0: 'zéro', 1: 'un', 2: 'deux', 3: 'trois', 4: 'quatre',
        5: 'cinq', 6: 'six', 7: 'sept', 8: 'huit', 9: 'neuf',
        10: 'dix', 11: 'onze', 12: 'douze', 13: 'treize', 14: 'quatorze',
        15: 'quinze', 16: 'seize', 17: 'dix-sept', 18: 'dix-huit', 19: 'dix-neuf',
        20: 'vingt', 21: 'vingt et un', 30: 'trente', 40: 'quarante',
        50: 'cinquante', 60: 'soixante', 70: 'soixante-dix',
        80: 'quatre-vingts', 90: 'quatre-vingt-dix', 100: 'cent', 1000: 'mille'
    }
    
    # Pauses naturelles (en ms) - optimisées pour professionnel
    PAUSES = {
        '.': (350, 100),  # Plus de pause pour les fins de phrase
        '!': (500, 120),  # Pause plus longue pour les salutations (Bonjour!)
        '?': (380, 100),  # Légèrement plus long pour les questions
        '...': (550, 150), # Plus de pause pour les suspensions
        ',': (160, 50),   # Pause légèrement plus longue pour la respiration
        ';': (240, 70),   # Plus de pause pour les semi-points
        ':': (220, 60),   # Plus de pause pour les deux-points
    }
    
    @classmethod
    def process(cls, text: str) -> str:
        """Traiter le texte pour une prononciation correcte"""
        if not text:
            return text
        
        result = text.strip()
        
        # Appliquer les corrections phonétiques
        for pattern, replacement in cls.PHONETIC_FIXES:
            result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
        
        # Convertir les nombres
        result = cls._convert_numbers(result)
        
        # Nettoyer
        result = re.sub(r'\s+', ' ', result).strip()
        
        return result
    
    @classmethod
    def get_pause(cls, punct: str) -> int:
        """Obtenir une pause variée"""
        if punct in cls.PAUSES:
            base, var = cls.PAUSES[punct]
            return base + random.randint(-var, var)
        return 80
    
    @classmethod
    def split_sentences(cls, text: str) -> List[Tuple[str, int]]:
        """Diviser en phrases avec pauses - optimisé pour professionnel"""
        processed = cls.process(text)
        segments = []
        
        # Pattern pour capturer texte + ponctuation
        pattern = r'([^.!?,;:]+)([.!?,;:]+|\.\.\.)?'
        
        for match in re.finditer(pattern, processed):
            txt = match.group(1).strip()
            punct = (match.group(2) or '').strip()
            
            if txt:
                pause = cls.get_pause(punct) if punct else 60
                
                # Bonus de pause pour les salutations courtes (professionnel)
                if punct in ['!', '?'] and len(txt.split()) <= 3:
                    # Salutations courtes comme "Bonjour!", "Au revoir!", "Merci!"
                    pause += 200  # Pause supplémentaire de 200ms
                
                segments.append((txt + punct, pause))
        
        return segments
    
    @classmethod
    def _convert_numbers(cls, text: str) -> str:
        """Convertir nombres en mots avec rythme naturel"""
        def to_words(match):
            try:
                num = int(match.group(0))
                words = cls._num_to_words(num)
                # Ajouter virgule pour les grands nombres (pause naturelle)
                if num >= 1000:
                    words = words.replace(' mille ', ' mille, ')
                if num >= 1000000:
                    words = words.replace(' million ', ' million, ')
                return words
            except:
                return match.group(0)
        
        return re.sub(r'\b\d{1,9}\b', to_words, text)
    
    @classmethod
    def _num_to_words(cls, n: int) -> str:
        if n in cls.NUMBERS:
            return cls.NUMBERS[n]
        
        if n >= 1000000:
            m, r = n // 1000000, n % 1000000
            p = "un million" if m == 1 else f"{cls._num_to_words(m)} millions"
            return p if r == 0 else f"{p} {cls._num_to_words(r)}"
        
        if n >= 1000:
            m, r = n // 1000, n % 1000
            p = "mille" if m == 1 else f"{cls._num_to_words(m)} mille"
            return p if r == 0 else f"{p} {cls._num_to_words(r)}"
        
        if n >= 100:
            c, r = n // 100, n % 100
            p = "cent" if c == 1 else f"{cls._num_to_words(c)} cent"
            if r == 0:
                return p if c == 1 else f"{cls._num_to_words(c)} cents"
            return f"{p} {cls._num_to_words(r)}"
        
        if n >= 20:
            if n < 70:
                d, u = (n // 10) * 10, n % 10
                if u == 0:
                    return cls.NUMBERS.get(d, str(n))
                if u == 1 and d in [20, 30, 40, 50, 60]:
                    return f"{cls.NUMBERS[d]} et un"
                return f"{cls.NUMBERS.get(d, str(d))}-{cls.NUMBERS.get(u, str(u))}"
            if n < 80:
                return f"soixante-{cls._num_to_words(n - 60)}"
            r = n - 80
            return "quatre-vingts" if r == 0 else f"quatre-vingt-{cls._num_to_words(r)}"
        
        return str(n)


# ============================================================================
# MOTEUR PIPER ULTRA PRO v2
# ============================================================================

class PiperNaturalProV5:
    """
    Piper TTS Natural Pro v5
    - Modèle UPMC prioritaire (référence chaleureuse)
    - Traitement audio minimal pour naturel maximal
    - Optimisé d'après analyse du fichier compare_upmc.wav
    - Style professionnel et humain
    """
    
    def __init__(self):
        self.voice = None
        self.available = False
        self.sample_rate = 22050
        self.model_name = ""
        self.audio_proc: Optional[CleanAudioProcessor] = None
        # ✅ Socket désactivé - TTS joue SEULEMENT via sounddevice (pas de doublon)
        self._init()
    
    def _init(self):
        log_info(f"🔍 Vérification dépendances TTS:")
        log_info(f"   • PIPER_AVAILABLE: {PIPER_AVAILABLE}")
        log_info(f"   • SOUNDDEVICE_AVAILABLE: {SOUNDDEVICE_AVAILABLE}")
        log_info(f"   • SCIPY_AVAILABLE: {SCIPY_AVAILABLE}")
        
        # Debug sounddevice au démarrage
        if SOUNDDEVICE_AVAILABLE:
            try:
                devices = sd.query_devices()
                device_count = len(devices) if isinstance(devices, list) else "N/A"
                log_info(f"   📊 Sounddevice: {device_count} device(s) détecté(s)")
                
                default_idx = sd.default.device
                if isinstance(default_idx, tuple):
                    default_idx = default_idx[1]  # Output device
                    
                log_info(f"   📊 Device output par défaut: ID={default_idx}")
                
                # ✅ FIX: Vérifier que default_idx est bien un entier avant de comparer
                if isinstance(default_idx, int) and default_idx is not None and default_idx >= 0:
                    try:
                        device_info = sd.query_devices(default_idx)
                        log_info(f"   📊 Device name: {device_info.get('name', 'Unknown')}")
                    except Exception as e:
                        log_warn(f"   ⚠️ Erreur device_info: {e}")
            except Exception as e:
                log_error(f"❌ Sounddevice ERROR au démarrage: {e}")
                import traceback
                traceback.print_exc()
        
        if not PIPER_AVAILABLE or not SOUNDDEVICE_AVAILABLE:
            log_error("❌ Piper ou sounddevice non disponible")
            return
        
        # Charger le meilleur modèle
        log_info(f"🔎 Recherche modèles Piper dans: {MODELS_DIR}")
        for model_name, desc in PIPER_MODELS:
            model_path = MODELS_DIR / f"{model_name}.onnx"
            log_info(f"   🔹 Vérification {model_name}: {model_path}")
            if model_path.exists():
                try:
                    log_info(f"      ✓ Fichier trouvé - Chargement...")
                    config_path = MODELS_DIR / f"{model_name}.onnx.json"
                    self.voice = PiperVoice.load(
                        str(model_path),
                        config_path=str(config_path) if config_path.exists() else None
                    )
                    self.sample_rate = self.voice.config.sample_rate
                    self.model_name = model_name
                    self.available = True
                    self.audio_proc = CleanAudioProcessor(self.sample_rate)
                    log_success(f"✅ Piper NATURAL PRO v5: {desc} (Sample Rate: {self.sample_rate})")
                    log_info(f"   📊 Modèle: {model_name}")
                    log_info(f"   🔊 Audio processeur activé")
                    return
                except Exception as e:
                    log_warn(f"❌ Erreur {model_name}: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                log_warn(f"      ✗ Fichier non trouvé")
        
        log_error("❌ Aucun modèle Piper disponible - TTS désactivé")
    
    def create_silence(self, duration_ms: int) -> np.ndarray:
        """Créer du silence propre (pas de bruit)"""
        num_samples = int(self.sample_rate * duration_ms / 1000)
        return np.zeros(num_samples, dtype=np.int16)
    
    def synthesize_segment(self, text: str) -> Optional[np.ndarray]:
        """Synthétiser un segment de texte - vitesse normale, accélération pour factures"""
        if not self.available or not text.strip():
            return None
        
        try:
            audio_bytes = b''
            for chunk in self.voice.synthesize(text):
                audio_bytes += chunk.audio_int16_bytes
            
            if not audio_bytes:
                return None
            
            audio = np.frombuffer(audio_bytes, dtype=np.int16)
            
            # ✅ AMÉLIORATION: Accélérer SEULEMENT quand on annonce les numéros de facture
            is_invoice_text = (
                'facture' in text.lower() and any(char.isdigit() for char in text)
            )
            
            if is_invoice_text:
                # Accélérer les annonces de facture (8% plus rapide pour clarté rapide)
                log_info(f"⚡ Accélération facture: '{text}'")
                speedup_factor = 0.92  # 8% plus rapide pour numéros de facture
                audio = self._stretch_audio(audio, speedup_factor)
            
            # Traitement audio propre
            if self.audio_proc:
                audio = self.audio_proc.process(audio)
            
            return audio
            
        except Exception as e:
            log_error(f"Erreur synthèse: {e}")
            return None
    
    def _stretch_audio(self, audio: np.ndarray, factor: float) -> np.ndarray:
        """Étirer l'audio pour ralentir légèrement les segments courts"""
        try:
            from scipy import signal
            # Utiliser la fonction resample pour étirer
            new_length = int(len(audio) * factor)
            stretched = signal.resample(audio, new_length)
            return stretched.astype(np.int16)
        except:
            # Fallback simple si scipy n'est pas disponible
            return audio
    
    def speak(self, text: str) -> bool:
        """Parler le texte avec prononciation correcte"""
        if not self.available:
            log_warn(f"⚠️ Piper non disponible - parole ignorée")
            return False
        
        try:
            log_info(f"🎙️ Synthèse Piper - Texte: '{text[:60]}...'")
            # Diviser en segments
            segments = FrenchPronunciationV5.split_sentences(text)
            log_info(f"   📊 {len(segments)} segments détectés")
            
            if not segments:
                # Si pas de segments, synthétiser tout le texte
                log_info(f"   🔹 Pas de segments - synthèse directe")
                processed = FrenchPronunciationV5.process(text)
                audio = self.synthesize_segment(processed)
                if audio is not None and len(audio) > 0:
                    log_info(f"   ✓ Audio généré - Lecture via sounddevice")
                    try:
                        device_id = get_best_audio_device()
                        if device_id is None:
                            log_error(f"   ❌ Pas de device audio trouvé")
                            return False
                        
                        sd.play(audio, samplerate=self.sample_rate, device=device_id)
                        sd.wait()
                        log_success(f"✅ Lecture audio OK (device={device_id})")
                        return True
                    except Exception as e:
                        log_error(f"❌ Erreur sounddevice.play(): {e}")
                        return False
                return False
            
            # Construire l'audio complet
            all_audio = []
            
            for i, (seg_text, pause_ms) in enumerate(segments):
                log_info(f"   🔹 Segment {i+1}/{len(segments)}: '{seg_text[:50]}...' ({pause_ms}ms pause)")
                if not seg_text.strip():
                    continue
                
                # Détection des segments nécessitant un traitement spécial
                is_short_greeting = (
                    len(seg_text.split()) <= 2 and  # 1-2 mots max
                    any(word.lower() in ['bonjour', 'au revoir', 'merci', 'bienvenue', 'salut', 'bonsoir']
                        for word in seg_text.split())
                )
                
                # Détection des phrases de clôture (au revoir plus longues)
                is_goodbye_phrase = (
                    'au revoir' in seg_text.lower() or
                    'bonne journée' in seg_text.lower() or
                    'bon travail' in seg_text.lower() or
                    'à bientôt' in seg_text.lower()
                )
                
                # Détection des segments techniques (impression, numéros)
                is_technical_segment = (
                    seg_text.lower().startswith('impression') or  # Commence par "Impression"
                    any(char.isdigit() for char in seg_text) or   # Contient des chiffres
                    'facture' in seg_text.lower() or              # Contient "facture"
                    'numéro' in seg_text.lower()                  # Contient "numéro"
                )
                
                needs_special_treatment = is_short_greeting or is_technical_segment or is_goodbye_phrase
                
                if needs_special_treatment:
                    log_info(f"      🎯 Segment spécial - traitement professionnel")
                
                # Silence avant pour les segments spéciaux (professionnel)
                if needs_special_treatment:
                    silence_before = self.create_silence(120)  # 120ms de silence avant
                    all_audio.append(silence_before)
                
                audio = self.synthesize_segment(seg_text)
                if audio is not None and len(audio) > 0:
                    log_info(f"      ✓ Audio synthétisé ({len(audio)} samples)")
                    all_audio.append(audio)
                    
                    # Ajouter pause (silence propre)
                    if pause_ms > 0:
                        silence = self.create_silence(pause_ms)
                        all_audio.append(silence)
                        log_info(f"      ✓ Pause {pause_ms}ms ajoutée")
                    
                    # Silence après pour les segments spéciaux
                    if needs_special_treatment:
                        silence_after = self.create_silence(80)  # 80ms de silence après
                        all_audio.append(silence_after)
                else:
                    log_warn(f"      ⚠️ Synthèse du segment échouée")
            
            if not all_audio:
                log_error(f"❌ Aucun audio généré")
                return False
            
            # Jouer l'audio
            log_info(f"   🔊 Concaténation de {len(all_audio)} segments audio")
            full_audio = np.concatenate(all_audio)
            log_info(f"   📊 Audio final: {len(full_audio)} samples ({len(full_audio)/self.sample_rate:.1f}s)")
            
            try:
                # ✅ SEULEMENT LECTURE ELECTRON (sounddevice)
                # ❌ NAVIGATEUR DÉSACTIVÉ
                
                # Jouer localement via sounddevice (SEULE OPTION)
                if SOUNDDEVICE_AVAILABLE:
                    try:
                        log_info(f"   🎵 Lecture locale ELECTRON via sounddevice...")
                        
                        # Obtenir le meilleur device
                        device_id = get_best_audio_device()
                        if device_id is None:
                            log_error(f"   ❌ Pas de device audio trouvé - LECTURE IMPOSSIBLE")
                            return False
                        
                        # Jouer
                        log_info(f"   📊 Audio: shape={full_audio.shape}, dtype={full_audio.dtype}, min={full_audio.min():.4f}, max={full_audio.max():.4f}")
                        log_info(f"   🔊 Lecture sur device ID={device_id}...")
                        sd.play(full_audio, samplerate=self.sample_rate, device=device_id)
                        sd.wait()
                        log_success(f"   ✅ LECTURE ELECTRON OK!")
                        return True
                    except Exception as e:
                        log_error(f"   ❌ Erreur sounddevice: {e}")
                        import traceback
                        traceback.print_exc()
                        return False
                else:
                    log_error(f"   ❌ Sounddevice non disponible - IMPOSSIBLE DE JOUER")
                    return False
                    
            except Exception as e:
                log_error(f"❌ Erreur lecture audio: {e}")
                import traceback
                traceback.print_exc()
                return False
            
        except Exception as e:
            log_error(f"❌ Erreur globale synthèse: {e}")
            import traceback
            traceback.print_exc()
            return False


# ============================================================================
# MOTEUR PYTTSX3 FALLBACK
# ============================================================================

class Pyttsx3Fallback:
    def __init__(self):
        self.engine = None
        self.available = PYTTSX3_AVAILABLE
    
    def init(self) -> bool:
        if not self.available:
            return False
        try:
            self.engine = pyttsx3.init()
            self.engine.setProperty('rate', 155)
            for v in self.engine.getProperty('voices'):
                if 'french' in v.name.lower() or 'fr' in v.id.lower():
                    self.engine.setProperty('voice', v.id)
                    break
            return True
        except:
            return False
    
    def speak(self, text: str) -> bool:
        if not self.engine:
            return False
        try:
            self.engine.say(FrenchPronunciationV5.process(text))
            self.engine.runAndWait()
            return True
        except:
            return False
    
    def stop(self):
        if self.engine:
            try:
                self.engine.stop()
            except:
                pass


# ============================================================================
# SERVICE TTS ULTRA PRO v2
# ============================================================================

class TTSService:
    """
    Service TTS NATURAL PRO v5 - 100% OFFLINE
    
    ✅ Prononciation française naturelle (corrections minimales)
    ✅ Audio propre sans exagération (traitement optimisé UPMC)
    ✅ Voix UPMC chaleureuse et professionnelle (votre référence)
    ✅ Égalisation légère optimisée pour UPMC
    ✅ Compression minimale préservant la dynamique
    ✅ Normalisation douce (niveau naturel comme référence)
    ✅ Fade subtil et équilibré
    ✅ 100% OFFLINE
    """
    
    def __init__(self):
        self.speech_queue = queue.Queue()
        self.is_speaking = False
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._count = 0
        # ✅ Socket désactivé - TTS SEULEMENT via sounddevice
        
        self.piper: Optional[PiperNaturalProV5] = None
        self.fallback: Optional[Pyttsx3Fallback] = None
    
    def start(self) -> bool:
        """Démarrer le service"""
        log_info("=" * 55)
        log_info("🎤 TTS NATURAL PRO v5 - PIPER SEULEMENT (PAS DE PYTTSX3)")
        log_info("=" * 55)
        
        self.piper = PiperNaturalProV5()  # ✅ Socket désactivé - audio local seulement
        
        # ✅ STRICT : NE PAS initialiser Pyttsx3 du tout
        # Cela évite que deux moteurs TTS parlent en même temps (doublons audio)
        # Pyttsx3 cause des problèmes de voix en doublon quand Piper joue
        
        if not self.piper.available:
            log_error("❌ PIPER NON DISPONIBLE - ARRÊT!")
            log_error("   Pyttsx3 DÉSACTIVÉ volontairement pour éviter les doublons audio")
            log_error("   Installez les modèles Piper pour la synthèse vocale")
            return False
        else:
            log_success("✅ Piper disponible et actif (PYTTSX3 COMPLÈTEMENT DÉSACTIVÉ)")
        
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        
        log_info("-" * 55)
        log_success("🔒 100% OFFLINE ACTIVÉ")
        log_info("   ✓ Prononciation française naturelle")
        log_info("   ✓ Audio optimisé pour UPMC (votre référence)")
        log_info("   ✓ Voix chaleureuse et professionnelle")
        log_info("   ✓ Traitement minimal pour naturel maximal")
        log_info("-" * 55)
        
        return True
    
    def _loop(self):
        log_info("🔄 Boucle TTS démarrée - En attente de messages...")
        while self.running:
            try:
                text = self.speech_queue.get(timeout=0.5)
                if text is None:
                    log_info("🛑 Signal d'arrêt reçu")
                    break
                self._count += 1
                log_info(f"📣 Traitement message #{self._count} - Queue restante: {self.speech_queue.qsize()}")
                self._speak(text)
                self.speech_queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                log_error(f"Erreur boucle: {e}")
                import traceback
                traceback.print_exc()
    
    def _speak(self, text: str):
        with self._lock:
            self.is_speaking = True
            ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            log_info(f"🎤 [{ts}] ========== SYNTHÈSE TTS #{self._count} ==========")
            log_info(f"   📝 Texte: '{text[:100]}...'")
            log_info(f"   🔹 Taille: {len(text)} caractères")
            
            try:
                # ✅ STRICT: Utiliser SEULEMENT Piper si disponible, sinon fallback
                if self.piper and self.piper.available:
                    log_info(f"   🎛️ Moteur: Piper (Offline UPMC)")
                    success = self.piper.speak(text)
                    if success:
                        log_success(f"   ✅ Piper synthèse OK")
                    else:
                        log_warn(f"   ⚠️ Piper synthèse échouée - Pas de fallback (doublons évités)")
                        # ❌ NE PAS utiliser fallback ici pour éviter les doublons audio
                elif self.fallback and self.fallback.engine:
                    log_info(f"   🎛️ Moteur: Pyttsx3 (Fallback d'urgence)")
                    success = self.fallback.speak(text)
                    if success:
                        log_success(f"   ✅ Pyttsx3 synthèse OK")
                    else:
                        log_warn(f"   ⚠️ Pyttsx3 synthèse échouée")
                else:
                    log_error(f"   ❌ Aucun moteur TTS disponible!")
            except Exception as e:
                log_error(f"   ❌ Erreur synthèse: {e}")
                import traceback
                traceback.print_exc()
            finally:
                self.is_speaking = False
                log_info(f"🏁 Fin synthèse #{self._count}")
                log_info(f"{'='*55}")
    
    def speak(self, text: str, priority: bool = False):
        if not self.running:
            log_warn(f"TTS non actif - parole ignorée: '{text}'")
            return
        
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"{Fore.MAGENTA}[{ts}] 🔊 LaGrace PARLE: {text}{Style.RESET_ALL}")
        log_info(f"📝 Texte reçu ({len(text)} chars): '{text[:80]}...'")
        log_info(f"📢 Queue TTS - Ajout message (priorité: {priority}) - Taille avant: {self.speech_queue.qsize()}")
        
        if priority:
            log_info(f"⏫ Priorité activée - Nettoyage de la queue ({self.speech_queue.qsize()} items)")
            count = 0
            while not self.speech_queue.empty():
                try:
                    self.speech_queue.get_nowait()
                    count += 1
                except:
                    pass
            log_info(f"✅ {count} items supprimés")
        
        self.speech_queue.put(text)
        log_info(f"✅ Message #{self._count + 1} ajouté à la queue - Nouvelle taille: {self.speech_queue.qsize()}")
    
    def speak_response(self, response_type: str, **kwargs):
        responses = VOICE_RESPONSES.get(
            response_type,
            VOICE_RESPONSES.get("not_understood", ["Désolé, je n'ai pas compris."])
        )
        text = random.choice(responses)
        if kwargs:
            for k, v in kwargs.items():
                text = text.replace(f"{{{k}}}", str(v))
        self.speak(text)
    
    def stop_speaking(self):
        if SOUNDDEVICE_AVAILABLE:
            try:
                sd.stop()
            except:
                pass
    
    def wait_until_done(self):
        self.speech_queue.join()
    
    def get_status(self) -> dict:
        return {
            'running': self.running,
            'speaking': self.is_speaking,
            'count': self._count,
            'offline': True
        }
    
    def stop(self):
        log_info("Arrêt TTS...")
        self.running = False
        self.speech_queue.put(None)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        if self.fallback:
            self.fallback.stop()
        log_success(f"TTS arrêté ({self._count} paroles)")


_tts: Optional[TTSService] = None

def get_tts() -> TTSService:
    global _tts
    if _tts is None:
        _tts = TTSService()
    return _tts
