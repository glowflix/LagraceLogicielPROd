@echo off
cd "C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1"
npm run dev
pause

echo.
echo ╔═══════════════════════════════════════════════════════════════════════════╗
echo ║                   🚀 LANCEMENT - LA GRACE PRO                            ║
echo ╚═══════════════════════════════════════════════════════════════════════════╝
echo.

REM ═══════════════════════════════════════════════════════════════════════════
REM ALLER DANS LE BON DOSSIER
REM ═══════════════════════════════════════════════════════════════════════════

cd /d "C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1"

if errorlevel 1 (
    echo ❌ ERREUR: Impossible d'aller dans le dossier!
    echo 📁 Chemin: C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1
    echo.
    pause
    exit /b 1
)

echo ✅ Dossier: %cd%
echo.

REM ═══════════════════════════════════════════════════════════════════════════
REM ACTIVER L'ENVIRONNEMENT PYTHON
REM ═══════════════════════════════════════════════════════════════════════════

echo Activation de l'environnement Python...
call .venv\Scripts\activate.bat

if errorlevel 1 (
    echo ⚠️  Python n'a pas pu être activé (ce n'est pas grave)
)

echo.

REM ═══════════════════════════════════════════════════════════════════════════
REM LANCER L'APP
REM ═══════════════════════════════════════════════════════════════════════════

echo.
echo ╔═══════════════════════════════════════════════════════════════════════════╗
echo ║ Lancement de npm run dev...                                              ║
echo ╚═══════════════════════════════════════════════════════════════════════════╝
echo.
echo 🚀 L'application démarre...
echo.
echo ℹ️  Frontend: http://localhost:5173
echo ℹ️  Backend:  http://localhost:3000
echo.
echo ⏹️  Appuyer sur CTRL+C pour arrêter
echo.

call npm run dev

if errorlevel 1 (
    echo.
    echo ❌ ERREUR lors du lancement!
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Application fermée
echo.
pause
exit /b 0
