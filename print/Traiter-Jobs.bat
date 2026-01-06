@echo off
:: Traiter-Jobs.bat - Lance directement le traitement des jobs d'impression
:: Peut être utilisé comme raccourci ou tâche planifiée

title LA GRACE POS - Traitement Impression
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════════════════════════╗
echo ║  🖨️  TRAITEMENT DES JOBS D'IMPRESSION - LA GRACE POS                 ║
echo ╚══════════════════════════════════════════════════════════════════════╝
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0LaGracePrintMenu.ps1" -Action process

exit /b 0
