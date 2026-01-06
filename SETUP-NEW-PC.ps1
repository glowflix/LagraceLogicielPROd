# ============================================================================
# 🚀 SCRIPT D'INSTALLATION AUTOMATIQUE - LA GRACE POS
# ============================================================================
# Ce script installe automatiquement tous les outils nécessaires sur un nouveau PC:
# - Node.js 20 LTS
# - Python 3.11
# - SQLite (inclus avec Python)
# - Toutes les dépendances npm
# - L'environnement virtuel Python pour l'IA
# ============================================================================
# USAGE: Exécuter en tant qu'Administrateur
#   powershell -ExecutionPolicy Bypass -File SETUP-NEW-PC.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Couleurs pour le terminal
function Write-Title($text) { Write-Host "`n$('='*70)" -ForegroundColor Cyan; Write-Host "  $text" -ForegroundColor Cyan; Write-Host "$('='*70)`n" -ForegroundColor Cyan }
function Write-Step($text) { Write-Host "➡️  $text" -ForegroundColor Yellow }
function Write-Success($text) { Write-Host "✅ $text" -ForegroundColor Green }
function Write-Error($text) { Write-Host "❌ $text" -ForegroundColor Red }
function Write-Info($text) { Write-Host "ℹ️  $text" -ForegroundColor Gray }

# Dossier du projet (fonctionne si exécuté comme fichier OU collé dans le terminal)
if ($MyInvocation.MyCommand.Path) {
    $PROJECT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    # Si collé directement dans le terminal, utiliser le dossier courant
    $PROJECT_DIR = Get-Location
}
Set-Location $PROJECT_DIR

Write-Title "🚀 INSTALLATION AUTOMATIQUE - LA GRACE POS"
Write-Host "📁 Dossier du projet: $PROJECT_DIR" -ForegroundColor White
Write-Host ""

# ============================================================================
# VÉRIFICATION DES DROITS ADMIN
# ============================================================================
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Ce script doit être exécuté en tant qu'Administrateur!"
    Write-Info "Clic droit sur PowerShell > Exécuter en tant qu'administrateur"
    Write-Host ""
    Write-Host "Relancement automatique en mode Admin..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    exit
}

# ============================================================================
# INSTALLATION DE WINGET (si nécessaire)
# ============================================================================
Write-Title "1️⃣ VÉRIFICATION DE WINGET"

$wingetExists = Get-Command winget -ErrorAction SilentlyContinue
if (-not $wingetExists) {
    Write-Step "Installation de winget (App Installer)..."
    try {
        # Télécharger et installer App Installer depuis le Microsoft Store
        $appInstallerUrl = "https://aka.ms/getwinget"
        $appInstallerPath = "$env:TEMP\Microsoft.DesktopAppInstaller.msixbundle"
        Invoke-WebRequest -Uri $appInstallerUrl -OutFile $appInstallerPath
        Add-AppxPackage -Path $appInstallerPath
        Write-Success "Winget installé!"
    } catch {
        Write-Error "Impossible d'installer winget automatiquement"
        Write-Info "Installer manuellement depuis: https://aka.ms/getwinget"
    }
} else {
    Write-Success "Winget déjà installé"
}

# ============================================================================
# INSTALLATION DE NODE.JS 20 LTS
# ============================================================================
Write-Title "2️⃣ INSTALLATION DE NODE.JS 20 LTS"

$nodeVersion = $null
try {
    $nodeVersion = (node --version 2>$null)
} catch {}

if ($nodeVersion -and $nodeVersion -match "v20") {
    Write-Success "Node.js 20 déjà installé: $nodeVersion"
} elseif ($nodeVersion) {
    Write-Info "Node.js installé mais version différente: $nodeVersion"
    Write-Step "Installation de Node.js 20 LTS via winget..."
    winget install OpenJS.NodeJS.LTS --version 20.18.1 --accept-package-agreements --accept-source-agreements
    Write-Success "Node.js 20 LTS installé!"
    Write-Info "⚠️  Redémarrer le terminal après l'installation pour utiliser node/npm"
} else {
    Write-Step "Installation de Node.js 20 LTS via winget..."
    winget install OpenJS.NodeJS.LTS --version 20.18.1 --accept-package-agreements --accept-source-agreements
    Write-Success "Node.js 20 LTS installé!"
    Write-Info "⚠️  Redémarrer le terminal après l'installation pour utiliser node/npm"
}

# Rafraîchir le PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# ============================================================================
# INSTALLATION DE PYTHON 3.11
# ============================================================================
Write-Title "3️⃣ INSTALLATION DE PYTHON 3.11"

$pythonVersion = $null
try {
    $pythonVersion = (python --version 2>$null)
} catch {}

if ($pythonVersion -and $pythonVersion -match "3\.(10|11|12)") {
    Write-Success "Python déjà installé: $pythonVersion"
} else {
    Write-Step "Installation de Python 3.11 via winget..."
    winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements
    Write-Success "Python 3.11 installé!"
    Write-Info "⚠️  Redémarrer le terminal après l'installation pour utiliser python"
}

# Rafraîchir le PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# ============================================================================
# INSTALLATION DE GIT (optionnel mais recommandé)
# ============================================================================
Write-Title "4️⃣ INSTALLATION DE GIT"

$gitExists = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitExists) {
    Write-Step "Installation de Git..."
    winget install Git.Git --accept-package-agreements --accept-source-agreements
    Write-Success "Git installé!"
} else {
    Write-Success "Git déjà installé: $(git --version)"
}

# Rafraîchir le PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# ============================================================================
# INSTALLATION DES DÉPENDANCES NPM
# ============================================================================
Write-Title "5️⃣ INSTALLATION DES DÉPENDANCES NPM"

# Vérifier que npm est accessible
$npmExists = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmExists) {
    Write-Error "npm non trouvé! Redémarrer le terminal et relancer le script."
    Write-Info "Ou installer manuellement: https://nodejs.org/en/download/"
    pause
    exit 1
}

Write-Step "Installation des dépendances npm (npm install)..."
Set-Location $PROJECT_DIR
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Success "Dépendances npm installées!"
} else {
    Write-Error "Erreur lors de npm install"
}

# ============================================================================
# CRÉATION DE L'ENVIRONNEMENT VIRTUEL PYTHON
# ============================================================================
Write-Title "6️⃣ CONFIGURATION DE L'ENVIRONNEMENT PYTHON (AI LaGrace)"

$venvPath = Join-Path $PROJECT_DIR ".venv"
$aiLagracePath = Join-Path $PROJECT_DIR "ai-lagrace"

if (Test-Path $aiLagracePath) {
    Write-Step "Création de l'environnement virtuel Python..."
    
    # Supprimer l'ancien venv s'il existe
    if (Test-Path $venvPath) {
        Write-Info "Suppression de l'ancien environnement virtuel..."
        Remove-Item -Recurse -Force $venvPath
    }
    
    # Créer le nouveau venv
    python -m venv $venvPath
    
    if (Test-Path $venvPath) {
        Write-Success "Environnement virtuel créé: $venvPath"
        
        # Activer et installer les dépendances
        Write-Step "Installation des dépendances Python pour l'IA..."
        $pipPath = Join-Path $venvPath "Scripts\pip.exe"
        $requirementsPath = Join-Path $aiLagracePath "requirements.txt"
        
        if (Test-Path $requirementsPath) {
            & $pipPath install -r $requirementsPath
            Write-Success "Dépendances Python installées!"
        } else {
            Write-Info "Pas de requirements.txt trouvé dans ai-lagrace"
            # Installer les packages de base
            & $pipPath install flask flask-cors python-socketio requests
            Write-Success "Packages Python de base installés!"
        }
    } else {
        Write-Error "Échec de la création du venv"
    }
} else {
    Write-Info "Dossier ai-lagrace non trouvé, skip de la config Python"
}

# ============================================================================
# CONFIGURATION DU FICHIER .ENV
# ============================================================================
Write-Title "7️⃣ CONFIGURATION DU FICHIER config.env"

$configEnvPath = Join-Path $PROJECT_DIR "config.env"
$configEnvExample = Join-Path $PROJECT_DIR "config.example.env"

if (-not (Test-Path $configEnvPath)) {
    if (Test-Path $configEnvExample) {
        Copy-Item $configEnvExample $configEnvPath
        Write-Success "config.env créé depuis config.example.env"
    } else {
        # Créer un config.env de base
        $defaultConfig = @"
# Configuration LA GRACE POS
PORT=3030
HOST=0.0.0.0
NODE_ENV=development

# Base de données (SQLite - chemin auto-détecté)
# DB_PATH=%APPDATA%\LA GRACE POS\lagrace.db

# Google Sheets Sync (optionnel)
# GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec

# AI LaGrace
AI_LAGRACE_ENABLED=true
AI_LAGRACE_AUTOSTART=false
"@
        Set-Content -Path $configEnvPath -Value $defaultConfig
        Write-Success "config.env créé avec la configuration par défaut"
    }
    Write-Info "📝 Éditer config.env pour personnaliser la configuration"
} else {
    Write-Success "config.env existe déjà"
}

# ============================================================================
# CRÉATION DES DOSSIERS NÉCESSAIRES
# ============================================================================
Write-Title "8️⃣ CRÉATION DES DOSSIERS"

$folders = @(
    "$env:APPDATA\LA GRACE POS",
    "$env:APPDATA\LA GRACE POS\print",
    "$env:APPDATA\LA GRACE POS\logs"
)

foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Write-Success "Dossier créé: $folder"
    } else {
        Write-Info "Dossier existe: $folder"
    }
}

# ============================================================================
# BUILD DU PROJET (optionnel)
# ============================================================================
Write-Title "9️⃣ BUILD DU PROJET"

Write-Host "Voulez-vous builder le projet maintenant? (O/N)" -ForegroundColor Yellow
$buildChoice = Read-Host
if ($buildChoice -eq "O" -or $buildChoice -eq "o" -or $buildChoice -eq "Y" -or $buildChoice -eq "y") {
    Write-Step "Build du frontend (Vite)..."
    npm run build:ui
    
    Write-Step "Build du backend (ESBuild)..."
    npm run build:backend
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Build terminé!"
    } else {
        Write-Error "Erreur lors du build"
    }
} else {
    Write-Info "Build ignoré. Lancer 'npm run build' plus tard."
}

# ============================================================================
# RÉSUMÉ FINAL
# ============================================================================
Write-Title "🎉 INSTALLATION TERMINÉE!"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    ✅ TOUT EST PRÊT!                                  ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║                                                                      ║" -ForegroundColor Green
Write-Host "║  📁 Projet: $($PROJECT_DIR.PadRight(52))║" -ForegroundColor White
Write-Host "║                                                                      ║" -ForegroundColor Green
Write-Host "║  🚀 COMMANDES UTILES:                                                ║" -ForegroundColor Green
Write-Host "║                                                                      ║" -ForegroundColor Green
Write-Host "║     npm run dev          → Démarrer en mode développement           ║" -ForegroundColor Yellow
Write-Host "║     npm run build        → Builder le projet                        ║" -ForegroundColor Yellow
Write-Host "║     npm run electron:dev → Démarrer Electron en dev                 ║" -ForegroundColor Yellow
Write-Host "║     npm run dist         → Créer l'EXE installable                  ║" -ForegroundColor Yellow
Write-Host "║                                                                      ║" -ForegroundColor Green
Write-Host "║  📝 PROCHAINES ÉTAPES:                                               ║" -ForegroundColor Green
Write-Host "║     1. Fermer et rouvrir le terminal (pour charger le PATH)         ║" -ForegroundColor White
Write-Host "║     2. Éditer config.env si nécessaire                              ║" -ForegroundColor White
Write-Host "║     3. Lancer: npm run dev                                          ║" -ForegroundColor White
Write-Host "║                                                                      ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# Vérification finale des versions
Write-Host "`n📊 VERSIONS INSTALLÉES:" -ForegroundColor Cyan
Write-Host "─────────────────────────" -ForegroundColor Gray
try { Write-Host "   Node.js: $(node --version)" -ForegroundColor White } catch { Write-Host "   Node.js: ⚠️ Redémarrer terminal" -ForegroundColor Yellow }
try { Write-Host "   npm:     v$(npm --version)" -ForegroundColor White } catch { Write-Host "   npm:     ⚠️ Redémarrer terminal" -ForegroundColor Yellow }
try { Write-Host "   Python:  $(python --version)" -ForegroundColor White } catch { Write-Host "   Python:  ⚠️ Redémarrer terminal" -ForegroundColor Yellow }
try { Write-Host "   Git:     $(git --version)" -ForegroundColor White } catch { Write-Host "   Git:     Non installé" -ForegroundColor Gray }
Write-Host ""

Write-Host "Appuyez sur une touche pour fermer..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
