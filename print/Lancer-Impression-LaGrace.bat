@echo off
:: Lancer-Impression-LaGrace.bat
:: Lance l'application LA GRACE POS pour traiter les jobs d'impression
:: Double-cliquez pour executer

title LA GRACE POS - Lancement Impression
setlocal

echo.
echo +========================================================================+
echo ^|     [PRINT] LA GRACE POS - LANCEUR D'IMPRESSION                        ^|
echo +========================================================================+
echo.

:: Chemin de l'application installee
set "APP_PATH=C:\Program Files\LA GRACE POS\LA GRACE POS.exe"
set "PRINT_DIR=C:\Glowflixprojet\printer"

:: Verifier si l'application existe
if not exist "%APP_PATH%" (
    echo [ERREUR] Application non trouvee: %APP_PATH%
    echo.
    echo Verifiez que LA GRACE POS est installe.
    pause
    exit /b 1
)

:: Compter les jobs en attente
set count=0
for %%f in ("%PRINT_DIR%\*.json" "%PRINT_DIR%\*.pdf") do set /a count+=1

echo [INFO] Jobs en attente: %count%
echo [INFO] Dossier: %PRINT_DIR%
echo.

:: Lancer l'application (elle traitera automatiquement les jobs)
echo [INFO] Lancement de LA GRACE POS...
start "" "%APP_PATH%"

echo.
echo [OK] Application lancee. Les jobs seront traites automatiquement.
echo.
timeout /t 3 >nul

exit /b 0
