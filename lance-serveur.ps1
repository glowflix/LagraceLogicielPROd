# Lance le serveur avec npm run dev dans une nouvelle fenêtre
# Équivalent PowerShell de: start cmd /k "npm run dev"

# Dossier du projet (même que dans le batch)
$projectPath = "C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1"

Write-Host "Dossier: $projectPath" -ForegroundColor Cyan
Write-Host "Lancement du serveur..." -ForegroundColor Green
Write-Host ""

# Lance npm run dev dans une nouvelle fenêtre PowerShell
Start-Process PowerShell -ArgumentList "-NoExit", "-Command", "cd '$projectPath'; npm run dev"
