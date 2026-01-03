@echo off
REM BUILD-PRO.bat - Build pro complet pour LA GRACE POS

setlocal enabledelayedexpansion

REM Couleurs
echo.
echo ========================================
echo   BUILD PRO - LA GRACE POS
echo ========================================
echo.

REM Vérifier Node
echo [1/5] Vérification de Node.js...
node --version > nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js non trouvé. Installez Node.js ^>= 16
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo OK: %NODE_VERSION%

REM Vérifier npm
echo [2/5] Vérification de npm...
npm --version > nul 2>&1
if errorlevel 1 (
    echo ERROR: npm non trouvé
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo OK: npm %NPM_VERSION%

REM Vérifier venv
echo [3/5] Vérification du venv Python...
if not exist ".venv\Scripts\activate.bat" (
    echo ERROR: .venv non trouvé
    echo Creez un venv avec: python -m venv .venv
    exit /b 1
)
echo OK: .venv trouve

REM Activer venv et installer PyInstaller
echo [4/5] Activation du venv et preparation...
call .venv\Scripts\activate.bat
python -m pip install -q pyinstaller 2>nul

REM Lancer le build npm complet
echo [5/5] Lancement du build complet (UI + IA + Electron)...
echo.
echo ========================================
echo   PHASE 1: BUILD UI (Vite)
echo ========================================
call npm run build:ui
if errorlevel 1 (
    echo ERROR: build:ui a echoue
    exit /b 1
)

echo.
echo ========================================
echo   PHASE 2: BUILD IA (PyInstaller)
echo ========================================
call npm run build:ai
if errorlevel 1 (
    echo ERROR: build:ai a echoue
    exit /b 1
)

echo.
echo ========================================
echo   PHASE 3: BUILD ELECTRON
echo ========================================
call npm run build:electron
if errorlevel 1 (
    echo ERROR: build:electron a echoue
    exit /b 1
)

echo.
echo ========================================
echo   BUILD COMPLET REUSSI!
echo ========================================
echo.
echo Installation trouvee:
dir /b dist-electron\*.exe 2>nul
echo.
echo Prochaine etape:
echo   - Tester: dist-electron\LA GRACE POS Setup *.exe
echo   - Ou distribuer le fichier .exe
echo.
pause
