# ✅ Diagnostic EXE - Vérifie la structure du package fini
# Usage: .\check-exe-structure.ps1 "C:\Program Files\LA GRACE POS"

param(
    [string]$AppDir = "C:\Program Files\LA GRACE POS"
)

Write-Host "`n🔍 CHECK EXE STRUCTURE - $AppDir`n" -ForegroundColor Cyan

if (-not (Test-Path $AppDir)) {
    Write-Host "❌ Dossier non trouvé: $AppDir" -ForegroundColor Red
    exit 1
}

# Fonction pour vérifier l'existence
function CheckPath {
    param([string]$Path, [string]$Name, [bool]$Critical = $false)
    
    if (Test-Path $Path) {
        Write-Host "✅ $Name" -ForegroundColor Green
        return $true
    } else {
        if ($Critical) {
            Write-Host "❌ CRITIQUE: $Name" -ForegroundColor Red
        } else {
            Write-Host "⚠️  $Name" -ForegroundColor Yellow
        }
        Write-Host "   Chemin: $Path" -ForegroundColor DarkGray
        return $false
    }
}

Write-Host "📦 Fichiers principaux:" -ForegroundColor Cyan
CheckPath "$AppDir\Gracepos.exe" "Gracepos.exe" $true
CheckPath "$AppDir\resources" "Dossier resources" $true

Write-Host "`n🎨 UI Frontend:" -ForegroundColor Cyan
CheckPath "$AppDir\resources\ui" "resources/ui/" $true
CheckPath "$AppDir\resources\ui\index.html" "index.html" $true
CheckPath "$AppDir\resources\ui\assets" "assets/" $true

$jsFiles = @(Get-ChildItem "$AppDir\resources\ui\assets" -Filter "index-*.js" -ErrorAction SilentlyContinue)
if ($jsFiles.Count -gt 0) {
    Write-Host "✅ Assets JS ($($jsFiles.Count) fichiers)" -ForegroundColor Green
    $jsFiles | ForEach-Object { Write-Host "   - $($_.Name)" -ForegroundColor DarkGray }
} else {
    Write-Host "❌ CRITIQUE: Aucun fichier index-*.js trouvé dans assets/" -ForegroundColor Red
    Write-Host "   Cause probable: dist/ui n'a pas été copié correctement" -ForegroundColor Yellow
}

Write-Host "`n🖨️  Module d'impression:" -ForegroundColor Cyan
CheckPath "$AppDir\resources\print" "resources/print/"
CheckPath "$AppDir\resources\print\module.js" "print/module.js"

Write-Host "`n⚙️  Config:" -ForegroundColor Cyan
CheckPath "$AppDir\resources\config.env" "config.env"

Write-Host "`n🤖 AI LaGrace:" -ForegroundColor Cyan
CheckPath "$AppDir\resources\ai" "resources/ai/"
CheckPath "$AppDir\resources\ai\main.py" "ai/main.py"

Write-Host "`n📦 Backend (app.asar):" -ForegroundColor Cyan
Write-Host "ℹ️  Note: app.asar est un archive - contenu non directement visible" -ForegroundColor DarkGray
Write-Host "✅ Dossier resources/app.asar supposé contenir:" -ForegroundColor Cyan
Write-Host "   - src/api/server.js" -ForegroundColor DarkGray
Write-Host "   - src/api/server-entry.cjs" -ForegroundColor DarkGray
Write-Host "   - src/package.json" -ForegroundColor DarkGray

Write-Host "`n📊 Logs de l'app:" -ForegroundColor Cyan
$logDir = "$env:APPDATA\LA GRACE POS\logs"
if (Test-Path $logDir) {
    Write-Host "✅ Dossier logs trouvé" -ForegroundColor Green
    $logs = @(Get-ChildItem $logDir -Filter "*.log")
    if ($logs.Count -gt 0) {
        $logs | ForEach-Object {
            Write-Host "   📄 $($_.Name) ($([math]::Round($_.Length / 1KB))KB)" -ForegroundColor DarkGray
            Write-Host "   Dernières lignes:" -ForegroundColor DarkGray
            Get-Content $_.FullName -Tail 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        }
    } else {
        Write-Host "⚠️  Aucun fichier log trouvé (l'app n'a pas encore démarré)" -ForegroundColor Yellow
    }
} else {
    Write-Host "ℹ️  Logs créés au premier démarrage" -ForegroundColor DarkGray
    Write-Host "   Dossier: $logDir" -ForegroundColor DarkGray
}

Write-Host "`n" -ForegroundColor Cyan
Write-Host "═" * 60

Write-Host "`n💡 Si ERR_FILE_NOT_FOUND 'index-*.js':`n" -ForegroundColor Yellow
Write-Host "1. Vérifier que dist/ui/assets/ existe" -ForegroundColor Gray
Write-Host "2. Refaire le build:" -ForegroundColor Gray
Write-Host "   npm run build" -ForegroundColor Gray
Write-Host "   npm run build:exe" -ForegroundColor Gray
Write-Host "3. Vérifier electron-builder.json:" -ForegroundColor Gray
Write-Host "   - extraResources: dist/ui → ui" -ForegroundColor Gray
Write-Host "4. Relancer l'EXE et vérifier les logs" -ForegroundColor Gray

Write-Host "`n" -ForegroundColor Cyan
