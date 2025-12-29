@echo off
REM ===================================
REM AI LaGrace - Script de demarrage
REM ===================================
chcp 65001 >nul 2>&1
title AI LaGrace - Assistant Vocal

echo.
echo ╔════════════════════════════════════════════╗
echo ║     AI LaGrace - Assistant Vocal          ║
echo ║     Pour La Grace POS                     ║
echo ╚════════════════════════════════════════════╝
echo.

REM Verifier Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python n'est pas installe!
    echo    Installez Python 3.8+ depuis python.org
    pause
    exit /b 1
)

echo ✅ Python trouve

REM Aller dans le repertoire du script
cd /d "%~dp0"

REM Verifier le modele Vosk
if not exist "models\vosk-model-small-fr-0.22" (
    echo.
    echo ⚠️  Modele Vosk non trouve!
    echo    Telechargez-le depuis:
    echo    https://alphacephei.com/vosk/models
    echo.
    echo    Puis extrayez "vosk-model-small-fr-0.22" dans le dossier "models"
    echo.
    pause
)

REM Verifier les dependances
echo.
echo 🔄 Verification des dependances...
pip show vosk >nul 2>&1
if errorlevel 1 (
    echo 📦 Installation des dependances...
    pip install -r requirements.txt
)

REM Demarrer l'assistant
echo.
echo 🚀 Demarrage de AI LaGrace...
echo    Dites "LaGrace" pour activer l'assistant
echo.
python main.py

pause


