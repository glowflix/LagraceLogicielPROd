@echo off
setlocal enabledelayedexpansion

echo.
echo ========================================
echo LA GRACE POS - Demarrage complet
echo ========================================
echo.

echo [1/3] Demarrage du serveur backend...
start "LA GRACE Backend" cmd /k "cd /d "%~dp0" && npm run start"

echo [2/3] Attente de 5 secondes (serveur initialisation)...
timeout /t 5 /nobreak

echo [3/3] Demarrage de l'Interface utilisateur...
timeout /t 2 /nobreak
cd /d "%~dp0"
start "" "dist-electron\win-unpacked\LA GRACE POS.exe"

echo.
echo ========================================
echo Services lancés! 
echo Backend: http://localhost:3030
echo UI: Fenêtre Electron
echo ========================================
echo.
echo Ferme cette fenêtre quand tu as fini.
pause

