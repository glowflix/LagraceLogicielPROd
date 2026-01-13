@echo off
REM Lance le serveur avec npm run dev - Equivalent du batch original
REM Aller dans le dossier du projet
cd /d "D:\logiciel\La Grace pro\v1"

REM Lancer npm run dev dans une nouvelle fenêtre (comme lance serveur (1).bat)
REM /k = garder la fenêtre ouverte après execution
start cmd /k "npm run dev"
