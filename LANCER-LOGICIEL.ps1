# LA GRACE POS - Lancement avec PowerShell
# =========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "LA GRACE POS - Lancement Complet" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Aller dans le dossier du projet
$projectPath = "C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1"
Set-Location $projectPath

Write-Host "Dossier: $projectPath" -ForegroundColor Yellow
Write-Host ""

# Activer l'environnement Python
Write-Host "[0/3] Activation de l'environnement Python..." -ForegroundColor Cyan
& .\.venv\Scripts\Activate.ps1

# Vérifier Node.js
Write-Host "[1/3] Vérification de Node.js..." -ForegroundColor Cyan
$nodeCheck = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERREUR: Node.js non trouvé!" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "Node.js: $nodeCheck" -ForegroundColor Green

# Vérifier npm
Write-Host "[2/3] Vérification de npm..." -ForegroundColor Cyan
$npmCheck = npm --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERREUR: npm non trouvé!" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "npm: $npmCheck" -ForegroundColor Green

Write-Host "[3/3] Lancement de l'application..." -ForegroundColor Cyan
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Services actifs:" -ForegroundColor Cyan
Write-Host "- Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "- Backend:  http://localhost:3000" -ForegroundColor Green
Write-Host "- IA:       Port 5000" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Lancer l'app
npm run dev

Write-Host ""
Write-Host "Application arrêtée" -ForegroundColor Yellow
Read-Host "Appuyer sur Entrée pour fermer"
