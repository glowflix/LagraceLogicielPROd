# BUILD-PRO-V2.ps1 - Build avec nouvelle structure dist/ propre

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LA GRACE POS - BUILD PRO V2" -ForegroundColor Cyan
Write-Host "  Structure: dist/ui, dist/ai, dist/release" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ETAPE 1: Verifier les fichiers
Write-Host "Verification des fichiers requis..." -ForegroundColor Yellow

$requiredFiles = @(
    "src/api/server-entry.cjs",
    "electron/main.cjs",
    "src/api/server.js",
    "src/core/paths.js",
    "vite.config.js",
    "package.json"
)

foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file)) {
        Write-Host "  X $file - MANQUANT" -ForegroundColor Red
        exit 1
    } else {
        Write-Host "  + $file - OK" -ForegroundColor Green
    }
}

Write-Host "Tous les fichiers requis sont presents" -ForegroundColor Green
Write-Host ""

# ETAPE 2: Nettoyage complet
Write-Host "ETAPE 1: Nettoyage complet..." -ForegroundColor Yellow
npm run clean
Write-Host "Nettoyage OK" -ForegroundColor Green
Write-Host ""

# ETAPE 3: Installer les dependances npm
if (-not (Test-Path "node_modules")) {
    Write-Host "ETAPE 2: Installation des dependances npm..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erreur npm install" -ForegroundColor Red
        exit 1
    }
}
Write-Host "Dependances npm OK" -ForegroundColor Green
Write-Host ""

# ETAPE 4: Configurer Python
Write-Host "ETAPE 3: Configuration de Python..." -ForegroundColor Yellow

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}

& ".venv\Scripts\Activate.ps1"

if (Test-Path "requirements.txt") {
    pip install -r requirements.txt -q
}

Write-Host "Python OK" -ForegroundColor Green
Write-Host ""

# ETAPE 5: Build UI
Write-Host "ETAPE 4: Build React (dist/ui/)..." -ForegroundColor Yellow
npm run build:ui
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur build:ui" -ForegroundColor Red
    deactivate
    exit 1
}
Write-Host "UI compilee: dist/ui/index.html" -ForegroundColor Green
Write-Host ""

# ETAPE 6: Build IA
Write-Host "ETAPE 5: Build IA (dist/ai/)..." -ForegroundColor Yellow
npm run build:ai
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur build:ai" -ForegroundColor Red
    deactivate
    exit 1
}
Write-Host "IA compilee: dist/ai/ai-lagrace/ai-lagrace.exe" -ForegroundColor Green
Write-Host ""

deactivate

# ETAPE 7: Build Electron
Write-Host "ETAPE 6: Build Electron (dist/release/)..." -ForegroundColor Yellow
npm run build:electron
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur build:electron" -ForegroundColor Red
    exit 1
}
Write-Host "Electron package: dist/release/" -ForegroundColor Green
Write-Host ""

# ETAPE 8: Validation
Write-Host "ETAPE 7: Validation..." -ForegroundColor Yellow

$results = @()

$uiOk = Test-Path "dist\ui\index.html"
if ($uiOk) {
    $results += "UI compilee: dist/ui/index.html"
} else {
    $results += "X UI NOT FOUND"
}

$aiOk = Test-Path "dist\ai\ai-lagrace\ai-lagrace.exe"
if ($aiOk) {
    $aiSize = (Get-Item "dist\ai\ai-lagrace\ai-lagrace.exe").Length
    $results += "IA compilee: dist/ai/ai-lagrace/ ($([Math]::Round($aiSize / 1MB, 1)) MB)"
} else {
    $results += "X IA NOT FOUND"
}

$exePath = Get-ChildItem "dist\release" -Filter "LA GRACE POS Setup*.exe" -ErrorAction SilentlyContinue
if ($exePath) {
    $size = $exePath.Length
    $results += "Setup: dist/release/$($exePath.Name) ($([Math]::Round($size / 1MB, 1)) MB)"
} else {
    $results += "X Setup NOT FOUND"
}

$unpacked = Test-Path "dist\release\win-unpacked"
if ($unpacked) {
    $results += "Unpacked: dist/release/win-unpacked/"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  BUILD COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Structure finale:" -ForegroundColor Cyan
foreach ($result in $results) {
    Write-Host "  + $result" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DISTRIBUTION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "L'utilisateur final doit installer uniquement:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  dist/release/LA GRACE POS Setup 1.0.0.exe" -ForegroundColor Cyan
Write-Host ""
Write-Host "Aucun besoin de:" -ForegroundColor Yellow
Write-Host "  - npm" -ForegroundColor Gray
Write-Host "  - node" -ForegroundColor Gray
Write-Host "  - python" -ForegroundColor Gray
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
