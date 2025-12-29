#!/usr/bin/env python3
"""
Test du Service TTS AI LaGrace
==============================
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from services.tts import TTSService, get_tts

def main():
    print("\n" + "=" * 60)
    print("     🎤 TEST SERVICE TTS AI LaGrace")
    print("=" * 60)
    
    # Créer et démarrer le service
    tts = TTSService()
    
    if not tts.start():
        print("❌ Échec démarrage TTS")
        return
    
    # Afficher le statut
    status = tts.get_status()
    print(f"\n📊 Statut: {status}")
    
    # Tests de parole
    tests = [
        "Bonjour! Je suis LaGrace, votre assistante vocale intelligente.",
        "La vente de 5000 FC pour le client MBUYI est finalisée.",
        "Il reste 42 unités de MOSQUITO KILLER en stock.",
        "Impression de la facture numéro 2024-0125 lancée.",
        "Au revoir et bonne journée de travail!",
    ]
    
    print("\n🔊 Tests de synthèse vocale:\n")
    
    for i, text in enumerate(tests, 1):
        print(f"   [{i}/{len(tests)}] {text[:50]}...")
        tts.speak(text)
        
        # Attendre que la parole soit terminée
        tts.wait_until_done()
        time.sleep(0.5)
    
    # Arrêter le service
    tts.stop()
    
    print("\n" + "=" * 60)
    print("✅ Test terminé!")
    print("=" * 60)


if __name__ == "__main__":
    main()

