# ===================================
# AI LaGrace - Script de demarrage PowerShell
# ===================================

$Host.UI.RawUI.WindowTitle = "AI LaGrace - Assistant Vocal"

Write-Host ""
Write-Host "╔════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     AI LaGrace - Assistant Vocal          ║" -ForegroundColor Cyan
Write-Host "║     Pour La Grace POS                     ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Verifier Python
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✅ $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Python n'est pas installe!" -ForegroundColor Red
    Write-Host "   Installez Python 3.8+ depuis python.org" -ForegroundColor Yellow
    Read-Host "Appuyez sur Entree pour quitter"
    exit 1
}

# Aller dans le repertoire du script
Set-Location $PSScriptRoot

# Verifier le modele Vosk
if (-not (Test-Path "models\vosk-model-small-fr-0.22")) {
    Write-Host ""
    Write-Host "⚠️  Modele Vosk non trouve!" -ForegroundColor Yellow
    Write-Host "   Telechargez-le depuis:" -ForegroundColor Yellow
    Write-Host "   https://alphacephei.com/vosk/models" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   Puis extrayez 'vosk-model-small-fr-0.22' dans le dossier 'models'" -ForegroundColor Yellow
    Write-Host ""
}

# Verifier les dependances
Write-Host ""
Write-Host "🔄 Verification des dependances..." -ForegroundColor Cyan

$vosk = pip show vosk 2>$null
if (-not $vosk) {
    Write-Host "📦 Installation des dependances..." -ForegroundColor Yellow
    pip install -r requirements.txt
}

# Creer le dossier models s'il n'existe pas
if (-not (Test-Path "models")) {
    New-Item -ItemType Directory -Path "models" -Force | Out-Null
    Write-Host "📁 Dossier 'models' cree" -ForegroundColor Green
}

# Demarrer l'assistant
Write-Host ""
Write-Host "🚀 Demarrage de AI LaGrace..." -ForegroundColor Green
Write-Host "   Dites 'LaGrace' pour activer l'assistant" -ForegroundColor Cyan
Write-Host ""

python main.py

Read-Host "Appuyez sur Entree pour quitter"
