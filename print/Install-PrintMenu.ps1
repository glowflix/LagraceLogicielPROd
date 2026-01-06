# Install-PrintMenu.ps1 - Installation rapide du menu contextuel
# Executez ce script en tant qu'administrateur pour installer le menu

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "+========================================================================+" -ForegroundColor Cyan
Write-Host "|     INSTALLATION MENU CONTEXTUEL - LA GRACE POS                        |" -ForegroundColor Cyan
Write-Host "+========================================================================+" -ForegroundColor Cyan
Write-Host ""

$InstallPath = "C:\Program Files\LA GRACE POS"
$PrintDir = "C:\Glowflixprojet\printer"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MenuScript = Join-Path $ScriptDir "LaGracePrintMenu.ps1"

# Verifier que le script menu existe
if (-not (Test-Path $MenuScript)) {
    Write-Host "[ERREUR] LaGracePrintMenu.ps1 non trouve!" -ForegroundColor Red
    Write-Host "         Chemin: $MenuScript" -ForegroundColor Yellow
    exit 1
}

Write-Host "[INFO] Script menu: $MenuScript" -ForegroundColor White
Write-Host ""

try {
    # Menu contextuel pour PDF - Impression directe
    Write-Host "[1/4] Installation menu PDF..." -ForegroundColor Yellow
    $regPathPdf = "HKCU:\Software\Classes\SystemFileAssociations\.pdf\shell\LaGracePrint"
    New-Item -Path $regPathPdf -Force | Out-Null
    Set-ItemProperty -Path $regPathPdf -Name "(Default)" -Value "Imprimer avec LA GRACE POS"
    if (Test-Path "$InstallPath\LA GRACE POS.exe") {
        Set-ItemProperty -Path $regPathPdf -Name "Icon" -Value "$InstallPath\LA GRACE POS.exe"
    }
    $regPathPdfCmd = "$regPathPdf\command"
    New-Item -Path $regPathPdfCmd -Force | Out-Null
    Set-ItemProperty -Path $regPathPdfCmd -Name "(Default)" -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$MenuScript`" -Action process -File `"%1`""
    Write-Host "   [OK] Menu PDF installe" -ForegroundColor Green

    # Menu contextuel pour JSON
    Write-Host "[2/4] Installation menu JSON..." -ForegroundColor Yellow
    $regPathJson = "HKCU:\Software\Classes\SystemFileAssociations\.json\shell\LaGracePrint"
    New-Item -Path $regPathJson -Force | Out-Null
    Set-ItemProperty -Path $regPathJson -Name "(Default)" -Value "Imprimer avec LA GRACE POS"
    $regPathJsonCmd = "$regPathJson\command"
    New-Item -Path $regPathJsonCmd -Force | Out-Null
    Set-ItemProperty -Path $regPathJsonCmd -Name "(Default)" -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$MenuScript`" -Action process -File `"%1`""
    Write-Host "   [OK] Menu JSON installe" -ForegroundColor Green

    # Menu contextuel sur dossier (ouvrir gestionnaire)
    Write-Host "[3/4] Installation menu dossier..." -ForegroundColor Yellow
    $regPathDir = "HKCU:\Software\Classes\Directory\shell\LaGracePrintMenu"
    New-Item -Path $regPathDir -Force | Out-Null
    Set-ItemProperty -Path $regPathDir -Name "(Default)" -Value "Ouvrir LA GRACE Impression"
    if (Test-Path "$InstallPath\LA GRACE POS.exe") {
        Set-ItemProperty -Path $regPathDir -Name "Icon" -Value "$InstallPath\LA GRACE POS.exe"
    }
    $regPathDirCmd = "$regPathDir\command"
    New-Item -Path $regPathDirCmd -Force | Out-Null
    Set-ItemProperty -Path $regPathDirCmd -Name "(Default)" -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$MenuScript`" -Action menu"
    Write-Host "   [OK] Menu dossier installe" -ForegroundColor Green

    # Creer raccourci bureau
    Write-Host "[4/4] Creation raccourci bureau..." -ForegroundColor Yellow
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "LA GRACE Impression.lnk"
    
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$MenuScript`" -Action menu"
    $shortcut.WorkingDirectory = $PrintDir
    if (Test-Path "$InstallPath\LA GRACE POS.exe") {
        $shortcut.IconLocation = "$InstallPath\LA GRACE POS.exe,0"
    }
    $shortcut.Description = "Gestionnaire d'impression LA GRACE POS"
    $shortcut.Save()
    Write-Host "   [OK] Raccourci cree: $shortcutPath" -ForegroundColor Green

    Write-Host ""
    Write-Host "+========================================================================+" -ForegroundColor Green
    Write-Host "|     INSTALLATION TERMINEE AVEC SUCCES!                                 |" -ForegroundColor Green
    Write-Host "+========================================================================+" -ForegroundColor Green
    Write-Host ""
    Write-Host "Vous pouvez maintenant:" -ForegroundColor White
    Write-Host "  * Cliquer-droit sur un PDF/JSON -> 'Imprimer avec LA GRACE POS'" -ForegroundColor Cyan
    Write-Host "  * Cliquer-droit sur un dossier  -> 'Ouvrir LA GRACE Impression'" -ForegroundColor Cyan
    Write-Host "  * Utiliser le raccourci sur le bureau" -ForegroundColor Cyan
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "[ERREUR] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Read-Host "Appuyez sur Entree pour fermer"
