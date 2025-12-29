"""
Wake Word Detection Service
============================
Détection du mot-clé "LaGrace" pour activer l'assistant
"""

import threading
import time
import sys
from typing import Optional, Callable

# Colorama pour les couleurs Windows
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    class Fore:
        GREEN = YELLOW = RED = CYAN = MAGENTA = ""
    class Style:
        RESET_ALL = ""

sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])
from config.settings import settings


class WakeWordDetector:
    """Détecteur de mot-clé "LaGrace" """
    
    def __init__(self, stt_service=None):
        self.stt = stt_service
        self.running = False
        self.detected = False
        self._thread: Optional[threading.Thread] = None
        self._on_wake_callback: Optional[Callable[[], None]] = None
        self._last_partial = ""
        
    def start(self, on_wake: Callable[[], None]) -> bool:
        """Démarrer la détection du wake word"""
        if not self.stt:
            print(f"{Fore.YELLOW}⚠️  STT requis pour wake word{Style.RESET_ALL}")
            return False
        
        self._on_wake_callback = on_wake
        self.running = True
        self.detected = False
        
        # Commencer l'écoute continue
        self.stt.start_listening(
            on_text=self._on_text,
            on_partial=self._on_partial
        )
        
        print(f"{Fore.GREEN}👂 Détection wake word active - Dites 'LaGrace'...{Style.RESET_ALL}")
        return True
    
    def _normalize_text(self, text: str) -> str:
        """Normaliser le texte pour la comparaison"""
        # Minuscules
        text = text.lower().strip()
        # Supprimer les accents courants
        replacements = {
            'à': 'a', 'â': 'a', 'ä': 'a',
            'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
            'î': 'i', 'ï': 'i',
            'ô': 'o', 'ö': 'o',
            'ù': 'u', 'û': 'u', 'ü': 'u',
            'ç': 'c',
            "'": " ", "-": " "
        }
        for old, new in replacements.items():
            text = text.replace(old, new)
        return text
    
    def _check_wake_word(self, text: str) -> bool:
        """Vérifier si le texte contient le wake word"""
        normalized = self._normalize_text(text)
        
        # Vérifier toutes les variations
        for variation in settings.wake_word_variations:
            variation_normalized = self._normalize_text(variation)
            if variation_normalized in normalized:
                return True
        
        # Vérification supplémentaire: "la" + "grace" séparément
        if "la" in normalized and "grace" in normalized:
            return True
        if "la" in normalized and "gras" in normalized:
            return True
            
        return False
    
    def _on_partial(self, text: str):
        """Callback pour les résultats partiels"""
        if text == self._last_partial:
            return
        self._last_partial = text
        
        # Vérifier le wake word dans le partiel
        if self._check_wake_word(text) and not self.detected:
            self.detected = True
            print(f"{Fore.MAGENTA}🎯 Wake word détecté (partiel): {text}{Style.RESET_ALL}")
            self._trigger_wake()
    
    def _on_text(self, text: str):
        """Callback pour les résultats finaux"""
        print(f"{Fore.CYAN}📝 Reconnu: {text}{Style.RESET_ALL}")
        
        # Vérifier le wake word
        if self._check_wake_word(text) and not self.detected:
            self.detected = True
            print(f"{Fore.MAGENTA}🎯 Wake word détecté: {text}{Style.RESET_ALL}")
            self._trigger_wake()
    
    def _trigger_wake(self):
        """Déclencher le callback de wake word"""
        if self._on_wake_callback:
            # Exécuter le callback dans un thread séparé
            threading.Thread(target=self._on_wake_callback, daemon=True).start()
    
    def reset(self):
        """Réinitialiser après avoir traité une commande"""
        self.detected = False
        self._last_partial = ""
        print(f"{Fore.GREEN}👂 En attente de 'LaGrace'...{Style.RESET_ALL}")
    
    def pause(self):
        """Mettre en pause la détection"""
        if self.stt:
            self.stt.stop_listening()
        print(f"{Fore.YELLOW}⏸️  Wake word en pause{Style.RESET_ALL}")
    
    def resume(self):
        """Reprendre la détection"""
        if self.stt:
            self.stt.start_listening(
                on_text=self._on_text,
                on_partial=self._on_partial
            )
        self.reset()
    
    def stop(self):
        """Arrêter la détection"""
        self.running = False
        if self.stt:
            self.stt.stop_listening()
        print(f"{Fore.YELLOW}🛑 Wake word arrêté{Style.RESET_ALL}")


# Instance globale
_wake_word_instance: Optional[WakeWordDetector] = None

def get_wake_word_detector(stt_service=None) -> WakeWordDetector:
    """Obtenir l'instance du détecteur"""
    global _wake_word_instance
    if _wake_word_instance is None:
        _wake_word_instance = WakeWordDetector(stt_service)
    return _wake_word_instance


