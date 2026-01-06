@echo off
:: ============================================================================
:: INSTALLATION AUTOMATIQUE - LA GRACE POS
:: Double-cliquer sur ce fichier pour installer tout automatiquement
:: ============================================================================

title LA GRACE POS - Installation Automatique
color 0A

echo.
echo  ╔══════════════════════════════════════════════════════════════════════╗
echo  ║       🚀 LA GRACE POS - INSTALLATION AUTOMATIQUE                     ║
echo  ║                                                                      ║
echo  ║   Ce script va installer automatiquement:                            ║
echo  ║   - Node.js 20 LTS                                                   ║
echo  ║   - Python 3.11                                                      ║
echo  ║   - Git                                                              ║
echo  ║   - Toutes les dependances npm                                       ║
echo  ║   - L'environnement Python pour l'IA                                 ║
echo  ║                                                                      ║
echo  ╚══════════════════════════════════════════════════════════════════════╝
echo.
echo  ⚠️  Le script va demander les droits Administrateur
echo.
pause

:: Lancer le script PowerShell en Admin
powershell -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File \"%~dp0SETUP-NEW-PC.ps1\"'"
