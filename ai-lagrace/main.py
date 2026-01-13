#!/usr/bin/env python3
"""
AI LaGrace - Assistant Vocal Intelligent
=========================================
Point d'entrée principal pour l'assistant vocal LaGrace.

Usage:
    python main.py              # Démarrage normal
    python main.py --test       # Test sans wake word
    python main.py --help       # Aide
"""

import sys
import os
import argparse

# Forcer l'encodage UTF-8 pour Windows (évite UnicodeEncodeError avec cp1252)
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Ajouter le répertoire parent au path pour les imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Initialiser colorama pour Windows
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    # Fallback si colorama n'est pas installé
    class Fore:
        GREEN = YELLOW = RED = CYAN = MAGENTA = BLUE = ""
    class Style:
        RESET_ALL = BRIGHT = ""


def print_banner():
    """Afficher la bannière de démarrage"""
    try:
        banner = f"""
{Fore.CYAN}╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   {Fore.GREEN}█████╗  ██╗    ██╗       █████╗  ██████╗ ██████╗  █████╗  ██████╗ ███████╗{Fore.CYAN}  ║
║   {Fore.GREEN}██╔══██╗██║    ██║      ██╔══██╗██╔════╝ ██╔══██╗██╔══██╗██╔════╝ ██╔════╝{Fore.CYAN}  ║
║   {Fore.GREEN}███████║██║    ██║      ███████║██║  ███╗██████╔╝███████║██║      █████╗{Fore.CYAN}    ║
║   {Fore.GREEN}██╔══██║██║    ██║      ██╔══██║██║   ██║██╔══██╗██╔══██║██║      ██╔══╝{Fore.CYAN}    ║
║   {Fore.GREEN}██║  ██║██║    ███████╗ ██║  ██║╚██████╔╝██║  ██║██║  ██║╚██████╗ ███████╗{Fore.CYAN}  ║
║   {Fore.GREEN}╚═╝  ╚═╝╚═╝    ╚══════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝{Fore.CYAN}  ║
║                                                          ║
║   {Fore.YELLOW}Assistant Vocal Intelligent pour La Grace POS{Fore.CYAN}           ║
║   {Fore.MAGENTA}Version 1.0.0 - 100% Offline{Fore.CYAN}                            ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝{Style.RESET_ALL}
"""
        print(banner)
    except UnicodeEncodeError:
        # Fallback ASCII pour Windows avec encodage incompatible
        print(f"""
{Fore.CYAN}============================================================
    {Fore.GREEN}AI LAGRACE{Fore.CYAN}
============================================================
    {Fore.YELLOW}Assistant Vocal Intelligent pour La Grace POS{Fore.CYAN}
    {Fore.MAGENTA}Version 1.0.0 - 100% Offline{Fore.CYAN}
============================================================{Style.RESET_ALL}
""")


def check_dependencies():
    """Vérifier que les dépendances sont installées"""
    missing = []
    
    # Vérifier les modules requis
    required = [
        ('vosk', 'vosk'),
        ('sounddevice', 'sounddevice'),
        ('numpy', 'numpy'),
        ('pyttsx3', 'pyttsx3'),
        ('socketio', 'python-socketio'),
    ]
    
    for module, pip_name in required:
        try:
            __import__(module)
        except ImportError:
            missing.append(pip_name)
    
    if missing:
        print(f"{Fore.RED}❌ Dépendances manquantes:{Style.RESET_ALL}")
        for dep in missing:
            print(f"   - {dep}")
        print(f"\n{Fore.YELLOW}💡 Installez avec: pip install {' '.join(missing)}{Style.RESET_ALL}")
        return False
    
    print(f"{Fore.GREEN}✅ Toutes les dépendances sont installées{Style.RESET_ALL}")
    return True


def check_vosk_model():
    """Vérifier que le modèle Vosk est présent"""
    from pathlib import Path
    from config.settings import settings
    
    model_path = Path(settings.vosk_model_path)
    
    # Vosk est optionnel - ne pas afficher d'erreur
    return model_path.exists()


def run_test_mode():
    """Mode test sans wake word"""
    print(f"\n{Fore.YELLOW}🧪 Mode Test - Sans Wake Word{Style.RESET_ALL}\n")
    
    from services.tts import TTSService
    from services.stt import STTService
    from services.intent import IntentRecognizer
    from services.database import DatabaseService
    
    # Test TTS
    print(f"{Fore.CYAN}[1/4] Test TTS (synthèse vocale)...{Style.RESET_ALL}")
    tts = TTSService()
    if tts.start():
        tts.speak("Test de la synthèse vocale. LaGrace est prête.")
        tts.wait_until_done()
        tts.stop()
    else:
        print(f"{Fore.YELLOW}⚠️  TTS non disponible{Style.RESET_ALL}")
    
    # Test Intent
    print(f"\n{Fore.CYAN}[2/4] Test Intent (reconnaissance d'intention)...{Style.RESET_ALL}")
    intent = IntentRecognizer()
    test_phrases = [
        "quel est le stock de mosquito?",
        "ventes d'aujourd'hui",
        "qui nous doit de l'argent?",
        "bonjour comment ça va?"
    ]
    for phrase in test_phrases:
        result = intent.recognize(phrase)
        print(f"   '{phrase}' -> {result.name} ({result.confidence:.2f})")
    
    # Test Database
    print(f"\n{Fore.CYAN}[3/4] Test Database...{Style.RESET_ALL}")
    db = DatabaseService()
    if db.start():
        sales = db.get_today_sales()
        print(f"   Ventes du jour: {sales}")
        db.stop()
    else:
        print(f"{Fore.YELLOW}⚠️  Base de données non disponible{Style.RESET_ALL}")
    
    # Test STT (court)
    print(f"\n{Fore.CYAN}[4/4] Test STT (reconnaissance vocale)...{Style.RESET_ALL}")
    stt = STTService()
    if stt.start():
        print(f"{Fore.GREEN}✅ STT prêt - Le micro fonctionne{Style.RESET_ALL}")
        stt.stop()
    else:
        print(f"{Fore.RED}❌ STT non disponible{Style.RESET_ALL}")
    
    print(f"\n{Fore.GREEN}✅ Tests terminés!{Style.RESET_ALL}")


def main():
    """Point d'entrée principal"""
    from datetime import datetime
    
    parser = argparse.ArgumentParser(
        description="AI LaGrace - Assistant Vocal Intelligent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  python main.py              # Démarrer l'assistant
  python main.py --test       # Mode test (sans wake word)
  python main.py --check      # Vérifier les dépendances
        """
    )
    parser.add_argument('--test', action='store_true', help='Mode test sans wake word')
    parser.add_argument('--check', action='store_true', help='Vérifier les dépendances')
    parser.add_argument('--quiet', action='store_true', help='Pas de bannière')
    
    args = parser.parse_args()
    
    # Afficher la bannière
    if not args.quiet:
        print_banner()
    
    # Log de démarrage
    print(f"\n{Fore.CYAN}{'='*60}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}   Démarrage: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}   Python: {sys.version.split()[0]}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}   Plateforme: {sys.platform}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}{'='*60}{Style.RESET_ALL}\n")
    
    # Mode vérification
    if args.check:
        deps_ok = check_dependencies()
        model_ok = check_vosk_model()
        sys.exit(0 if (deps_ok and model_ok) else 1)
    
    # Vérifier les dépendances
    print(f"{Fore.CYAN}[1/3] Vérification des dépendances...{Style.RESET_ALL}")
    if not check_dependencies():
        sys.exit(1)
    
    # Vérifier le modèle Vosk (silencieusement - c'est optionnel)
    print(f"{Fore.CYAN}[2/3] Vérification du modèle Vosk...{Style.RESET_ALL}")
    check_vosk_model()  # Juste vérifier, pas besoin d'afficher les warnings
    
    # Mode test
    if args.test:
        run_test_mode()
        sys.exit(0)
    
    # Démarrer l'assistant
    print(f"{Fore.CYAN}[3/3] Démarrage de l'assistant...{Style.RESET_ALL}\n")
    
    try:
        from services.assistant import LaGraceAssistant
        
        assistant = LaGraceAssistant()
        print(f"{Fore.GREEN}✅ Assistant initialisé{Style.RESET_ALL}")
        
        if assistant.start():
            print(f"\n{Fore.GREEN}{'='*60}{Style.RESET_ALL}")
            print(f"{Fore.GREEN}   AI LaGrace est maintenant EN ÉCOUTE{Style.RESET_ALL}")
            print(f"{Fore.GREEN}   Dites 'LaGrace' pour activer ou attendez les événements{Style.RESET_ALL}")
            print(f"{Fore.GREEN}{'='*60}{Style.RESET_ALL}\n")
            
            # Boucle principale (bloquante)
            assistant.run()
        else:
            print(f"{Fore.RED}❌ Impossible de démarrer l'assistant{Style.RESET_ALL}")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}⚠️  Interruption utilisateur (Ctrl+C){Style.RESET_ALL}")
    except Exception as e:
        print(f"\n{Fore.RED}❌ Erreur fatale: {e}{Style.RESET_ALL}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        print(f"\n{Fore.CYAN}AI LaGrace terminée. Au revoir !{Style.RESET_ALL}")


if __name__ == "__main__":
    main()

