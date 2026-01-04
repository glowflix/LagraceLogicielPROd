# TEST-PRINT-FIX.ps1
# Script pour tester rapidement le fix d'impression en EXE

Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  TEST IMPRESSION - LA GRACE POS" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Configuration
$unpackedDir = ".\dist-electron\win-unpacked"
$exePath = "$unpackedDir\LA GRACE POS.exe"
$logsDir = "$env:APPDATA\LA GRACE POS\logs"
$mainLog = "$logsDir\main.log"

# 🔴 Étape 1: Vérification des fichiers requis
Write-Host "📋 ÉTAPE 1: Vérification des fichiers" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

$checks = @(
    ("EXE", $exePath),
    ("Print Module", "$unpackedDir\resources\print\module.js"),
    ("pdf-to-printer", "$unpackedDir\resources\node_modules\pdf-to-printer"),
    ("handlebars", "$unpackedDir\resources\node_modules\handlebars"),
    ("chokidar", "$unpackedDir\resources\node_modules\chokidar")
)

$allOk = $true
foreach ($check in $checks) {
    $name, $path = $check
    if (Test-Path $path) {
        Write-Host "  ✅ $name" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $name" -ForegroundColor Red
        Write-Host "     Attendu: $path" -ForegroundColor Gray
        $allOk = $false
    }
}

if (-not $allOk) {
    Write-Host ""
    Write-Host "⚠️  ERREUR: Fichiers manquants!" -ForegroundColor Red
    Write-Host "   Assurez-vous que le build est complet:"
    Write-Host "   1. npm install"
    Write-Host "   2. npm run build:ui"
    Write-Host "   3. npm run build:electron"
    Write-Host ""
    exit 1
}

# 🟢 Étape 2: Lancer l'application
Write-Host ""
Write-Host "🚀 ÉTAPE 2: Lancement de l'application" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

Write-Host "   Lancement: $exePath" -ForegroundColor Gray

# Effacer le log existant pour avoir un fresh start
if (Test-Path $mainLog) {
    Clear-Content $mainLog -ErrorAction SilentlyContinue
    Write-Host "   📝 Log effacé pour un test propre" -ForegroundColor Gray
}

# Lancer l'appli en arrière-plan
$process = Start-Process $exePath -PassThru -WindowStyle Normal
$pid = $process.Id
Write-Host "   ✅ Application lancée (PID: $pid)" -ForegroundColor Green
Write-Host ""

# Attendre que le backend démarre
Write-Host "⏳ ÉTAPE 3: Attente du démarrage du backend" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

$maxWait = 30
$elapsed = 0
$backendReady = $false

while ($elapsed -lt $maxWait) {
    Write-Host "   Attente: ${elapsed}s / ${maxWait}s..." -ForegroundColor Gray
    
    # Vérifier si le backend répond
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3030" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "   ✅ Backend prêt!" -ForegroundColor Green
            $backendReady = $true
            break
        }
    } catch {
        # Backend pas encore prêt, continuer
    }
    
    Start-Sleep -Seconds 1
    $elapsed += 1
}

if (-not $backendReady) {
    Write-Host "   ❌ Backend n'a pas répondu après ${maxWait}s" -ForegroundColor Red
    Write-Host "   💡 Vérifiez les logs:" -ForegroundColor Yellow
    if (Test-Path $mainLog) {
        Write-Host "   " -ForegroundColor Gray
        Get-Content $mainLog -Tail 20 | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
    }
    Write-Host ""
    Write-Host "   Arrêt du processus..." -ForegroundColor Yellow
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""

# 🟢 Étape 4: Vérifier le chargement du module d'impression
Write-Host "🖨️  ÉTAPE 4: Vérification du module d'impression" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

Start-Sleep -Seconds 2  # Donner le temps aux logs de s'écrire

if (Test-Path $mainLog) {
    $logContent = Get-Content $mainLog -Raw
    
    if ($logContent -match "✅ Printer module chargé") {
        Write-Host "   ✅ Module d'impression chargé!" -ForegroundColor Green
    } elseif ($logContent -match "❌ Erreur chargement printer module") {
        Write-Host "   ❌ Erreur lors du chargement" -ForegroundColor Red
        Write-Host ""
        Write-Host "   Détails de l'erreur:" -ForegroundColor Yellow
        $logContent | Select-String -Pattern "❌ Erreur chargement printer module", "Cannot find module" -Context 0, 2 | 
            ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
    } else {
        Write-Host "   ⚠️  Status unclear (voir logs)" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ⚠️  Log principal non trouvé" -ForegroundColor Yellow
}

Write-Host ""

# 🟢 Étape 5: Instructions pour tester manuellement
Write-Host "✏️  ÉTAPE 5: Test Manuel" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

Write-Host "   1. Ouvrir: http://localhost:3030" -ForegroundColor Cyan
Write-Host "   2. Naviguer à: Produits" -ForegroundColor Cyan
Write-Host "   3. Créer une vente (ajouter un produit)" -ForegroundColor Cyan
Write-Host "   4. Finaliser la vente" -ForegroundColor Cyan
Write-Host "   5. Aller à: Historique des ventes" -ForegroundColor Cyan
Write-Host "   6. Cliquer: 🖨️  (icône d'impression)" -ForegroundColor Cyan
Write-Host "   7. Observer: Message de succès ou d'erreur" -ForegroundColor Cyan
Write-Host ""

Write-Host "💡 Conseils:" -ForegroundColor Yellow
Write-Host "   - Si 'Ticket envoyé à l'impression': ✅ TEST RÉUSSI!" -ForegroundColor Green
Write-Host "   - Si erreur 'Printer module not ready': Voir les logs" -ForegroundColor Red
Write-Host "   - Logs complets: $mainLog" -ForegroundColor Gray
Write-Host ""

# Menu pour continuer
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
$choice = Read-Host "Continuer? (O=Oui, L=Afficher logs, Q=Quitter) [O]"

if ($choice -eq "L" -or $choice -eq "l") {
    Write-Host ""
    Write-Host "📋 CONTENU DU LOG PRINCIPAL:" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    if (Test-Path $mainLog) {
        Get-Content $mainLog -Tail 100 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "Log non trouvé: $mainLog" -ForegroundColor Red
    }
    Write-Host ""
} elseif ($choice -eq "Q" -or $choice -eq "q") {
    Write-Host "Arrêt du processus..." -ForegroundColor Yellow
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    exit 0
}

# 🟢 Étape 6: Attendre la fin du test
Write-Host ""
Write-Host "⏸️  L'application continue de tourner..." -ForegroundColor Yellow
Write-Host "Fermer la fenêtre Electron pour terminer le test." -ForegroundColor Gray
Write-Host ""

# Attendre que le process se termine
$process.WaitForExit()

Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  TEST TERMINÉ" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green

# Afficher un résumé du log
Write-Host ""
Write-Host "📊 RÉSUMÉ DU TEST:" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

if (Test-Path $mainLog) {
    $logContent = Get-Content $mainLog -Raw
    
    $printSuccess = $logContent | Select-String -Pattern "✅ Printer module chargé" -Count
    $printError = $logContent | Select-String -Pattern "❌ Erreur chargement printer module" -Count
    $printJobs = $logContent | Select-String -Pattern "\[PRINT\]" -Count
    
    Write-Host "   Chargements réussis: $printSuccess" -ForegroundColor Green
    Write-Host "   Erreurs chargement: $printError" -ForegroundColor $(if ($printError -gt 0) { "Red" } else { "Green" })
    Write-Host "   Jobs d'impression: $printJobs" -ForegroundColor Cyan
} else {
    Write-Host "   ⚠️  Log non accessible" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ Test terminé. Consultez la documentation pour les prochaines étapes." -ForegroundColor Green
Write-Host ""
