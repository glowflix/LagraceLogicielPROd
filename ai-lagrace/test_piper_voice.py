#!/usr/bin/env python3
"""
Test de la voix Piper TTS - Voix neuronale ultra naturelle
==========================================================
"""

import sys
import os
from pathlib import Path

# Ajouter le chemin
sys.path.insert(0, str(Path(__file__).parent))

# Chemin du modèle
MODELS_DIR = Path(__file__).parent / "models" / "piper"
MODEL_ONNX = MODELS_DIR / "fr_FR-siwis-medium.onnx"
MODEL_JSON = MODELS_DIR / "fr_FR-siwis-medium.onnx.json"


def test_piper():
    """Tester la voix Piper TTS"""
    print("\n" + "=" * 60)
    print("🎤 TEST PIPER TTS - VOIX NEURONALE FRANÇAISE")
    print("=" * 60)
    
    try:
        print("\n📦 Vérification des imports...")
        from piper import PiperVoice
        import sounddevice as sd
        import numpy as np
        print("   ✅ Tous les modules importés")
        
        # Vérifier que le modèle existe
        if not MODEL_ONNX.exists():
            print(f"   ❌ Modèle non trouvé: {MODEL_ONNX}")
            print("   Téléchargez le modèle:")
            print("   https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/fr/fr_FR/siwis/medium")
            return False
        
        print(f"\n📁 Modèle: {MODEL_ONNX}")
        print(f"   Taille: {MODEL_ONNX.stat().st_size / 1024 / 1024:.1f} MB")
        
        print("\n📥 Chargement du modèle français...")
        
        # Charger le modèle depuis le fichier local
        voice = PiperVoice.load(str(MODEL_ONNX), config_path=str(MODEL_JSON))
        
        print("   ✅ Modèle chargé!")
        print(f"   Taux d'échantillonnage: {voice.config.sample_rate} Hz")
        
        # Textes de test - phrases naturelles en français
        tests = [
            "Bonjour! Je suis LaGrace, votre assistante vocale intelligente.",
            "La vente de trois mille francs congolais est finalisée.",
            "Il reste cinquante-deux unités de MOSQUITO en stock.",
            "Bonne journée de travail!"
        ]
        
        print("\n🔊 Test de synthèse vocale...")
        print("   🎧 Écoutez la différence de naturel par rapport à pyttsx3!")
        
        for i, text in enumerate(tests, 1):
            print(f"\n   [{i}/{len(tests)}] {text}")
            
            # Synthétiser - nouvelle API avec AudioChunk
            audio_data = b''
            for audio_chunk in voice.synthesize(text):
                audio_data += audio_chunk.audio_int16_bytes
            
            # Jouer
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            sd.play(audio_array, samplerate=voice.config.sample_rate)
            sd.wait()
        
        print("\n" + "=" * 60)
        print("✅ TEST RÉUSSI!")
        print("   La voix Piper TTS est opérationnelle!")
        print("   Cette voix est BEAUCOUP plus naturelle que pyttsx3.")
        print("=" * 60)
        
        return True
        
    except ImportError as e:
        print(f"\n❌ Module manquant: {e}")
        print("   Installez avec: pip install piper-tts sounddevice numpy")
        return False
        
    except Exception as e:
        print(f"\n❌ Erreur: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_pyttsx3():
    """Tester pyttsx3 comme fallback"""
    print("\n" + "=" * 60)
    print("🔊 TEST PYTTSX3 (FALLBACK)")
    print("=" * 60)
    
    try:
        import pyttsx3
        
        engine = pyttsx3.init()
        engine.setProperty('rate', 160)
        engine.setProperty('volume', 0.95)
        
        # Chercher voix française
        voices = engine.getProperty('voices')
        french_voice = None
        for voice in voices:
            if 'french' in voice.name.lower() or 'fr' in voice.id.lower():
                french_voice = voice
                break
        
        if french_voice:
            engine.setProperty('voice', french_voice.id)
            print(f"   Voix: {french_voice.name}")
        else:
            print("   ⚠️  Pas de voix française, voix par défaut utilisée")
        
        text = "Bonjour! Je suis LaGrace, votre assistante vocale."
        print(f"\n   Test: {text}")
        
        engine.say(text)
        engine.runAndWait()
        
        print("\n   ✅ pyttsx3 fonctionne (mais moins naturel que Piper)")
        return True
        
    except Exception as e:
        print(f"   ❌ Erreur: {e}")
        return False


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("     🎤 AI LaGrace - TEST DES MOTEURS TTS")
    print("=" * 60)
    
    # Test Piper d'abord
    piper_ok = test_piper()
    
    if not piper_ok:
        print("\n⚠️  Piper TTS non disponible, test du fallback pyttsx3...")
        test_pyttsx3()
    else:
        print("\n✨ Piper TTS est configuré! Voix ultra naturelle activée.")
