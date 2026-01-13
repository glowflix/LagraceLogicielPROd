@echo off
setlocal enabledelayedexpansion

echo.
echo ========================================
echo LA GRACE POS - Lancement Complet
echo ========================================
echo.

REM Aller dans le dossier du projet
cd /d "C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1"

echo Dossier: C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1
echo.

REM Activer l'environnement Python
echo [0/3] Activation de l'environnement Python...
call .venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERREUR: Environnement Python non trouvé!
    echo Lancer d'abord: INSTALLER-NOUVEAU-PC.bat
    pause
    exit /b 1
)

REM Vérifier Node.js
echo [1/3] Vérification de Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo ERREUR: Node.js non trouvé!
    pause
    exit /b 1
)

REM Vérifier npm
echo [2/3] Vérification de npm...
where npm >nul 2>nul
if errorlevel 1 (
    echo ERREUR: npm non trouvé!
    pause
    exit /b 1
)

echo [3/3] Lancement de l'application...
echo.
echo ========================================
echo Services actifs:
echo - Frontend: http://localhost:5173
echo - Backend:  http://localhost:3000
echo - IA:       Port 5000
echo ========================================
echo.

REM Lancer l'app
npm run dev

echo.
echo Application arrêtée
pause
