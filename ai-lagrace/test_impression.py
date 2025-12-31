#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test des messages d'impression - LaGrace TTS v5
Teste spécifiquement les messages techniques comme l'impression
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.tts import TTSService

def test_messages_impression():
    """Tester les messages d'impression avec traitement spécial"""
    print("=============================================================")
    print("     🖨️  TEST MESSAGES IMPRESSION")
    print("=============================================================")

    tts = TTSService()
    tts.start()

    # Test des messages d'impression
    messages_impression = [
        "Impression de la facture numéro 2024-0125 lancée.",
        "Impression du reçu en cours...",
        "Facture numéro 2024-0126 imprimée avec succès.",
        "Impression de l'inventaire terminée.",
        "Ticket de caisse numéro 00123 imprimé."
    ]

    print("\n🖨️  Test des messages d'impression avec traitement spécial:")
    print("   ✅ Détection automatique + ralentissement + silences\n")

    for i, message in enumerate(messages_impression, 1):
        print(f"   [{i}/{len(messages_impression)}] {message}")
        tts.speak(message)
        print()

    # Test de messages avec numéros
    messages_numeros = [
        "Commande numéro 456 validée.",
        "Client numéro 789 ajouté.",
        "Produit référence ABC123 scanné."
    ]

    print("🔢 Test de messages avec numéros:")
    print("   (Traitement spécial automatique)\n")

    for i, message in enumerate(messages_numeros, 1):
        print(f"   [{i}/{len(messages_numeros)}] {message}")
        tts.speak(message)
        print()

    tts.stop()
    print("=============================================================")
    print("✅ Test des messages d'impression terminé!")
    print("=============================================================")

if __name__ == "__main__":
    test_messages_impression()