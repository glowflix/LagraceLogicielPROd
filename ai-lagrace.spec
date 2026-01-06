# -*- mode: python ; coding: utf-8 -*-
# AI LaGrace - PyInstaller Spec File
# Build avec: pyinstaller ai-lagrace.spec
# Les modèles Piper, Vosk et config sont inclus automatiquement

import os
import sys
from pathlib import Path

# Chemin de base
BASE_DIR = os.path.dirname(os.path.abspath(SPEC))
AI_DIR = os.path.join(BASE_DIR, 'ai-lagrace')

# Trouver le dossier site-packages pour piper
def find_piper_binaries():
    """Trouver les binaires piper dans l'environnement virtuel"""
    binaries = []
    try:
        import piper
        piper_dir = Path(piper.__file__).parent
        # Inclure tous les fichiers DLL/pyd de piper
        for ext in ['*.dll', '*.pyd', '*.so']:
            for f in piper_dir.glob(ext):
                binaries.append((str(f), 'piper'))
        # Inclure le sous-dossier tashkeel si présent
        tashkeel_dir = piper_dir / 'tashkeel'
        if tashkeel_dir.exists():
            for f in tashkeel_dir.glob('*'):
                if f.is_file():
                    binaries.append((str(f), 'piper/tashkeel'))
    except ImportError:
        print("WARNING: piper not found, skipping piper binaries")
    return binaries

def find_vosk_binaries():
    """Trouver les binaires vosk dans l'environnement virtuel"""
    binaries = []
    datas = []
    try:
        import vosk
        vosk_dir = Path(vosk.__file__).parent
        print(f"[OK] Vosk trouve: {vosk_dir}")
        # Inclure TOUT le dossier vosk (DLL + autres fichiers)
        for f in vosk_dir.glob('*'):
            if f.is_file():
                if f.suffix in ['.dll', '.pyd', '.so']:
                    binaries.append((str(f), 'vosk'))
                else:
                    datas.append((str(f), 'vosk'))
        # Inclure les sous-dossiers
        for subdir in vosk_dir.iterdir():
            if subdir.is_dir():
                datas.append((str(subdir), f'vosk/{subdir.name}'))
    except ImportError:
        print("WARNING: vosk not found, skipping vosk binaries")
    return binaries, datas

# Binaires Piper
binaries = find_piper_binaries()

# Binaires et données Vosk
vosk_binaries, vosk_datas = find_vosk_binaries()
binaries.extend(vosk_binaries)

# Données à inclure (modèles, config, etc.)
datas = [
    # Modèles Piper (TTS offline) - VOIX UPMC et SIWIS
    (os.path.join(AI_DIR, 'models', 'piper'), 'models/piper'),
    # Configuration
    (os.path.join(AI_DIR, 'config'), 'config'),
    # Services (pour imports dynamiques)
    (os.path.join(AI_DIR, 'services'), 'services'),
]

# Ajouter les données vosk
datas.extend(vosk_datas)

# Ajouter le modèle Vosk si présent
vosk_model = os.path.join(AI_DIR, 'models', 'vosk-model-small-fr-0.22')
if os.path.exists(vosk_model):
    datas.append((vosk_model, 'models/vosk-model-small-fr-0.22'))
    print(f"[OK] Modele Vosk trouve: {vosk_model}")
else:
    print(f"[WARN] Modele Vosk non trouve: {vosk_model}")

# Hidden imports pour les modules compilés
hidden_imports = [
    'vosk',
    'vosk_cffi',
    'sounddevice',
    'numpy',
    'piper',
    'piper.voice',
    'onnxruntime',
    'scipy',
    'scipy.signal',
    'scipy.ndimage',
    'soundfile',
    'socketio',
    'engineio',
    'colorama',
]

a = Analysis(
    [os.path.join(AI_DIR, 'main.py')],
    pathex=[AI_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ai-lagrace',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # True pour voir les logs en cas de problème
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(BASE_DIR, 'asset', 'image', 'icon', 'photo.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ai-lagrace',
)
