# BUILD-PRO.ps1
# Script PowerShell pour build pro complet avec vérifications

param(
    [switch]$Clean = $false,
    [switch]$NoPack = $false,
    [switch]$SkipAI = $false
)

$ErrorActionPreference = "Stop"
$WarningPreference = "Continue"

# Couleurs
$Green = @{ ForegroundColor = 'Green' }
$Red = @{ ForegroundColor = 'Red' }
$Yellow = @{ ForegroundColor = 'Yellow' }
$Cyan = @{ ForegroundColor = 'Cyan' }

function Write-Header {
    param([string]$Message)
    Write-Host "`n========================================" @Cyan
    Write-Host "  $Message" @Cyan
    Write-Host "========================================`n" @Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" @Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" @Red
    exit 1
}

function Write-Warn {
    param([string]$Message)
    Write-Host "⚠️  $Message" @Yellow
}

# ============================================
# PHASE 0: NETTOYAGE (optionnel)
# ============================================

if ($Clean) {
    Write-Header "PHASE 0: NETTOYAGE"
    Write-Host "Suppression des dossiers de build..."
    Remove-Item -Path "dist", "dist-electron", "build", ".next" -Force -Recurse -ErrorAction SilentlyContinue
    Write-Success "Dossiers de build supprimés"
}

# ============================================
# PHASE 1: VÉRIFICATIONS PRÉREQUIS
# ============================================

Write-Header "PHASE 1: VÉRIFICATIONS PRÉREQUIS"

# Vérifier Node
Write-Host "Vérification de Node.js..."
$nodeVersion = (node --version 2>$null)
if (-not $nodeVersion) {
    Write-Error "Node.js non trouvé. Installez Node.js ≥16"
}
Write-Success "Node.js: $nodeVersion"

# Vérifier npm
Write-Host "Vérification de npm..."
$npmVersion = (npm --version 2>$null)
if (-not $npmVersion) {
    Write-Error "npm non trouvé"
}
Write-Success "npm: $npmVersion"

# Vérifier Python (pour build:ai)
if (-not $SkipAI) {
    Write-Host "Vérification de Python..."
    if (-not (Test-Path ".venv\Scripts\activate.ps1")) {
        Write-Error ".venv non trouvé. Créez un venv: python -m venv .venv"
    }
    Write-Success ".venv trouvé"
    
    # Activer venv
    Write-Host "Activation du venv..."
    & .\.venv\Scripts\Activate.ps1
    $pythonVersion = (python --version 2>&1)
    Write-Success "Python: $pythonVersion"
    
    # Vérifier PyInstaller
    Write-Host "Vérification de PyInstaller..."
    $hasPI = (pip list | findstr /C:"pyinstaller" 2>$null)
    if (-not $hasPI) {
        Write-Warn "PyInstaller non trouvé, installation..."
        pip install -q pyinstaller
    }
    $piVersion = (pyinstaller --version 2>&1)
    Write-Success "PyInstaller: $piVersion"
}

Write-Success "Tous les prérequis sont OK"

# ============================================
# PHASE 2: INSTALLER DEPENDENCIES
# ============================================

Write-Header "PHASE 2: INSTALLER DEPENDENCIES"

Write-Host "Installation des dépendances Node..."
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install a échoué"
}
Write-Success "Dépendances installées"

# ============================================
# PHASE 3: BUILD UI (Vite)
# ============================================

Write-Header "PHASE 3: BUILD UI (Vite)"

Write-Host "Compilation Vite..."
npm run build:ui
if ($LASTEXITCODE -ne 0) {
    Write-Error "build:ui a échoué"
}

if (-not (Test-Path "dist\index.html")) {
    Write-Error "dist\index.html non créé après build:ui"
}
Write-Success "UI compilée: dist/"

# ============================================
# PHASE 4: BUILD IA (PyInstaller)
# ============================================

if (-not $SkipAI) {
    Write-Header "PHASE 4: BUILD IA (PyInstaller)"
    
    Write-Host "Compilation IA Python → EXE..."
    npm run build:ai
    if ($LASTEXITCODE -ne 0) {
        Write-Error "build:ai a échoué"
    }
    
    if (-not (Test-Path "dist\ai-lagrace\ai-lagrace.exe")) {
        Write-Error "dist\ai-lagrace\ai-lagrace.exe non créé après build:ai"
    }
    Write-Success "IA compilée: dist/ai-lagrace/ai-lagrace.exe"
} else {
    Write-Warn "Build IA ignoré (-SkipAI)"
}

# ============================================
# PHASE 5: BUILD ELECTRON
# ============================================

if (-not $NoSign) {
    Write-Header "PHASE 5: BUILD ELECTRON"
    
    Write-Host "Compilation Electron + electron-builder..."
    npm run build:electron
    if ($LASTEXITCODE -ne 0) {
        Write-Error "build:electron a échoué"
    }
    
    if (-not (Test-Path "dist-electron")) {
        Write-Error "dist-electron/ n'a pas été créé"
    }
    Write-Success "Electron compilé: dist-electron/"
    
    # Vérifier la présence de l'installateur
    $installer = Get-ChildItem "dist-electron\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($installer) {
        Write-Success "✨ Installateur créé: $($installer.Name)"
        Write-Host "  Taille: $([Math]::Round($installer.Length / 1MB, 2)) MB"
    } else {
        Write-Warn "Aucun .exe trouvé dans dist-electron/"
    }
} else {
    Write-Warn "Build Electron ignoré (-NoPack)"
}

# ============================================
# RÉSUMÉ FINAL
# ============================================

Write-Header "BUILD COMPLET ✅"

Write-Host @"

📦 RÉSUMÉ:
  ✅ Node dependencies installes
  ✅ UI compilée (Vite)
  $(if (-not $SkipAI) { "✅ IA compilée (PyInstaller)" } else { "⏭️  IA ignorée" })
  $(if (-not $NoSign) { "✅ Electron packagé" } else { "⏭️  Electron ignoré" })

📁 FICHIERS GÉNÉRÉS:
  dist/              → UI compilée
  $(if (-not $SkipAI) { "dist/ai-lagrace/   → IA Python compilée" })
  dist-electron/    → Installateur .exe

🚀 PROCHAINES ÉTAPES:
  1. Tester l'installateur:
     dist-electron\LA GRACE POS Setup *.exe
  
  2. Ou tester en dev:
     npm run dev
  
  3. Ou distribuer:
     Copier dist-electron\*.exe

"@

Write-Success "Build terminé avec succès!"
Write-Host ""
