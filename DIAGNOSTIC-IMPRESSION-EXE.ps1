# DIAGNOSTIC-IMPRESSION-EXE.ps1
# Script de diagnostic pour l'impression en mode EXE

Write-Host "`n" -NoNewline
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "   DIAGNOSTIC IMPRESSION - MODE EXE PRODUCTION" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Cyan

# 1. Chemin AppData attendu
$appDataPath = "$env:APPDATA\Glowflixprojet"
Write-Host "`n[1] CHEMIN APPDATA" -ForegroundColor Yellow
Write-Host "    Chemin attendu: $appDataPath"

if (Test-Path $appDataPath) {
    Write-Host "    EXISTE" -ForegroundColor Green
} else {
    Write-Host "    N'EXISTE PAS - Sera cree au premier lancement" -ForegroundColor Red
    New-Item -ItemType Directory -Path $appDataPath -Force | Out-Null
    Write-Host "    CREE MAINTENANT" -ForegroundColor Green
}

# 2. Structure des dossiers printer
$printerPath = "$appDataPath\printer"
Write-Host "`n[2] STRUCTURE DOSSIERS PRINTER" -ForegroundColor Yellow

$dirs = @(
    "$printerPath",
    "$printerPath\ok",
    "$printerPath\err",
    "$printerPath\tmp",
    "$printerPath\templates",
    "$printerPath\assets"
)

foreach ($dir in $dirs) {
    if (Test-Path $dir) {
        $count = (Get-ChildItem $dir -File -ErrorAction SilentlyContinue | Measure-Object).Count
        Write-Host "    $dir" -ForegroundColor Green
        Write-Host "        Fichiers: $count" -ForegroundColor Gray
    } else {
        Write-Host "    $dir - MANQUANT" -ForegroundColor Red
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "        CREE" -ForegroundColor Yellow
    }
}

# 3. Verifier les jobs en attente
Write-Host "`n[3] JOBS EN ATTENTE" -ForegroundColor Yellow
$pendingJobs = Get-ChildItem -Path $printerPath -Filter "*.json" -File -ErrorAction SilentlyContinue | 
    Where-Object { $_.FullName -notlike "*\ok\*" -and $_.FullName -notlike "*\err\*" -and $_.FullName -notlike "*\tmp\*" }

if ($pendingJobs) {
    Write-Host "    $($pendingJobs.Count) job(s) en attente:" -ForegroundColor Yellow
    foreach ($job in $pendingJobs) {
        Write-Host "        - $($job.Name) ($($job.Length) bytes)" -ForegroundColor Gray
    }
} else {
    Write-Host "    Aucun job en attente dans $printerPath" -ForegroundColor Green
}

# 4. Verifier les jobs traites (ok)
Write-Host "`n[4] JOBS TRAITES (ok/)" -ForegroundColor Yellow
$okJobs = Get-ChildItem -Path "$printerPath\ok" -Filter "*.json" -File -ErrorAction SilentlyContinue

if ($okJobs) {
    Write-Host "    $($okJobs.Count) job(s) traites avec succes" -ForegroundColor Green
    $latest = $okJobs | Sort-Object LastWriteTime -Descending | Select-Object -First 3
    foreach ($job in $latest) {
        Write-Host "        - $($job.Name) ($($job.LastWriteTime))" -ForegroundColor Gray
    }
} else {
    Write-Host "    Aucun job traite" -ForegroundColor Gray
}

# 5. Verifier les jobs en erreur (err/)
Write-Host "`n[5] JOBS EN ERREUR (err/)" -ForegroundColor Yellow
$errJobs = Get-ChildItem -Path "$printerPath\err" -Filter "*.json" -File -ErrorAction SilentlyContinue

if ($errJobs) {
    Write-Host "    $($errJobs.Count) job(s) en erreur:" -ForegroundColor Red
    foreach ($job in $errJobs) {
        Write-Host "        - $($job.Name)" -ForegroundColor Gray
        $errorFile = $job.FullName -replace "\.json$", ".error.txt"
        if (Test-Path $errorFile) {
            $errorContent = Get-Content $errorFile -Raw
            Write-Host "          Erreur: $($errorContent.Substring(0, [Math]::Min(100, $errorContent.Length)))..." -ForegroundColor Red
        }
    }
} else {
    Write-Host "    Aucun job en erreur" -ForegroundColor Green
}

# 6. Verifier l'imprimante par defaut
Write-Host "`n[6] IMPRIMANTE PAR DEFAUT" -ForegroundColor Yellow
$defaultPrinter = Get-WmiObject -Query "SELECT * FROM Win32_Printer WHERE Default=$true" -ErrorAction SilentlyContinue

if ($defaultPrinter) {
    Write-Host "    Nom: $($defaultPrinter.Name)" -ForegroundColor Green
    Write-Host "    Status: $($defaultPrinter.PrinterStatus)" -ForegroundColor Gray
    Write-Host "    Partage: $($defaultPrinter.Shared)" -ForegroundColor Gray
} else {
    Write-Host "    AUCUNE IMPRIMANTE PAR DEFAUT CONFIGUREE!" -ForegroundColor Red
    Write-Host "    L'impression ne fonctionnera pas sans imprimante par defaut." -ForegroundColor Red
}

# 7. Verifier le Spooler
Write-Host "`n[7] SERVICE SPOOLER" -ForegroundColor Yellow
$spooler = Get-Service -Name Spooler -ErrorAction SilentlyContinue

if ($spooler) {
    if ($spooler.Status -eq "Running") {
        Write-Host "    Spooler: EN COURS D'EXECUTION" -ForegroundColor Green
    } else {
        Write-Host "    Spooler: ARRETE - Tentative de demarrage..." -ForegroundColor Red
        Start-Service Spooler -ErrorAction SilentlyContinue
        if ((Get-Service Spooler).Status -eq "Running") {
            Write-Host "    Spooler: DEMARRE AVEC SUCCES" -ForegroundColor Green
        }
    }
} else {
    Write-Host "    Service Spooler non trouve!" -ForegroundColor Red
}

# 8. Logs de l'application
Write-Host "`n[8] LOGS APPLICATION" -ForegroundColor Yellow
$logsPath = "$appDataPath\logs"
if (Test-Path $logsPath) {
    $latestLog = Get-ChildItem -Path $logsPath -Filter "*.log" -File -ErrorAction SilentlyContinue | 
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "    Dernier log: $($latestLog.Name)" -ForegroundColor Green
        Write-Host "    Date: $($latestLog.LastWriteTime)" -ForegroundColor Gray
        
        # Afficher les dernieres lignes concernant PRINT
        $printLines = Get-Content $latestLog.FullName -Tail 50 | Where-Object { $_ -match "PRINT|printer|job|impression" }
        if ($printLines) {
            Write-Host "    Dernieres entrees PRINT:" -ForegroundColor Yellow
            $printLines | Select-Object -Last 5 | ForEach-Object {
                Write-Host "        $_" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "    Aucun fichier log trouve" -ForegroundColor Yellow
    }
} else {
    Write-Host "    Dossier logs n'existe pas encore" -ForegroundColor Yellow
}

# 9. Creer un job de test
Write-Host "`n[9] CREATION D'UN JOB DE TEST" -ForegroundColor Yellow
$testJobName = "test-diagnostic-$([DateTime]::Now.ToString('yyyyMMddHHmmss')).json"
$testJobPath = Join-Path $printerPath $testJobName
$testJob = @{
    template = "receipt-80"
    copies = 1
    forceReprint = $true
    data = @{
        factureNum = "TEST-DIAG-001"
        client = "Test Diagnostic"
        taux = 2800
        dateISO = [DateTime]::Now.ToString("o")
        lignes = @(
            @{
                code = "TEST"
                nom = "Produit Test"
                unite = "piece"
                mark = ""
                qty = 1
                qteLabel = "1"
                puFC = 1000
                totalFC = 1000
            }
        )
        totalFC = 1000
        totalUSD = 0.36
        printCurrency = "FC"
        entreprise = @{
            nom = "ALIMENTATION LA GRACE"
            rccm = "CD/KIS/RCCM 22-A-00172"
            impot = "A220883T"
        }
    }
} | ConvertTo-Json -Depth 10

try {
    $testJob | Out-File -FilePath $testJobPath -Encoding UTF8
    Write-Host "    Job de test cree: $testJobName" -ForegroundColor Green
    Write-Host "    Chemin: $testJobPath" -ForegroundColor Gray
    Write-Host "    LE WATCHER DEVRAIT DETECTER CE JOB ET L'IMPRIMER" -ForegroundColor Yellow
} catch {
    Write-Host "    ERREUR creation job: $($_.Exception.Message)" -ForegroundColor Red
}

# Resume
Write-Host "`n" -NoNewline
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "   RESUME DIAGNOSTIC" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Cyan

Write-Host @"

CHEMINS CORRIGES:
  - En mode EXE, les jobs sont deposes dans:
    $printerPath
  
  - En mode DEV, les jobs sont deposes dans:
    C:\Glowflixprojet\printer

ACTIONS A VERIFIER:
  1. Lancer l'application en mode EXE (double-clic sur l'exe installe)
  2. Faire une vente de test
  3. Verifier que le job apparait dans $printerPath
  4. Verifier que l'impression se lance

SI L'IMPRESSION NE FONCTIONNE TOUJOURS PAS:
  - Verifier les logs dans $appDataPath\logs
  - Verifier que l'imprimante par defaut est configuree
  - Relancer ce script pour voir les jobs en attente/erreur

"@ -ForegroundColor Gray

Write-Host "Appuyez sur une touche pour fermer..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

