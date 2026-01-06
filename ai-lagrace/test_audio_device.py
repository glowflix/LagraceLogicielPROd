#!/usr/bin/env python3
"""
Test Audio Device - Diagnostic AI LaGrace
=========================================
Vérifie si sounddevice fonctionne et peut jouer du son.
"""

import sys
import os

# Forcer l'encodage UTF-8 pour Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

print("=" * 60)
print("🔊 DIAGNOSTIC AUDIO - AI LaGrace")
print("=" * 60)

# Test 1: Import sounddevice
print("\n[1/5] Test import sounddevice...")
try:
    import sounddevice as sd
    print(f"   ✅ sounddevice version: {sd.__version__}")
except ImportError as e:
    print(f"   ❌ ERREUR: sounddevice non installé - {e}")
    print("   💡 Installez avec: pip install sounddevice")
    sys.exit(1)

# Test 2: Liste des devices
print("\n[2/5] Énumération des devices audio...")
try:
    devices = sd.query_devices()
    print(f"   📊 {len(devices)} device(s) trouvé(s)")
    
    output_devices = []
    for i, dev in enumerate(devices):
        if dev['max_output_channels'] > 0:
            output_devices.append((i, dev))
            status = " ⭐ DEFAULT" if i == sd.default.device[1] else ""
            print(f"   [{i}] {dev['name']} ({dev['max_output_channels']} ch.){status}")
    
    if not output_devices:
        print("   ❌ ERREUR: Aucun device de sortie audio trouvé!")
        sys.exit(1)
except Exception as e:
    print(f"   ❌ ERREUR: {e}")
    sys.exit(1)

# Test 3: Device par défaut
print("\n[3/5] Vérification du device par défaut...")
try:
    default_output = sd.default.device[1]
    print(f"   📻 Device de sortie par défaut: ID={default_output}")
    
    if default_output is not None and default_output >= 0:
        dev_info = sd.query_devices(default_output)
        print(f"   📻 Nom: {dev_info['name']}")
        print(f"   📻 Channels: {dev_info['max_output_channels']}")
        print(f"   📻 Sample Rate: {dev_info['default_samplerate']}")
    else:
        print("   ⚠️ Pas de device par défaut - utilisation du premier device disponible")
except Exception as e:
    print(f"   ⚠️ Avertissement: {e}")

# Test 4: Import numpy
print("\n[4/5] Test import numpy...")
try:
    import numpy as np
    print(f"   ✅ numpy version: {np.__version__}")
except ImportError as e:
    print(f"   ❌ ERREUR: numpy non installé - {e}")
    sys.exit(1)

# Test 5: Jouer un son de test
print("\n[5/5] Test de lecture audio (bip 500Hz pendant 0.5s)...")
try:
    sample_rate = 22050
    duration = 0.5  # secondes
    frequency = 500  # Hz
    
    # Générer une onde sinusoïdale
    t = np.linspace(0, duration, int(sample_rate * duration), False)
    audio = np.sin(2 * np.pi * frequency * t)
    
    # Normaliser et convertir en int16
    audio = (audio * 0.5 * 32767).astype(np.int16)
    
    # Jouer le son
    print("   🎵 Lecture en cours...")
    sd.play(audio, samplerate=sample_rate)
    sd.wait()
    print("   ✅ Lecture audio réussie!")
    
except Exception as e:
    print(f"   ❌ ERREUR lecture audio: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test bonus: Piper
print("\n[BONUS] Test Piper TTS...")
try:
    from piper import PiperVoice
    print("   ✅ Piper importé avec succès")
    
    # Vérifier les modèles
    from pathlib import Path
    models_dir = Path(__file__).parent / "models" / "piper"
    
    onnx_files = list(models_dir.glob("*.onnx"))
    if onnx_files:
        print(f"   ✅ Modèles trouvés: {[f.name for f in onnx_files]}")
    else:
        print(f"   ⚠️ Aucun modèle .onnx trouvé dans {models_dir}")
        print("   💡 Téléchargez les modèles Piper fr_FR depuis:")
        print("      https://github.com/rhasspy/piper/releases")
        
except ImportError as e:
    print(f"   ⚠️ Piper non disponible: {e}")
    print("   💡 Installez avec: pip install piper-tts")

print("\n" + "=" * 60)
print("✅ DIAGNOSTIC TERMINÉ")
print("=" * 60)
print("\nSi le bip a été entendu, l'audio fonctionne correctement!")
print("Si non, vérifiez:")
print("  1. Le volume de votre PC n'est pas en sourdine")
print("  2. Les haut-parleurs/casque sont branchés")
print("  3. Le device audio par défaut est correct")

