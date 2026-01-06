# PrintWorker.ps1 - LA GRACE POS v2.6
# Script autonome pour surveiller et imprimer les jobs en mode EXE
# Ce script peut être lancé séparément du serveur Node.js

param(
    [string]$PrintDir = "C:\Glowflixprojet\printer",
    [string]$SumatraPath = "C:\Program Files\LA GRACE POS\resources\app.asar.unpacked\node_modules\pdf-to-printer\dist\SumatraPDF-3.4.6-32.exe",
    [switch]$Background,
    [switch]$Once
)

$ErrorActionPreference = "SilentlyContinue"

# ========= CONFIGURATION =========
$LogDir = Join-Path $PrintDir "logs"
$OkDir = Join-Path $PrintDir "ok"
$ErrDir = Join-Path $PrintDir "err"
$TmpDir = Join-Path $PrintDir "tmp"

# Créer les dossiers si nécessaire
@($LogDir, $OkDir, $ErrDir, $TmpDir) | ForEach-Object {
    if (-not (Test-Path $_)) { 
        New-Item -ItemType Directory -Path $_ -Force | Out-Null 
    }
}

$LogFile = Join-Path $LogDir "printworker-$(Get-Date -Format 'yyyy-MM-dd').log"

# ========= LOGGING =========
function Write-Log {
    param([string]$Level, [string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

# ========= RECHERCHE SUMATRAPDF =========
function Find-SumatraPDF {
    $searchPaths = @(
        $SumatraPath,
        "C:\Program Files\LA GRACE POS\resources\app.asar.unpacked\node_modules\pdf-to-printer\dist\SumatraPDF-3.4.6-32.exe",
        "C:\Program Files\LA GRACE POS\resources\app.asar.unpacked\node_modules\pdf-to-printer\dist\SumatraPDF.exe",
        "C:\Program Files\LA GRACE POS\resources\vendor\sumatra\SumatraPDF.exe",
        "C:\Program Files\SumatraPDF\SumatraPDF.exe",
        "C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe"
    )
    
    foreach ($p in $searchPaths) {
        if (Test-Path $p) {
            Write-Log "INFO" "SumatraPDF trouvé: $p"
            return $p
        }
    }
    
    Write-Log "ERROR" "SumatraPDF non trouvé!"
    return $null
}

# ========= IMPRESSION PDF =========
function Print-PDF {
    param(
        [string]$PdfPath,
        [string]$PrinterName = $null,
        [int]$Copies = 1
    )
    
    $sumatra = Find-SumatraPDF
    if (-not $sumatra) {
        Write-Log "ERROR" "Impossible d'imprimer - SumatraPDF non disponible"
        return $false
    }
    
    if (-not (Test-Path $PdfPath)) {
        Write-Log "ERROR" "Fichier PDF non trouvé: $PdfPath"
        return $false
    }
    
    # Construire les arguments SumatraPDF
    $args = @("-print-to-default", "-silent")
    if ($PrinterName) {
        $args = @("-print-to", "`"$PrinterName`"", "-silent")
    }
    
    # Ajouter les copies
    for ($i = 0; $i -lt $Copies; $i++) {
        try {
            Write-Log "INFO" "Impression: $PdfPath -> $PrinterName (copie $($i+1)/$Copies)"
            $process = Start-Process -FilePath $sumatra -ArgumentList ($args + @("`"$PdfPath`"")) -Wait -PassThru -WindowStyle Hidden
            
            if ($process.ExitCode -ne 0) {
                Write-Log "WARN" "SumatraPDF exit code: $($process.ExitCode)"
            }
        } catch {
            Write-Log "ERROR" "Erreur impression: $($_.Exception.Message)"
            return $false
        }
    }
    
    return $true
}

# ========= GÉNÉRATION PDF DEPUIS JSON =========
function Convert-JsonToPdf {
    param([string]$JsonPath)
    
    try {
        $job = Get-Content $JsonPath -Raw | ConvertFrom-Json
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($JsonPath)
        $pdfPath = Join-Path $TmpDir "$baseName.pdf"
        
        # Si le job a déjà un pdfPath, l'utiliser
        if ($job.pdfPath -and (Test-Path $job.pdfPath)) {
            return $job.pdfPath
        }
        
        # Sinon, créer un PDF simple avec les données
        # Pour l'instant, on crée un HTML temporaire et on le convertit
        # TODO: Implémenter un rendu HTML->PDF simple
        
        Write-Log "WARN" "Conversion JSON->PDF non implémentée, job ignoré"
        return $null
        
    } catch {
        Write-Log "ERROR" "Erreur parsing JSON: $($_.Exception.Message)"
        return $null
    }
}

# ========= TRAITEMENT D'UN JOB =========
function Process-PrintJob {
    param([string]$FilePath)
    
    $fileName = [System.IO.Path]::GetFileName($FilePath)
    $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
    
    Write-Log "INFO" "=========================================="
    Write-Log "INFO" "Traitement job: $fileName"
    Write-Log "INFO" "=========================================="
    
    try {
        if ($ext -eq ".pdf") {
            # Imprimer directement le PDF
            $success = Print-PDF -PdfPath $FilePath
            
            if ($success) {
                Move-Item -Path $FilePath -Destination (Join-Path $OkDir $fileName) -Force
                Write-Log "INFO" "✅ Impression réussie: $fileName -> ok/"
                return $true
            } else {
                Move-Item -Path $FilePath -Destination (Join-Path $ErrDir $fileName) -Force
                Write-Log "ERROR" "❌ Impression échouée: $fileName -> err/"
                return $false
            }
        }
        elseif ($ext -eq ".json") {
            # Lire le JSON et extraire les infos
            $job = Get-Content $FilePath -Raw -ErrorAction Stop | ConvertFrom-Json
            
            # Vérifier si c'est un job avec pdfPath existant
            if ($job.pdfPath -and (Test-Path $job.pdfPath)) {
                $copies = if ($job.copies) { [int]$job.copies } else { 1 }
                $printer = $job.printer
                
                $success = Print-PDF -PdfPath $job.pdfPath -PrinterName $printer -Copies $copies
                
                if ($success) {
                    Move-Item -Path $FilePath -Destination (Join-Path $OkDir $fileName) -Force
                    Write-Log "INFO" "✅ Impression réussie: $fileName -> ok/"
                    return $true
                }
            }
            
            # Job sans PDF prêt - nécessite conversion (non supporté pour l'instant)
            Write-Log "WARN" "Job JSON sans PDF prêt - déplacement vers err/"
            Move-Item -Path $FilePath -Destination (Join-Path $ErrDir $fileName) -Force
            
            # Créer un fichier d'erreur explicatif
            $errorInfo = @{
                originalFile = $fileName
                error = "JSON job requires Node.js print module for HTML->PDF conversion"
                hint = "Rebuild the EXE with proper asarUnpack for chokidar/handlebars"
                timestamp = (Get-Date -Format "o")
            } | ConvertTo-Json
            $errorFile = Join-Path $ErrDir "$fileName.error.json"
            Set-Content -Path $errorFile -Value $errorInfo
            
            return $false
        }
        else {
            Write-Log "WARN" "Extension non supportée: $ext"
            return $false
        }
    } catch {
        Write-Log "ERROR" "Erreur traitement: $($_.Exception.Message)"
        try {
            Move-Item -Path $FilePath -Destination (Join-Path $ErrDir $fileName) -Force -ErrorAction SilentlyContinue
        } catch {}
        return $false
    }
}

# ========= SCANNER LE DOSSIER =========
function Scan-PrintDirectory {
    $files = Get-ChildItem -Path $PrintDir -File -ErrorAction SilentlyContinue | 
             Where-Object { 
                 ($_.Extension -eq ".json" -or $_.Extension -eq ".pdf") -and
                 $_.DirectoryName -eq $PrintDir  # Seulement à la racine, pas dans ok/err/tmp
             }
    
    foreach ($file in $files) {
        Process-PrintJob -FilePath $file.FullName
    }
}

# ========= MAIN =========
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════════╗"
Write-Host "║  🖨️  PRINT WORKER - LA GRACE POS                                      ║"
Write-Host "╠══════════════════════════════════════════════════════════════════════╣"
Write-Host "║  Dossier: $($PrintDir.PadRight(55)) ║"
Write-Host "║  Mode: $(if ($Once) { 'Traitement unique'.PadRight(58) } else { 'Surveillance continue'.PadRight(58) }) ║"
Write-Host "╚══════════════════════════════════════════════════════════════════════╝"
Write-Host ""

Write-Log "INFO" "PrintWorker démarré"
Write-Log "INFO" "Dossier: $PrintDir"

# Vérifier SumatraPDF au démarrage
$sumatra = Find-SumatraPDF
if (-not $sumatra) {
    Write-Log "ERROR" "SumatraPDF non trouvé - impression impossible"
    exit 1
}

if ($Once) {
    # Mode single-shot: traiter et quitter
    Scan-PrintDirectory
    Write-Log "INFO" "Traitement termine"
} else {
    # Mode continu: surveiller le dossier
    Write-Log "INFO" "Surveillance active"
    
    while ($true) {
        Scan-PrintDirectory
        Start-Sleep -Seconds 2
    }
}
