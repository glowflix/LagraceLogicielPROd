#!/usr/bin/env python3
"""
Test de la Prononciation Française Naturelle
=============================================
Teste les pauses, l'intonation et la prononciation.
"""

import sys
from pathlib import Path
import time

sys.path.insert(0, str(Path(__file__).parent))

from services.tts import TTSService, FrenchPronunciationV5 as FrenchPronunciationProcessor

def test_text_processing():
    """Tester le traitement du texte"""
    print("\n" + "=" * 60)
    print("📝 TEST DU TRAITEMENT DE TEXTE")
    print("=" * 60)
    
    tests = [
        ("La vente de 5000 FC est finalisée.", 
         "Doit convertir: 5000 -> cinq mille, FC -> francs congolais"),
        
        ("Il reste 42 unités en stock, et 15 kg disponibles.",
         "Doit: convertir nombres, ajouter pause après virgule"),
        
        ("Bonjour! Comment allez-vous? Très bien, merci.",
         "Doit: pauses après ! et ?"),
        
        ("Le client MBUYI doit 150000 FC depuis le 15/01/2024.",
         "Doit: convertir tous les nombres"),
        
        ("Impression lancée... Veuillez patienter.",
         "Doit: longue pause après ..."),
        
        ("Aujourd'hui, nous avons vendu 3 produits pour un total de 25 USD.",
         "Doit: liaisons françaises, conversions"),
    ]
    
    for original, description in tests:
        processed = FrenchPronunciationProcessor.process(original)
        print(f"\n📌 {description}")
        print(f"   Original:  {original}")
        print(f"   Traité:    {processed}")
    
    print("\n" + "=" * 60)


def test_speech_segments():
    """Tester la segmentation avec pauses"""
    print("\n" + "=" * 60)
    print("⏱️  TEST DE SEGMENTATION AVEC PAUSES")
    print("=" * 60)
    
    text = "Bonjour! La vente est finalisée. Merci beaucoup, à bientôt... Au revoir!"
    processed = FrenchPronunciationProcessor.process(text)
    segments = FrenchPronunciationProcessor.split_sentences(processed)
    
    print(f"\nTexte: {text}")
    print(f"\nSegments avec pauses:")
    for i, (segment, pause_ms) in enumerate(segments, 1):
        print(f"   {i}. \"{segment}\" → pause {pause_ms}ms")


def test_speech():
    """Tester la parole avec pauses naturelles"""
    print("\n" + "=" * 60)
    print("🔊 TEST DE LA PAROLE AVEC PAUSES NATURELLES")
    print("=" * 60)
    
    tts = TTSService()
    if not tts.start():
        print("❌ Échec démarrage TTS")
        return
    
    tests = [
        "Bonjour! Je suis LaGrace, votre assistante vocale.",
        "La vente de 5000 francs congolais est finalisée, merci beaucoup.",
        "Il reste 42 unités en stock. C'est suffisant pour aujourd'hui.",
        "Attention! Le stock de MOSQUITO est critique... Il faut commander.",
        "Au revoir, et bonne journée de travail!",
    ]
    
    print("\n🎧 Écoutez les pauses naturelles aux ponctuations:\n")
    
    for i, text in enumerate(tests, 1):
        print(f"   [{i}/{len(tests)}] {text}")
        tts.speak(text)
        tts.wait_until_done()
        time.sleep(0.3)
    
    tts.stop()
    
    print("\n" + "=" * 60)
    print("✅ Test terminé!")
    print("=" * 60)


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("     🇫🇷 TEST PRONONCIATION FRANÇAISE NATURELLE")
    print("=" * 60)
    
    # Test 1: Traitement du texte
    test_text_processing()
    
    # Test 2: Segmentation
    test_speech_segments()
    
    # Test 3: Parole avec pauses
    test_speech()

