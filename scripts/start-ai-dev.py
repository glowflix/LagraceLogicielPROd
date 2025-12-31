#!/usr/bin/env python3
"""
Lanceur AI LaGrace pour npm run dev
Gère les erreurs et redémarrages automatiques
"""

import sys
import os
import subprocess
import time
from pathlib import Path

# Ajouter le répertoire courant au path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def main():
    """Lancer AI LaGrace"""
    ai_dir = Path(__file__).parent / "ai-lagrace"
    main_py = ai_dir / "main.py"
    
    if not ai_dir.exists():
        print(f"❌ Dossier ai-lagrace non trouvé: {ai_dir}")
        sys.exit(1)
    
    if not main_py.exists():
        print(f"❌ Fichier main.py non trouvé: {main_py}")
        sys.exit(1)
    
    print(f"\n{'='*60}")
    print(f"🚀 DÉMARRAGE AI LAGRACE")
    print(f"{'='*60}")
    print(f"📂 Répertoire: {ai_dir}")
    print(f"🐍 Script: {main_py}")
    print(f"{'='*60}\n")
    
    try:
        # Lancer le script Python
        result = subprocess.run(
            [sys.executable, str(main_py)],
            cwd=str(ai_dir),
            env={**os.environ, "PYTHONUNBUFFERED": "1"}
        )
        
        if result.returncode != 0:
            print(f"\n❌ AI LaGrace s'est arrêtée avec le code {result.returncode}")
            sys.exit(result.returncode)
            
    except KeyboardInterrupt:
        print(f"\n⏹️ AI LaGrace arrêtée par l'utilisateur")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Erreur: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
