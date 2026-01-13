# Script de correction - Remplace Fore.WHITE par Fore.CYAN
# Utilisation: .\FIX-FORE-WHITE.ps1
# Corrige les DEUX installations

Write-Host "========================================" -ForegroundColor Green
Write-Host "FIX: Fore.WHITE to Fore.CYAN (2 folders)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Les deux dossiers du projet
$projectPaths = @(
    "d:\logiciel\La Grace pro\v1",
    "C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1"
)

# Fichiers a corriger
$filesToFix = @(
    "ai-lagrace\main.py",
    "ai-lagrace\services\assistant.py",
    "ai-lagrace\services\socket_client.py"
)

$totalFixed = 0

# Corriger chaque dossier
foreach ($projectPath in $projectPaths) {
    if (-not (Test-Path $projectPath)) {
        Write-Host "ATTENTION: Dossier non trouve: $projectPath" -ForegroundColor Yellow
        continue
    }
    
    Write-Host ""
    Write-Host "Dossier: $projectPath" -ForegroundColor Cyan
    Write-Host "================================" -ForegroundColor Cyan
    
    foreach ($file in $filesToFix) {
        $fullPath = Join-Path $projectPath $file
        
        if (-not (Test-Path $fullPath)) {
            Write-Host "  ! Fichier non trouve: $file" -ForegroundColor Yellow
            continue
        }
        
        Write-Host "  Correction: $file" -ForegroundColor Cyan
        
        # Lire le fichier
        $content = Get-Content $fullPath -Raw -Encoding UTF8
        
        # Compter les occurrences
        $matches = [regex]::Matches($content, 'Fore\.WHITE')
        $count = $matches.Count
        
        if ($count -eq 0) {
            Write-Host "     OK: Deja corrige (0 occurrences)" -ForegroundColor Green
            continue
        }
        
        # Remplacer
        $newContent = $content -replace 'Fore\.WHITE', 'Fore.CYAN'
        
        # Ecrire le fichier
        [System.IO.File]::WriteAllText($fullPath, $newContent, [System.Text.Encoding]::UTF8)
        
        Write-Host "     OK: Corrige ($count occurrence(s))" -ForegroundColor Green
        $totalFixed += $count
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "TERMINE! $totalFixed corrections appliquees" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Vous pouvez maintenant relancer: .\lance-serveur.ps1"
Write-Host ""
Read-Host "Appuyez sur Entree pour fermer"
