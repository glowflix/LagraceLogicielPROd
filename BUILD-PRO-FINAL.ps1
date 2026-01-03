# BUILD-PRO-FINAL.ps1 - Script de build production final avec tous les fixes appliques

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LA GRACE POS - BUILD PRODUCTION FINAL" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
# Verifier que tous les fichiers requis existent
Write-Host "Verification des fichiers requis..." -ForegroundColor Yellow

$requiredFiles = @(
    "src/api/server-entry.cjs",    # NOUVEAU - Lanceur CJS
    "electron/main.cjs",            # MODIFIE - dataRoot, APP_ROOT, etc
    "src/api/server.js",            # MODIFIE - IS_ELECTRON, DIST_DIR, etc
    "src/core/paths.js",            # MODIFIE - userData integration
    "package.json",
    "vite.config.js",
    "electron-builder.json"
)

$missingFiles = @()
foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file)) {
        $missingFiles += $file
        Write-Host "  X $file - MANQUANT" -ForegroundColor Red
    } else {
        Write-Host "  + $file - OK" -ForegroundColor Green
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "ERREUR: Fichiers manquants!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Tous les fichiers requis sont presents" -ForegroundColor Green
# ETAPE 1: Nettoyer les anciens builds
Write-Host "ETAPE 1: Nettoyage des anciens builds..." -ForegroundColor Yellow

$dirsToClean = @("dist", "dist-electron", "`$outDir")
foreach ($dir in $dirsToClean) {
    if (Test-Path $dir) {
        Write-Host "  Suppression de $dir..." -ForegroundColor Gray
        Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Nettoyage termine" -ForegroundColor Green
# ETAPE 2: Installer les dependances (si necessaire)
if (-not (Test-Path "node_modules")) {
    Write-Host "ETAPE 2: Installation des dependances npm..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erreur npm install" -ForegroundColor Red
        exit 1
    }
    Write-Host "Dependances npm installees" -ForegroundColor Green
} else {
    Write-Host "ETAPE 2: Dependances npm deja installees" -ForegroundColor Green
}

# ETAPE 3: Configurer l'environnement Python
Write-Host "ETAPE 3: Configuration de l'environnement Python..." -ForegroundColor Yellow

# Verifier ou creer venv
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "  Creation de l'environnement virtuel..." -ForegroundColor Gray
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erreur creation venv" -ForegroundColor Red
        exit 1
    }
}

# Activer venv
& ".venv\Scripts\Activate.ps1"

# Installer requirements
if (Test-Path "requirements.txt") {
    Write-Host "  Installation des packages Python..." -ForegroundColor Gray
    pip install -r requirements.txt -q
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erreur pip install" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Environnement Python pret" -ForegroundColor Green
# ETAPE 4: Build UI (Vite)
Write-Host "ETAPE 4: Build React + Vite..." -ForegroundColor Yellow
npm run build:ui
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur build:ui" -ForegroundColor Red
    deactivate
    exit 1
}
Write-Host "UI compilee (dist/)" -ForegroundColor Green
Write-Host ""

# ETAPE 5: Build IA (PyInstaller)
Write-Host "ETAPE 5: Compilation IA avec PyInstaller..." -ForegroundColor Yellow
npm run build:ai
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur build:ai" -ForegroundColor Red
    deactivate
    exit 1
}
Write-Host "IA compilee (dist/ai-lagrace/)" -ForegroundColor Green
Write-Host ""

# Desactiver venv
deactivate

# ETAPE 6: Build Electron + Package
Write-Host "ETAPE 6: Build Electron et packaging..." -ForegroundColor Yellow
npm run build:electron
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur build:electron" -ForegroundColor Red
    exit 1
}
Write-Host "Electron package (dist-electron/)" -ForegroundColor Green
Write-Host ""

# ETAPE 7: Validation
Write-Host "ETAPE 7: Validation du build..." -ForegroundColor Yellow

$exePath = Get-ChildItem "dist-electron" -Filter "LA GRACE POS Setup*.exe" -ErrorAction SilentlyContinue
if ($exePath) {
    Write-Host "  + Setup trouve: $($exePath.Name)" -ForegroundColor Green
    Write-Host "     Taille: $([Math]::Round($exePath.Length / 1MB, 2)) MB" -ForegroundColor Green
} else {
    Write-Host "  - Setup non trouve (peut etre en cours de creation)" -ForegroundColor Yellow
}

$unpacked = Get-ChildItem "dist-electron\win-unpacked\*" -ErrorAction SilentlyContinue
if ($unpacked) {
    Write-Host "  + Dossier unpacked trouve (pour tests)" -ForegroundColor Green
}

Write-Host ""

# RESUME
Write-Host "========================================" -ForegroundColor Green
Write-Host "  BUILD COMPLETE AVEC SUCCES" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Emplacements des fichiers:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  UI compilee:"
Write-Host "     dist/index.html"
Write-Host ""
Write-Host "  IA compilee:"
Write-Host "     dist/ai-lagrace/ai-lagrace.exe"
Write-Host ""
Write-Host "  Installateur:"
Write-Host "     dist-electron/LA GRACE POS Setup*.exe"
Write-Host ""
Write-Host "  Unpacked (pour tests):"
Write-Host "     dist-electron/win-unpacked/"
Write-Host ""

# Options suivantes
Write-Host "PROCHAINES ETAPES:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Tester l'application unpacked:"
Write-Host "     Start-Process 'dist-electron\win-unpacked\LA GRACE POS.exe'"
Write-Host ""
Write-Host "  2. Verifier que http://localhost:3030 repond"
Write-Host ""
Write-Host "  3. Installer et tester:"
Write-Host "     dist-electron\LA GRACE POS Setup*.exe"
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Build timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
