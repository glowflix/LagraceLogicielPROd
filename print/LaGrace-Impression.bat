@echo off
:: LaGrace-Impression.bat - Lanceur rapide du gestionnaire d'impression
:: Double-cliquez sur ce fichier pour ouvrir le menu d'impression

title LA GRACE POS - Impression
cd /d "%~dp0"

:: Vérifier si PowerShell est disponible
where powershell >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ PowerShell non trouvé!
    pause
    exit /b 1
)

:: Lancer le menu PowerShell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0LaGracePrintMenu.ps1" -Action menu

exit /b 0
