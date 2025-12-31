#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test des salutations professionnelles - LaGrace TTS v5
Teste spécifiquement les pauses et le fade pour les salutations courtes
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.tts import TTSService

def test_salutations_professionnelles():
    """Tester les salutations avec pauses optimisées"""
    print("=============================================================")
    print("     🎤 TEST SALUTATIONS PROFESSIONNELLES")
    print("=============================================================")

    tts = TTSService()
    tts.start()

    # Test des salutations courtes
    salutations = [
        "Bonjour!",
        "Au revoir!",
        "Merci!",
        "Bienvenue!",
        "À bientôt!"
    ]

    print("\n🎧 Test des salutations courtes avec pauses optimisées:")
    print("   (Écoutez la fluidité et la durée des pauses)")
    print("   ✅ Silences avant/après + ralentissement pour segments courts\n")

    for i, salut in enumerate(salutations, 1):
        print(f"   [{i}/{len(salutations)}] {salut} (segment court détecté)")
        tts.speak(salut)
        print()

    # Test de phrases complètes avec salutations
    phrases = [
        "Bonjour! Comment allez-vous?",
        "La vente est finalisée. Au revoir!",
        "Merci beaucoup! À bientôt..."
    ]

    print("🎧 Test de phrases avec salutations intégrées:")
    print("   (Vérifiez la fluidité professionnelle)\n")

    for i, phrase in enumerate(phrases, 1):
        print(f"   [{i}/{len(phrases)}] {phrase}")
        tts.speak(phrase)
        print()

    tts.stop()
    print("=============================================================")
    print("✅ Test des salutations terminé!")
    print("=============================================================")

if __name__ == "__main__":
    test_salutations_professionnelles()