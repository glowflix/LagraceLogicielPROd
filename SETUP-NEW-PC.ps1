# ============================================================================
# SCRIPT D'INSTALLATION AUTOMATIQUE - LA GRACE POS
# ============================================================================
# Ce script installe automatiquement tous les outils necessaires:
# - Node.js 20 LTS (pour npm, React, Electron)
# - Python 3.11 (pour l'IA)
# - Git
# - Toutes les dependances npm (React, Electron, Vite, etc.)
# - L'environnement virtuel Python pour l'IA
# ============================================================================
# USAGE: Executer en tant qu'Administrateur
#   powershell -ExecutionPolicy Bypass -File SETUP-NEW-PC.ps1
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# Couleurs pour le terminal
function Write-Title($text) { 
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host ""
}
function Write-Step($text) { Write-Host "[>] $text" -ForegroundColor Yellow }
function Write-OK($text) { Write-Host "[OK] $text" -ForegroundColor Green }
function Write-Err($text) { Write-Host "[X] $text" -ForegroundColor Red }
function Write-Info($text) { Write-Host "[i] $text" -ForegroundColor Gray }

# Dossier du projet
if ($MyInvocation.MyCommand.Path) {
    $PROJECT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $PROJECT_DIR = (Get-Location).Path
}

Write-Title "INSTALLATION AUTOMATIQUE - LA GRACE POS"
Write-Host "Dossier du projet: $PROJECT_DIR" -ForegroundColor White
Write-Host ""

# Aller dans le dossier du projet
Set-Location $PROJECT_DIR

# ============================================================================
# VERIFICATION DES DROITS ADMIN
# ============================================================================
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "Ce script doit etre execute en tant qu'Administrateur!"
    Write-Info "Clic droit sur PowerShell > Executer en tant qu'administrateur"
    Write-Host ""
    Write-Host "Relancement automatique en mode Admin..." -ForegroundColor Yellow
    
    $scriptPath = $MyInvocation.MyCommand.Path
    if ($scriptPath) {
        Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$scriptPath`""
        exit
    } else {
        Write-Host "Veuillez relancer manuellement en mode Administrateur" -ForegroundColor Red
        pause
        exit
    }
}

Write-OK "Droits administrateur OK"

# ============================================================================
# 1. INSTALLATION DE WINGET (si necessaire)
# ============================================================================
Write-Title "1. VERIFICATION DE WINGET"

$wingetExists = Get-Command winget -ErrorAction SilentlyContinue
if (-not $wingetExists) {
    Write-Step "Installation de winget (App Installer)..."
    try {
        $appInstallerUrl = "https://aka.ms/getwinget"
        $appInstallerPath = "$env:TEMP\Microsoft.DesktopAppInstaller.msixbundle"
        Invoke-WebRequest -Uri $appInstallerUrl -OutFile $appInstallerPath -UseBasicParsing
        Add-AppxPackage -Path $appInstallerPath
        Write-OK "Winget installe!"
    } catch {
        Write-Err "Impossible d'installer winget automatiquement"
        Write-Info "Installer manuellement depuis: https://aka.ms/getwinget"
        Write-Info "Puis relancer ce script"
        pause
        exit 1
    }
} else {
    Write-OK "Winget deja installe"
}

# ============================================================================
# 2. INSTALLATION DE NODE.JS 20 LTS
# ============================================================================
Write-Title "2. INSTALLATION DE NODE.JS 20 LTS"

$nodeVersion = $null
try {
    $nodeVersion = (node --version 2>$null)
} catch {}

if ($nodeVersion -and $nodeVersion -match "v(18|20|22)") {
    Write-OK "Node.js deja installe: $nodeVersion"
} else {
    if ($nodeVersion) {
        Write-Info "Node.js installe mais version differente: $nodeVersion"
    }
    Write-Step "Installation de Node.js 20 LTS via winget..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Node.js 20 LTS installe!"
    } else {
        Write-Err "Erreur installation Node.js - Essai avec installeur direct..."
        # Fallback: telecharger directement
        $nodeUrl = "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi"
        $nodeMsi = "$env:TEMP\node-v20.18.1-x64.msi"
        Write-Step "Telechargement de Node.js..."
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        Write-Step "Installation de Node.js..."
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn" -Wait
        Write-OK "Node.js installe via MSI!"
    }
    Write-Info "Redemarrer le terminal apres l'installation pour utiliser node/npm"
}

# Rafraichir le PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# ============================================================================
# 3. INSTALLATION DE PYTHON 3.11
# ============================================================================
Write-Title "3. INSTALLATION DE PYTHON 3.11"

$pythonVersion = $null
try {
    $pythonVersion = (python --version 2>$null)
} catch {}

if ($pythonVersion -and $pythonVersion -match "3\.(10|11|12|13)") {
    Write-OK "Python deja installe: $pythonVersion"
} else {
    Write-Step "Installation de Python 3.11 via winget..."
    winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements --silent
    
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Python 3.11 installe!"
    } else {
        Write-Err "Erreur installation Python via winget"
        Write-Info "Installer manuellement depuis: https://www.python.org/downloads/"
    }
    Write-Info "Redemarrer le terminal apres l'installation pour utiliser python"
}

# Rafraichir le PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# ============================================================================
# 4. INSTALLATION DE GIT
# ============================================================================
Write-Title "4. INSTALLATION DE GIT"

$gitExists = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitExists) {
    Write-Step "Installation de Git..."
    winget install Git.Git --accept-package-agreements --accept-source-agreements --silent
    
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Git installe!"
    } else {
        Write-Info "Git optionnel - continuer sans Git"
    }
} else {
    Write-OK "Git deja installe: $(git --version)"
}

# Rafraichir le PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# ============================================================================
# 5. INSTALLATION DES DEPENDANCES NPM (React, Electron, Vite, etc.)
# ============================================================================
Write-Title "5. INSTALLATION DES DEPENDANCES NPM"

# Verifier que npm est accessible
$npmExists = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmExists) {
    Write-Err "npm non trouve!"
    Write-Info "Fermer ce terminal, en ouvrir un nouveau, et relancer le script"
    Write-Info "Ou installer Node.js manuellement: https://nodejs.org/en/download/"
    pause
    exit 1
}

Write-OK "npm trouve: v$(npm --version)"

Write-Step "Installation des dependances npm (React, Electron, Vite, etc.)..."
Write-Info "Cela peut prendre quelques minutes..."

Set-Location $PROJECT_DIR
npm install 2>&1 | Out-Host

if ($LASTEXITCODE -eq 0) {
    Write-OK "Dependances npm installees!"
    Write-Info "  - React (UI)"
    Write-Info "  - Electron (application desktop)"
    Write-Info "  - Vite (bundler)"
    Write-Info "  - Express (serveur backend)"
    Write-Info "  - SQLite (better-sqlite3)"
    Write-Info "  - Socket.IO (temps reel)"
} else {
    Write-Err "Erreur lors de npm install"
    Write-Info "Essayer: npm install --legacy-peer-deps"
}

# ============================================================================
# 6. CREATION DE L'ENVIRONNEMENT VIRTUEL PYTHON (pour l'IA)
# ============================================================================
Write-Title "6. CONFIGURATION PYTHON (AI LaGrace)"

$venvPath = Join-Path $PROJECT_DIR ".venv"
$aiLagracePath = Join-Path $PROJECT_DIR "ai-lagrace"

# Verifier si Python est disponible
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Info "Python non disponible - skip configuration IA"
    Write-Info "Installer Python et relancer le script pour configurer l'IA"
} elseif (Test-Path $aiLagracePath) {
    Write-Step "Creation de l'environnement virtuel Python..."
    
    # TOUJOURS supprimer l'ancien venv pour eviter les problemes de pip corrompu
    if (Test-Path $venvPath) {
        Write-Info "Suppression de l'ancien environnement virtuel (evite pip corrompu)..."
        # Fermer tous les processus Python qui pourraient utiliser le venv
        Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*$venvPath*" } | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
        Remove-Item -Recurse -Force $venvPath -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    
    # Creer le nouveau venv
    Write-Step "Creation du venv..."
    python -m venv $venvPath
    
    if (Test-Path $venvPath) {
        Write-OK "Environnement virtuel cree: $venvPath"
        
        $pythonPath = Join-Path $venvPath "Scripts\python.exe"
        $requirementsPath = Join-Path $aiLagracePath "requirements.txt"
        
        # ETAPE 1: Mettre a jour pip en utilisant python -m pip (evite pip.exe corrompu)
        Write-Step "Mise a jour de pip (via python -m pip)..."
        & $pythonPath -m pip install --upgrade pip --quiet 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-OK "pip mis a jour"
        } else {
            Write-Info "pip deja a jour ou erreur mineure"
        }
        
        # ETAPE 2: Installer les dependances en utilisant python -m pip
        Write-Step "Installation des dependances Python pour l'IA..."
        
        # Installer les packages principaux un par un pour eviter les erreurs
        $packages = @(
            "python-socketio[client]",
            "aiohttp",
            "requests", 
            "vosk",
            "sounddevice",
            "numpy",
            "pyttsx3",
            "soundfile",
            "scipy",
            "webrtcvad",
            "python-dotenv",
            "colorama",
            "onnxruntime",
            "websocket-client"
        )
        
        $failedPackages = @()
        foreach ($pkg in $packages) {
            Write-Host "  Installing $pkg..." -ForegroundColor Gray -NoNewline
            $result = & $pythonPath -m pip install $pkg --quiet 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host " OK" -ForegroundColor Green
            } else {
                Write-Host " SKIP" -ForegroundColor Yellow
                $failedPackages += $pkg
            }
        }
        
        # Essayer piper-tts separement (optionnel, peut echouer)
        Write-Host "  Installing piper-tts (optionnel)..." -ForegroundColor Gray -NoNewline
        & $pythonPath -m pip install piper-tts --quiet 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host " OK" -ForegroundColor Green
        } else {
            Write-Host " SKIP (Windows TTS sera utilise)" -ForegroundColor Yellow
        }
        
        # ETAPE 3: Verification de l'installation
        Write-Step "Verification de l'installation Python..."
        $testResult = & $pythonPath -c "import socketio; import numpy; import requests; print('OK')" 2>&1
        if ($testResult -match "OK") {
            Write-OK "Dependances Python installees et verifiees!"
            if ($failedPackages.Count -gt 0) {
                Write-Info "Packages optionnels non installes: $($failedPackages -join ', ')"
            }
        } else {
            Write-Err "Certains modules Python manquent"
            Write-Info "Erreur: $testResult"
            Write-Info "Essayer manuellement: .\.venv\Scripts\python.exe -m pip install -r ai-lagrace\requirements.txt"
        }
    } else {
        Write-Err "Echec de la creation du venv"
        Write-Info "Verifier que Python est correctement installe"
    }
} else {
    Write-Info "Dossier ai-lagrace non trouve - skip configuration IA"
}

# ============================================================================
# 7. CONFIGURATION DU FICHIER config.env
# ============================================================================
Write-Title "7. CONFIGURATION config.env"

$configEnvPath = Join-Path $PROJECT_DIR "config.env"

if (-not (Test-Path $configEnvPath)) {
    Write-Step "Creation de config.env..."
    
    $defaultConfig = @"
# Configuration LA GRACE POS
PORT=3030
HOST=0.0.0.0
NODE_ENV=development

# Base de donnees SQLite (chemin auto-detecte)
# DB_PATH=%APPDATA%\LA GRACE POS\lagrace.db

# Google Sheets Sync (optionnel)
# GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec

# AI LaGrace
AI_LAGRACE_ENABLED=true
AI_LAGRACE_AUTOSTART=false
"@
    Set-Content -Path $configEnvPath -Value $defaultConfig -Encoding UTF8
    Write-OK "config.env cree avec la configuration par defaut"
    Write-Info "Editer config.env pour personnaliser"
} else {
    Write-OK "config.env existe deja"
}

# ============================================================================
# 8. CREATION DES DOSSIERS NECESSAIRES
# ============================================================================
Write-Title "8. CREATION DES DOSSIERS"

$folders = @(
    "$env:APPDATA\LA GRACE POS",
    "$env:APPDATA\LA GRACE POS\print",
    "$env:APPDATA\LA GRACE POS\logs"
)

foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Write-OK "Dossier cree: $folder"
    } else {
        Write-Info "Dossier existe: $folder"
    }
}

# ============================================================================
# 9. BUILD DU PROJET (optionnel)
# ============================================================================
Write-Title "9. BUILD DU PROJET"

Write-Host ""
Write-Host "Voulez-vous builder le projet maintenant? (O/N)" -ForegroundColor Yellow
$buildChoice = Read-Host

if ($buildChoice -eq "O" -or $buildChoice -eq "o" -or $buildChoice -eq "Y" -or $buildChoice -eq "y") {
    Write-Step "Build du projet..."
    
    npm run build 2>&1 | Out-Host
    
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Build termine!"
    } else {
        Write-Err "Erreur lors du build - verifier les erreurs ci-dessus"
    }
} else {
    Write-Info "Build ignore. Lancer 'npm run build' plus tard."
}

# ============================================================================
# RESUME FINAL
# ============================================================================
Write-Title "INSTALLATION TERMINEE!"

# Verification finale automatique
Write-Step "Verification finale de l'installation..."

$allOK = $true

# Verifier Node.js
try { 
    $nv = node --version 2>$null
    if ($nv) {
        Write-OK "Node.js: $nv"
    } else {
        Write-Err "Node.js: NON INSTALLE"
        $allOK = $false
    }
} catch { 
    Write-Err "Node.js: NON TROUVE (redemarrer terminal)"
    $allOK = $false
}

# Verifier npm
try { 
    $npmv = npm --version 2>$null
    if ($npmv) {
        Write-OK "npm: v$npmv"
    } else {
        Write-Err "npm: NON INSTALLE"
        $allOK = $false
    }
} catch { 
    Write-Err "npm: NON TROUVE (redemarrer terminal)"
    $allOK = $false
}

# Verifier Python
try { 
    $pyv = python --version 2>$null
    if ($pyv) {
        Write-OK "Python: $pyv"
    } else {
        Write-Info "Python: NON INSTALLE (optionnel pour l'IA)"
    }
} catch { 
    Write-Info "Python: NON TROUVE (optionnel)"
}

# Verifier Git
try { 
    $gv = git --version 2>$null
    if ($gv) {
        Write-OK "Git: $gv"
    } else {
        Write-Info "Git: NON INSTALLE (optionnel)"
    }
} catch { 
    Write-Info "Git: NON TROUVE (optionnel)"
}

# Verifier node_modules
if (Test-Path (Join-Path $PROJECT_DIR "node_modules")) {
    $nodeModulesCount = (Get-ChildItem (Join-Path $PROJECT_DIR "node_modules") -Directory).Count
    Write-OK "node_modules: $nodeModulesCount packages installes"
} else {
    Write-Err "node_modules: MANQUANT - relancer npm install"
    $allOK = $false
}

# Verifier venv Python
$venvPython = Join-Path $PROJECT_DIR ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    $venvTest = & $venvPython -c "import socketio; print('OK')" 2>&1
    if ($venvTest -match "OK") {
        Write-OK "Python venv: OK (socketio installe)"
    } else {
        Write-Info "Python venv: Certains modules manquent"
    }
} else {
    Write-Info "Python venv: Non configure (IA optionnelle)"
}

Write-Host ""

if ($allOK) {
    Write-Host "========================================================================" -ForegroundColor Green
    Write-Host "                    TOUT EST PRET!                                      " -ForegroundColor Green
    Write-Host "========================================================================" -ForegroundColor Green
} else {
    Write-Host "========================================================================" -ForegroundColor Yellow
    Write-Host "           INSTALLATION PARTIELLE - VERIFIER LES ERREURS               " -ForegroundColor Yellow
    Write-Host "========================================================================" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Projet: $PROJECT_DIR" -ForegroundColor White
Write-Host ""
Write-Host "  COMPOSANTS:" -ForegroundColor Cyan
Write-Host "    - Node.js 20 LTS (npm, npx)" -ForegroundColor White
Write-Host "    - React + Vite (frontend)" -ForegroundColor White
Write-Host "    - Electron (application desktop)" -ForegroundColor White
Write-Host "    - Express + SQLite (backend)" -ForegroundColor White
Write-Host "    - Python + venv (IA optionnel)" -ForegroundColor White
Write-Host ""
Write-Host "  COMMANDES UTILES:" -ForegroundColor Cyan
Write-Host ""
Write-Host "    npm run dev           - Demarrer en mode developpement" -ForegroundColor Yellow
Write-Host "    npm run build         - Builder le projet" -ForegroundColor Yellow
Write-Host "    npm run electron:dev  - Demarrer Electron en dev" -ForegroundColor Yellow
Write-Host "    npm run dist          - Creer l'EXE installable" -ForegroundColor Yellow
Write-Host ""
Write-Host "  PROCHAINES ETAPES:" -ForegroundColor Cyan
Write-Host "    1. FERMER et ROUVRIR le terminal (charger le PATH)" -ForegroundColor White
Write-Host "    2. Editer config.env si necessaire" -ForegroundColor White
Write-Host "    3. Lancer: npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Appuyez sur une touche pour fermer..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
