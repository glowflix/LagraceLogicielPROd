# ============================================================================
# 🔧 SETUP RAPIDE - Pour PC avec Node.js et Python déjà installés
# ============================================================================
# Usage: powershell -ExecutionPolicy Bypass -File SETUP-QUICK.ps1
# ============================================================================

$ErrorActionPreference = "Continue"
$PROJECT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $PROJECT_DIR

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       🚀 LA GRACE POS - SETUP RAPIDE                                 ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Vérification des prérequis
Write-Host "📋 Vérification des prérequis..." -ForegroundColor Yellow
Write-Host ""

$hasNode = $false
$hasPython = $false
$hasNpm = $false

try {
    $nodeV = node --version
    Write-Host "   ✅ Node.js: $nodeV" -ForegroundColor Green
    $hasNode = $true
} catch {
    Write-Host "   ❌ Node.js: NON INSTALLÉ" -ForegroundColor Red
}

try {
    $npmV = npm --version
    Write-Host "   ✅ npm: v$npmV" -ForegroundColor Green
    $hasNpm = $true
} catch {
    Write-Host "   ❌ npm: NON INSTALLÉ" -ForegroundColor Red
}

try {
    $pythonV = python --version
    Write-Host "   ✅ Python: $pythonV" -ForegroundColor Green
    $hasPython = $true
} catch {
    Write-Host "   ⚠️  Python: Non installé (optionnel pour l'IA)" -ForegroundColor Yellow
}

Write-Host ""

if (-not $hasNode -or -not $hasNpm) {
    Write-Host "❌ Node.js et npm sont requis!" -ForegroundColor Red
    Write-Host "   Télécharger: https://nodejs.org/en/download/" -ForegroundColor Yellow
    Write-Host "   Ou lancer: INSTALLER-NOUVEAU-PC.bat" -ForegroundColor Yellow
    exit 1
}

# 1. npm install
Write-Host "📦 Installation des dépendances npm..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Dépendances npm installées!" -ForegroundColor Green
} else {
    Write-Host "   ❌ Erreur npm install" -ForegroundColor Red
}

# 2. Créer venv Python (si Python disponible)
if ($hasPython) {
    $venvPath = Join-Path $PROJECT_DIR ".venv"
    $aiLagracePath = Join-Path $PROJECT_DIR "ai-lagrace"
    
    if (Test-Path $aiLagracePath) {
        Write-Host ""
        Write-Host "🐍 Configuration de l'environnement Python..." -ForegroundColor Yellow
        
        if (-not (Test-Path $venvPath)) {
            python -m venv $venvPath
            Write-Host "   ✅ Environnement virtuel créé" -ForegroundColor Green
        }
        
        $requirementsPath = Join-Path $aiLagracePath "requirements.txt"
        if (Test-Path $requirementsPath) {
            & "$venvPath\Scripts\pip.exe" install -r $requirementsPath -q
            Write-Host "   ✅ Dépendances Python installées" -ForegroundColor Green
        }
    }
}

# 3. Créer dossiers de données
Write-Host ""
Write-Host "📁 Création des dossiers de données..." -ForegroundColor Yellow
$dataDir = "$env:APPDATA\LA GRACE POS"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
if (-not (Test-Path "$dataDir\print")) { New-Item -ItemType Directory -Path "$dataDir\print" -Force | Out-Null }
if (-not (Test-Path "$dataDir\logs")) { New-Item -ItemType Directory -Path "$dataDir\logs" -Force | Out-Null }
Write-Host "   ✅ Dossiers créés: $dataDir" -ForegroundColor Green

# 4. Créer config.env si manquant
$configEnvPath = Join-Path $PROJECT_DIR "config.env"
if (-not (Test-Path $configEnvPath)) {
    Write-Host ""
    Write-Host "📝 Création de config.env..." -ForegroundColor Yellow
    $defaultConfig = @"
PORT=3030
HOST=0.0.0.0
NODE_ENV=development
AI_LAGRACE_ENABLED=true
AI_LAGRACE_AUTOSTART=false
"@
    Set-Content -Path $configEnvPath -Value $defaultConfig
    Write-Host "   ✅ config.env créé" -ForegroundColor Green
}

# Résumé
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    ✅ SETUP TERMINÉ!                                  ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║                                                                      ║" -ForegroundColor Green
Write-Host "║   🚀 Démarrer le projet:                                             ║" -ForegroundColor Green
Write-Host "║                                                                      ║" -ForegroundColor Green
Write-Host "║      npm run dev          → Mode développement                       ║" -ForegroundColor Yellow
Write-Host "║      npm run build        → Builder le projet                        ║" -ForegroundColor Yellow
Write-Host "║      npm run electron:dev → Electron en mode dev                     ║" -ForegroundColor Yellow
Write-Host "║                                                                      ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
