@echo off
REM INSTALLATION AUTOMATIQUE - LA GRACE PRO
setlocal enabledelayedexpansion
title LA GRACE PRO - Installation Automatique
color 0A
cls

echo.
echo =============================================================================
echo  INSTALLATION AUTOMATIQUE - LA GRACE PRO v1
echo =============================================================================
echo.

REM V?rifier Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo ERREUR: Node.js n'est pas install?!
    echo T?l?charge: https://nodejs.org
    pause
    exit /b 1
)

REM V?rifier Python
where python >nul 2>nul
if errorlevel 1 (
    echo ERREUR: Python n'est pas install?!
    echo T?l?charge: https://www.python.org
    pause
    exit /b 1
)

echo [1/5] npm install...
call npm install
if errorlevel 1 goto :error

echo [2/5] Cr?ation .venv...
if not exist ".venv" (
    call python -m venv .venv
    if errorlevel 1 goto :error
)

echo [3/5] pip install...
call .venv\Scripts\activate.bat
if exist "requirements.txt" (
    call pip install -r requirements.txt
)

echo [4/5] npm run migrate...
call npm run migrate

echo [5/5] npm run dev...
call npm run dev

goto :end

:error
echo ERREUR! Appuyer sur une touche...
pause
exit /b 1

:end
echo.
echo Installation termin?e!
echo.
pause
exit /b 0
