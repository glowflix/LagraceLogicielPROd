#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test des phrases d'au revoir - LaGrace TTS v5
Teste spécifiquement les phrases de clôture longues
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.tts import TTSService

def test_phrases_aurevoir():
    """Tester les phrases d'au revoir longues avec traitement spécial"""
    print("=============================================================")
    print("     👋 TEST PHRASES D'AU REVOIR")
    print("=============================================================")

    tts = TTSService()
    tts.start()

    # Test des phrases d'au revoir longues
    phrases_aurevoir = [
        "Au revoir et bonne journée de travail!",
        "Au revoir, à bientôt!",
        "Bonne journée et au revoir!",
        "Bon travail aujourd'hui, au revoir!",
        "À bientôt et bonne continuation!"
    ]

    print("\n👋 Test des phrases d'au revoir longues:")
    print("   ✅ Détection automatique + ralentissement + silences\n")

    for i, phrase in enumerate(phrases_aurevoir, 1):
        print(f"   [{i}/{len(phrases_aurevoir)}] {phrase}")
        tts.speak(phrase)
        print()

    # Test de phrases de clôture diverses
    phrases_cloture = [
        "Merci beaucoup, bonne journée!",
        "C'est terminé pour aujourd'hui, au revoir.",
        "Bon travail, à demain!",
        "La journée est finie, au revoir!"
    ]

    print("🎯 Test de phrases de clôture diverses:")
    print("   (Toutes devraient être détectées)\n")

    for i, phrase in enumerate(phrases_cloture, 1):
        print(f"   [{i}/{len(phrases_cloture)}] {phrase}")
        tts.speak(phrase)
        print()

    tts.stop()
    print("=============================================================")
    print("✅ Test des phrases d'au revoir terminé!")
    print("=============================================================")

if __name__ == "__main__":
    test_phrases_aurevoir()