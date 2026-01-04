# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['ai-lagrace\\main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['vosk', 'vosk_cffi'],  # ✅ CRITICAL: Includer vosk et ses dépendances
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
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
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

[ui]
[ui]   ➜  Local:   http://localhost:5173/
[ui]   ➜  Network: http://192.168.2.125:5173/
[electron]    [4.0s] Backend: ⏳ | Vite: ⏳