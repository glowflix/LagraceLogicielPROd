# LaGracePrintMenu.ps1 - LA GRACE POS v2.6
# Script Menu Interactif pour gerer l'impression
# Peut etre lance depuis un raccourci ou menu contextuel Windows

param(
    [string]$PrintDir = "C:\Glowflixprojet\printer",
    [string]$Action = "menu",  # menu, start, stop, status, process, install
    [string]$File = $null      # Fichier specifique a imprimer
)

$ErrorActionPreference = "SilentlyContinue"
$Host.UI.RawUI.WindowTitle = "LA GRACE POS - Gestionnaire d'Impression"

# ========= CONFIGURATION =========
$AppName = "LA GRACE POS"
$InstallPath = "C:\Program Files\LA GRACE POS"
$ScriptPath = $MyInvocation.MyCommand.Path
$LogDir = Join-Path $PrintDir "logs"
$OkDir = Join-Path $PrintDir "ok"
$ErrDir = Join-Path $PrintDir "err"
$TmpDir = Join-Path $PrintDir "tmp"

# Creer les dossiers
@($PrintDir, $LogDir, $OkDir, $ErrDir, $TmpDir) | ForEach-Object {
    if (-not (Test-Path $_)) { New-Item -ItemType Directory -Path $_ -Force | Out-Null }
}

$LogFile = Join-Path $LogDir "printmenu-$(Get-Date -Format 'yyyy-MM-dd').log"

# ========= COULEURS =========
function Write-Header {
    Write-Host ""
    Write-Host "+========================================================================+" -ForegroundColor Cyan
    Write-Host "|                                                                        |" -ForegroundColor Cyan
    Write-Host "|     [PRINT] LA GRACE POS - GESTIONNAIRE D'IMPRESSION                   |" -ForegroundColor Cyan
    Write-Host "|                                                                        |" -ForegroundColor Cyan
    Write-Host "+========================================================================+" -ForegroundColor Cyan
    Write-Host "|  Dossier: $($PrintDir.PadRight(55)) |" -ForegroundColor Yellow
    Write-Host "+========================================================================+" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Log {
    param([string]$Level, [string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        "INFO"  { "White" }
        "OK"    { "Green" }
        "WARN"  { "Yellow" }
        "ERROR" { "Red" }
        default { "Gray" }
    }
    Write-Host "[$ts] " -NoNewline -ForegroundColor DarkGray
    Write-Host "[$Level] " -NoNewline -ForegroundColor $color
    Write-Host $Message
    Add-Content -Path $LogFile -Value "[$ts] [$Level] $Message" -ErrorAction SilentlyContinue
}

# ========= RECHERCHE SUMATRAPDF =========
function Find-SumatraPDF {
    $searchPaths = @(
        "$InstallPath\resources\app.asar.unpacked\node_modules\pdf-to-printer\dist\SumatraPDF-3.4.6-32.exe",
        "$InstallPath\resources\app.asar.unpacked\node_modules\pdf-to-printer\dist\SumatraPDF.exe",
        "$InstallPath\resources\vendor\sumatra\SumatraPDF.exe",
        "C:\Program Files\SumatraPDF\SumatraPDF.exe",
        "C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
        "$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe"
    )
    
    foreach ($p in $searchPaths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ========= LISTE DES IMPRIMANTES =========
function Get-PrinterList {
    try {
        $printers = Get-Printer | Select-Object -ExpandProperty Name
        return $printers
    } catch {
        Write-Log "WARN" "Impossible de recuperer la liste des imprimantes"
        return @()
    }
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
        Write-Log "ERROR" "SumatraPDF non trouve - veuillez l'installer"
        return $false
    }
    
    if (-not (Test-Path $PdfPath)) {
        Write-Log "ERROR" "Fichier non trouve: $PdfPath"
        return $false
    }
    
    $args = if ($PrinterName) {
        @("-print-to", "`"$PrinterName`"", "-silent", "`"$PdfPath`"")
    } else {
        @("-print-to-default", "-silent", "`"$PdfPath`"")
    }
    
    for ($i = 1; $i -le $Copies; $i++) {
        Write-Log "INFO" "Impression copie $i/$Copies..."
        $process = Start-Process -FilePath $sumatra -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -ne 0) {
            Write-Log "WARN" "Code retour: $($process.ExitCode)"
        }
    }
    
    return $true
}

# ========= TRAITEMENT D'UN JOB =========
function Process-PrintJob {
    param([string]$FilePath)
    
    $fileName = [System.IO.Path]::GetFileName($FilePath)
    $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
    
    Write-Log "INFO" "Traitement: $fileName"
    
    try {
        if ($ext -eq ".pdf") {
            $success = Print-PDF -PdfPath $FilePath
            if ($success) {
                Move-Item -Path $FilePath -Destination (Join-Path $OkDir $fileName) -Force
                Write-Log "OK" "[OK] Imprime: $fileName"
                return $true
            }
        }
        elseif ($ext -eq ".json") {
            $job = Get-Content $FilePath -Raw | ConvertFrom-Json
            if ($job.pdfPath -and (Test-Path $job.pdfPath)) {
                $copies = if ($job.copies) { [int]$job.copies } else { 1 }
                $success = Print-PDF -PdfPath $job.pdfPath -PrinterName $job.printer -Copies $copies
                if ($success) {
                    Move-Item -Path $FilePath -Destination (Join-Path $OkDir $fileName) -Force
                    Write-Log "OK" "[OK] Imprime: $fileName"
                    return $true
                }
            }
        }
        
        Move-Item -Path $FilePath -Destination (Join-Path $ErrDir $fileName) -Force
        Write-Log "ERROR" "[ERREUR] Echec: $fileName"
        return $false
    } catch {
        Write-Log "ERROR" "Erreur: $($_.Exception.Message)"
        return $false
    }
}

# ========= SCANNER LE DOSSIER =========
function Process-AllJobs {
    $files = Get-ChildItem -Path $PrintDir -File | 
             Where-Object { 
                 ($_.Extension -eq ".json" -or $_.Extension -eq ".pdf") -and
                 $_.DirectoryName -eq $PrintDir
             }
    
    if ($files.Count -eq 0) {
        Write-Log "INFO" "Aucun job en attente"
        return
    }
    
    Write-Log "INFO" "Trouve $($files.Count) job(s) a traiter"
    
    foreach ($file in $files) {
        Process-PrintJob -FilePath $file.FullName
    }
}

# ========= STATUS =========
function Show-Status {
    Write-Host ""
    Write-Host "[STATUT] STATUT DU SYSTEME D'IMPRESSION" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Dossiers
    $pending = (Get-ChildItem -Path $PrintDir -File -ErrorAction SilentlyContinue | 
                Where-Object { $_.Extension -eq ".json" -or $_.Extension -eq ".pdf" }).Count
    $ok = (Get-ChildItem -Path $OkDir -File -ErrorAction SilentlyContinue).Count
    $err = (Get-ChildItem -Path $ErrDir -File -ErrorAction SilentlyContinue).Count
    
    Write-Host "[DOSSIER] Dossier principal: " -NoNewline
    Write-Host $PrintDir -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   [PENDING] Jobs en attente: " -NoNewline
    Write-Host $pending -ForegroundColor $(if ($pending -gt 0) { "Yellow" } else { "Green" })
    Write-Host "   [OK] Jobs reussis:         " -NoNewline
    Write-Host $ok -ForegroundColor Green
    Write-Host "   [ERR] Jobs en erreur:      " -NoNewline
    Write-Host $err -ForegroundColor $(if ($err -gt 0) { "Red" } else { "Green" })
    Write-Host ""
    
    # SumatraPDF
    $sumatra = Find-SumatraPDF
    Write-Host "[PRINT] SumatraPDF: " -NoNewline
    if ($sumatra) {
        Write-Host "[OK] Trouve" -ForegroundColor Green
        Write-Host "   $sumatra" -ForegroundColor DarkGray
    } else {
        Write-Host "[X] Non trouve" -ForegroundColor Red
    }
    Write-Host ""
    
    # Imprimantes
    Write-Host "[PRINT] Imprimantes installees:" -ForegroundColor Cyan
    $printers = Get-PrinterList
    if ($printers.Count -gt 0) {
        foreach ($p in $printers) {
            Write-Host "   * $p" -ForegroundColor White
        }
    } else {
        Write-Host "   Aucune imprimante trouvee" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # Process PrintWorker
    $workers = Get-Process -Name "powershell" -ErrorAction SilentlyContinue | 
               Where-Object { $_.MainWindowTitle -like "*PrintWorker*" -or $_.CommandLine -like "*PrintWorker*" }
    Write-Host "[WORKER] PrintWorker actif: " -NoNewline
    if ($workers) {
        Write-Host "[OK] En cours" -ForegroundColor Green
    } else {
        Write-Host "[X] Arrete" -ForegroundColor Yellow
    }
    Write-Host ""
}

# ========= DEMARRER WORKER EN ARRIERE-PLAN =========
function Start-PrintWorker {
    $workerScript = Join-Path (Split-Path $ScriptPath) "PrintWorker.ps1"
    
    if (-not (Test-Path $workerScript)) {
        Write-Log "ERROR" "PrintWorker.ps1 non trouve: $workerScript"
        return
    }
    
    Write-Log "INFO" "Demarrage du worker en arriere-plan..."
    
    Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-WindowStyle", "Hidden",
        "-File", $workerScript,
        "-PrintDir", $PrintDir
    ) -WindowStyle Hidden
    
    Write-Log "OK" "[OK] PrintWorker demarre"
}

# ========= OUVRIR DOSSIER =========
function Open-PrintFolder {
    if (Test-Path $PrintDir) {
        Start-Process explorer.exe -ArgumentList $PrintDir
        Write-Log "INFO" "Ouverture du dossier: $PrintDir"
    } else {
        Write-Log "ERROR" "Dossier non trouve: $PrintDir"
    }
}

# ========= INSTALLER MENU CONTEXTUEL =========
function Install-ContextMenu {
    Write-Host ""
    Write-Host "[INSTALL] INSTALLATION DU MENU CONTEXTUEL" -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Cette operation va ajouter 'Imprimer avec LA GRACE POS' au menu contextuel Windows."
    Write-Host ""
    
    $confirm = Read-Host "Continuer? (O/N)"
    if ($confirm -ne "O" -and $confirm -ne "o") {
        Write-Host "Installation annulee." -ForegroundColor Yellow
        return
    }
    
    try {
        # Creer l'entree pour les fichiers PDF
        $regPathPdf = "HKCU:\Software\Classes\SystemFileAssociations\.pdf\shell\LaGracePrint"
        New-Item -Path $regPathPdf -Force | Out-Null
        Set-ItemProperty -Path $regPathPdf -Name "(Default)" -Value "[PRINT] Imprimer avec LA GRACE POS"
        Set-ItemProperty -Path $regPathPdf -Name "Icon" -Value "$InstallPath\LA GRACE POS.exe"
        
        $regPathPdfCmd = "$regPathPdf\command"
        New-Item -Path $regPathPdfCmd -Force | Out-Null
        Set-ItemProperty -Path $regPathPdfCmd -Name "(Default)" -Value "powershell.exe -NoProfile -File `"$ScriptPath`" -Action process -File `"%1`""
        
        # Creer l'entree pour les fichiers JSON (jobs d'impression)
        $regPathJson = "HKCU:\Software\Classes\SystemFileAssociations\.json\shell\LaGracePrint"
        New-Item -Path $regPathJson -Force | Out-Null
        Set-ItemProperty -Path $regPathJson -Name "(Default)" -Value "[PRINT] Imprimer avec LA GRACE POS"
        
        $regPathJsonCmd = "$regPathJson\command"
        New-Item -Path $regPathJsonCmd -Force | Out-Null
        Set-ItemProperty -Path $regPathJsonCmd -Name "(Default)" -Value "powershell.exe -NoProfile -File `"$ScriptPath`" -Action process -File `"%1`""
        
        Write-Host ""
        Write-Host "[OK] Menu contextuel installe avec succes!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Vous pouvez maintenant cliquer-droit sur un fichier PDF ou JSON" -ForegroundColor White
        Write-Host "et choisir 'Imprimer avec LA GRACE POS'" -ForegroundColor White
        Write-Host ""
    } catch {
        Write-Host "[ERREUR] Erreur installation: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ========= DESINSTALLER MENU CONTEXTUEL =========
function Uninstall-ContextMenu {
    try {
        Remove-Item -Path "HKCU:\Software\Classes\SystemFileAssociations\.pdf\shell\LaGracePrint" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "HKCU:\Software\Classes\SystemFileAssociations\.json\shell\LaGracePrint" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Menu contextuel desinstalle" -ForegroundColor Green
    } catch {
        Write-Host "[ERREUR] Erreur: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ========= CREER RACCOURCI =========
function Create-Shortcut {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "LA GRACE Impression.lnk"
    
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Action menu"
    $shortcut.WorkingDirectory = $PrintDir
    $shortcut.IconLocation = "$InstallPath\LA GRACE POS.exe,0"
    $shortcut.Description = "Gestionnaire d'impression LA GRACE POS"
    $shortcut.Save()
    
    Write-Host "[OK] Raccourci cree sur le bureau: $shortcutPath" -ForegroundColor Green
}

# ========= MENU INTERACTIF =========
function Show-Menu {
    while ($true) {
        Clear-Host
        Write-Header
        
        # Afficher stats rapides
        $pending = (Get-ChildItem -Path $PrintDir -File -ErrorAction SilentlyContinue | 
                    Where-Object { $_.Extension -eq ".json" -or $_.Extension -eq ".pdf" }).Count
        
        if ($pending -gt 0) {
            Write-Host "   [!] $pending job(s) en attente d'impression" -ForegroundColor Yellow
            Write-Host ""
        }
        
        Write-Host "   [1] [STATUT] Voir le statut complet" -ForegroundColor White
        Write-Host "   [2] [>] Traiter tous les jobs en attente" -ForegroundColor White
        Write-Host "   [3] [WORKER] Demarrer le worker (arriere-plan)" -ForegroundColor White
        Write-Host "   [4] [DOSSIER] Ouvrir le dossier d'impression" -ForegroundColor White
        Write-Host "   [5] [PRINT] Imprimer un fichier specifique" -ForegroundColor White
        Write-Host ""
        Write-Host "   [6] [CONFIG] Installer le menu contextuel Windows" -ForegroundColor DarkCyan
        Write-Host "   [7] [DEL] Desinstaller le menu contextuel" -ForegroundColor DarkCyan
        Write-Host "   [8] [SAVE] Creer un raccourci sur le bureau" -ForegroundColor DarkCyan
        Write-Host ""
        Write-Host "   [9] [CLEAN] Nettoyer les jobs termines (ok/err)" -ForegroundColor DarkGray
        Write-Host "   [0] [X] Quitter" -ForegroundColor Red
        Write-Host ""
        
        $choice = Read-Host "   Choisissez une option"
        
        switch ($choice) {
            "1" {
                Clear-Host
                Write-Header
                Show-Status
                Write-Host ""
                Read-Host "Appuyez sur Entree pour continuer"
            }
            "2" {
                Clear-Host
                Write-Header
                Process-AllJobs
                Write-Host ""
                Read-Host "Appuyez sur Entree pour continuer"
            }
            "3" {
                Clear-Host
                Write-Header
                Start-PrintWorker
                Write-Host ""
                Read-Host "Appuyez sur Entree pour continuer"
            }
            "4" {
                Open-PrintFolder
            }
            "5" {
                Write-Host ""
                $filePath = Read-Host "   Chemin du fichier PDF ou JSON"
                if ($filePath -and (Test-Path $filePath)) {
                    Process-PrintJob -FilePath $filePath
                } else {
                    Write-Host "   [ERREUR] Fichier non trouve" -ForegroundColor Red
                }
                Read-Host "Appuyez sur Entree pour continuer"
            }
            "6" {
                Clear-Host
                Write-Header
                Install-ContextMenu
                Read-Host "Appuyez sur Entree pour continuer"
            }
            "7" {
                Clear-Host
                Write-Header
                Uninstall-ContextMenu
                Read-Host "Appuyez sur Entree pour continuer"
            }
            "8" {
                Clear-Host
                Write-Header
                Create-Shortcut
                Read-Host "Appuyez sur Entree pour continuer"
            }
            "9" {
                Clear-Host
                Write-Header
                Write-Host "Nettoyage des dossiers ok/ et err/..." -ForegroundColor Yellow
                Remove-Item -Path "$OkDir\*" -Force -ErrorAction SilentlyContinue
                Remove-Item -Path "$ErrDir\*" -Force -ErrorAction SilentlyContinue
                Write-Host "[OK] Nettoyage termine" -ForegroundColor Green
                Read-Host "Appuyez sur Entree pour continuer"
            }
            "0" {
                Write-Host ""
                Write-Host "Au revoir!" -ForegroundColor Cyan
                exit
            }
            default {
                Write-Host "   Option invalide" -ForegroundColor Red
                Start-Sleep -Seconds 1
            }
        }
    }
}

# ========= MAIN =========
switch ($Action.ToLower()) {
    "menu" {
        Show-Menu
    }
    "start" {
        Write-Header
        Start-PrintWorker
    }
    "stop" {
        Write-Header
        Write-Log "INFO" "Arret des workers..."
        Get-Process -Name "powershell" -ErrorAction SilentlyContinue | 
            Where-Object { $_.MainWindowTitle -like "*PrintWorker*" } | 
            Stop-Process -Force
        Write-Log "OK" "Workers arretes"
    }
    "status" {
        Write-Header
        Show-Status
    }
    "process" {
        Write-Header
        if ($File -and (Test-Path $File)) {
            Write-Log "INFO" "Impression du fichier: $File"
            Process-PrintJob -FilePath $File
        } else {
            Write-Log "INFO" "Traitement de tous les jobs..."
            Process-AllJobs
        }
        Write-Host ""
        Write-Host "Appuyez sur une touche pour fermer..." -ForegroundColor DarkGray
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
    "install" {
        Write-Header
        Install-ContextMenu
    }
    "uninstall" {
        Write-Header
        Uninstall-ContextMenu
    }
    "shortcut" {
        Write-Header
        Create-Shortcut
    }
    default {
        Show-Menu
    }
}
