# Script de correction - Remplace Fore.WHITE par Fore.CYAN
# Utilisation: .\FIX-FORE-WHITE.ps1
# Corrige les DEUX installations

Write-Host "========================================" -ForegroundColor Green
Write-Host "FIX: Fore.WHITE → Fore.CYAN (2 dossiers)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Les deux dossiers du projet
$projectPaths = @(
    "d:\logiciel\La Grace pro\v1",
    "C:\Users\GLOOWFLIX STUDIO\Documents\LA GRACE VERSION FINAL\v1"
)


# Fichiers à corriger
$filesToFix = @(
    "ai-lagrace\main.py",
    "ai-lagrace\services\assistant.py",
    "ai-lagrace\services\socket_client.py"
)

$totalFixed = 0

# Corriger chaque dossier
foreach ($projectPath in $projectPaths) {
    if (-not (Test-Path $projectPath)) {
        Write-Host "⚠️  Dossier non trouvé: $projectPath" -ForegroundColor Yellow
        continue
    }
    
    Write-Host ""
    Write-Host "📁 Dossier: $projectPath" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    
    foreach ($file in $filesToFix) {
        $fullPath = Join-Path $projectPath $file
        
        if (-not (Test-Path $fullPath)) {
            Write-Host "  ⚠️  Fichier non trouvé: $file" -ForegroundColor Yellow
            continue
        }
        
        Write-Host "  🔧 Correction: $file" -ForegroundColor Cyan
        
        # Lire le fichier
        $content = Get-Content $fullPath -Raw -Encoding UTF8
        
        # Compter les occurrences
        $matches = [regex]::Matches($content, 'Fore\.WHITE')
        $count = $matches.Count
        
        if ($count -eq 0) {
            Write-Host "     ✓ Déjà corrigé (0 occurrences)" -ForegroundColor Green
            continue
        }
        
        # Remplacer
        $newContent = $content -replace 'Fore\.WHITE', 'Fore.CYAN'
        
        # Écrire le fichier
        [System.IO.File]::WriteAllText($fullPath, $newContent, [System.Text.Encoding]::UTF8)
        
        Write-Host "     ✅ Corrigé: $count occurrence(s)" -ForegroundColor Green
        $totalFixed += $count
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "✅ TERMINÉ! $totalFixed corrections appliquées" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Vous pouvez maintenant relancer: .\lance serveur (1).bat"
Write-Host ""
Read-Host "Appuyez sur Entrée pour fermer"
