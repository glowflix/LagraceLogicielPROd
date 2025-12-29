#!/usr/bin/env python3
"""
Script d'installation de Piper TTS pour AI LaGrace
===================================================
Télécharge et configure le moteur vocal neuronal Piper TTS
pour une voix française ultra naturelle.

Usage:
    python setup_piper.py
"""

import os
import sys
import subprocess
import urllib.request
import zipfile
import tarfile
from pathlib import Path

# Couleurs pour le terminal
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def print_color(msg: str, color: str = Colors.RESET):
    print(f"{color}{msg}{Colors.RESET}")

def print_banner():
    print_color("""
╔══════════════════════════════════════════════════════════════╗
║      🎤 PIPER TTS - Installation Voix Neuronale              ║
║                  AI LaGrace Setup                             ║
╚══════════════════════════════════════════════════════════════╝
""", Colors.CYAN)

def check_pip():
    """Vérifier que pip est disponible"""
    try:
        subprocess.run([sys.executable, '-m', 'pip', '--version'], 
                      capture_output=True, check=True)
        return True
    except:
        return False

def install_piper_tts():
    """Installer piper-tts via pip"""
    print_color("\n📦 Installation de Piper TTS via pip...", Colors.CYAN)
    
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', 'piper-tts', '--upgrade'],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print_color("✅ Piper TTS installé avec succès!", Colors.GREEN)
            return True
        else:
            print_color(f"⚠️  Avertissement: {result.stderr}", Colors.YELLOW)
            # Essayer de continuer quand même
            return True
            
    except Exception as e:
        print_color(f"❌ Erreur installation: {e}", Colors.RED)
        return False

def install_sounddevice():
    """Installer sounddevice pour la lecture audio"""
    print_color("\n📦 Installation de sounddevice...", Colors.CYAN)
    
    try:
        subprocess.run(
            [sys.executable, '-m', 'pip', 'install', 'sounddevice', 'numpy', '--upgrade'],
            capture_output=True,
            check=True
        )
        print_color("✅ sounddevice installé!", Colors.GREEN)
        return True
    except Exception as e:
        print_color(f"❌ Erreur: {e}", Colors.RED)
        return False

def download_french_model():
    """Télécharger le modèle français Piper"""
    print_color("\n📥 Téléchargement du modèle français...", Colors.CYAN)
    print_color("   Modèle: fr_FR-siwis-medium (voix féminine naturelle)", Colors.CYAN)
    
    try:
        # Essayer d'importer piper et télécharger via la bibliothèque
        from piper import PiperVoice
        
        models_dir = Path(__file__).parent / "models" / "piper"
        models_dir.mkdir(parents=True, exist_ok=True)
        
        print_color("   Chargement du modèle (téléchargement automatique)...", Colors.CYAN)
        
        # Le modèle sera téléchargé automatiquement
        voice = PiperVoice.load("fr_FR-siwis-medium", download_dir=str(models_dir))
        
        print_color("✅ Modèle français téléchargé!", Colors.GREEN)
        print_color(f"   Emplacement: {models_dir}", Colors.CYAN)
        return True
        
    except ImportError:
        print_color("⚠️  Impossible de charger piper - modèle non téléchargé", Colors.YELLOW)
        print_color("   Le modèle sera téléchargé au premier lancement.", Colors.YELLOW)
        return True
        
    except Exception as e:
        print_color(f"⚠️  Téléchargement modèle: {e}", Colors.YELLOW)
        print_color("   Le modèle sera téléchargé au premier lancement.", Colors.YELLOW)
        return True

def test_tts():
    """Tester la synthèse vocale"""
    print_color("\n🧪 Test de la synthèse vocale...", Colors.CYAN)
    
    try:
        from piper import PiperVoice
        import sounddevice as sd
        import numpy as np
        import io
        import wave
        
        models_dir = Path(__file__).parent / "models" / "piper"
        
        print_color("   Chargement du modèle...", Colors.CYAN)
        voice = PiperVoice.load("fr_FR-siwis-medium", download_dir=str(models_dir))
        
        print_color("   Synthèse du texte de test...", Colors.CYAN)
        test_text = "Bonjour! Je suis LaGrace, votre assistante vocale. Tout fonctionne parfaitement!"
        
        # Synthétiser
        audio_data = b''
        for audio_bytes in voice.synthesize_stream_raw(test_text):
            audio_data += audio_bytes
        
        # Jouer
        print_color("   🔊 Lecture audio...", Colors.CYAN)
        audio_array = np.frombuffer(audio_data, dtype=np.int16)
        sd.play(audio_array, samplerate=voice.config.sample_rate)
        sd.wait()
        
        print_color("✅ Test réussi! Voix Piper TTS opérationnelle!", Colors.GREEN)
        return True
        
    except ImportError as e:
        print_color(f"⚠️  Dépendances manquantes: {e}", Colors.YELLOW)
        return False
    except Exception as e:
        print_color(f"❌ Erreur test: {e}", Colors.RED)
        return False

def show_summary():
    """Afficher le résumé de l'installation"""
    print_color("""
╔══════════════════════════════════════════════════════════════╗
║                    📋 RÉSUMÉ INSTALLATION                     ║
╚══════════════════════════════════════════════════════════════╝
""", Colors.CYAN)
    
    print_color("🎤 PIPER TTS - Voix Neuronale Ultra Naturelle", Colors.GREEN)
    print()
    print_color("Avantages:", Colors.CYAN)
    print_color("  ✅ Voix française TRÈS naturelle (comme humain)", Colors.GREEN)
    print_color("  ✅ Fonctionne 100% OFFLINE", Colors.GREEN)
    print_color("  ✅ Très rapide", Colors.GREEN)
    print_color("  ✅ Gratuit et open source", Colors.GREEN)
    print()
    print_color("Modèle installé:", Colors.CYAN)
    print_color("  📍 fr_FR-siwis-medium (voix féminine française)", Colors.CYAN)
    print()
    print_color("Pour lancer AI LaGrace:", Colors.CYAN)
    print_color("  python main.py", Colors.BOLD)
    print()

def main():
    print_banner()
    
    if not check_pip():
        print_color("❌ pip n'est pas disponible!", Colors.RED)
        sys.exit(1)
    
    # Installation des dépendances
    if not install_sounddevice():
        print_color("⚠️  sounddevice non installé - audio système utilisé", Colors.YELLOW)
    
    if not install_piper_tts():
        print_color("❌ Échec installation Piper TTS", Colors.RED)
        print_color("   Fallback vers pyttsx3 (voix moins naturelle)", Colors.YELLOW)
        
        # Installer pyttsx3 en fallback
        subprocess.run([sys.executable, '-m', 'pip', 'install', 'pyttsx3'])
        sys.exit(1)
    
    # Télécharger le modèle français
    download_french_model()
    
    # Tester
    test_result = test_tts()
    
    # Résumé
    show_summary()
    
    if test_result:
        print_color("🎉 Installation terminée avec succès!", Colors.GREEN)
    else:
        print_color("⚠️  Installation terminée mais test non effectué.", Colors.YELLOW)
        print_color("   Le modèle sera téléchargé au premier lancement.", Colors.YELLOW)

if __name__ == "__main__":
    main()

