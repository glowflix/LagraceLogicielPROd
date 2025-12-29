# Script pour copier automatiquement la configuration MCP dans Cursor
# Exécutez ce script depuis le dossier du projet

Write-Host ""
Write-Host "Configuration MCP - Copie Automatique" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Déterminer le répertoire du script de manière robuste
$scriptDir = $null

# Essayer différentes méthodes pour trouver le répertoire du script
if ($PSScriptRoot) {
    $scriptDir = $PSScriptRoot
}
elseif ($MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# Si toujours pas trouvé, utiliser le répertoire de travail actuel
if (-not $scriptDir) {
    $scriptDir = $PWD.Path
}
elseif (-not (Test-Path $scriptDir)) {
    $scriptDir = $PWD.Path
}

Write-Host "Repertoire du projet : $scriptDir" -ForegroundColor Gray
Write-Host ""

# Chemin du fichier source (dans le projet)
$sourceFile = Join-Path $scriptDir ".cursor-mcp-config.json"

# Chemin du fichier de destination (dans le dossier utilisateur Cursor)
$destDir = "$env:USERPROFILE\.cursor"
$destFile = Join-Path $destDir "mcp.json"

# Vérifier que le fichier source existe
if (-not (Test-Path $sourceFile)) {
    Write-Host "ERREUR : Le fichier .cursor-mcp-config.json n'existe pas dans ce dossier !" -ForegroundColor Red
    Write-Host "Chemin recherche : $sourceFile" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Assurez-vous d'executer ce script depuis le dossier du projet." -ForegroundColor Yellow
    exit 1
}

# Créer le dossier .cursor s'il n'existe pas
if (-not (Test-Path $destDir)) {
    Write-Host "Creation du dossier .cursor..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Write-Host "Dossier cree : $destDir" -ForegroundColor Green
}

# Lire le contenu du fichier source
Write-Host "Lecture du fichier de configuration..." -ForegroundColor Yellow
$configContent = Get-Content $sourceFile -Raw -Encoding UTF8

# Copier le contenu vers le fichier de destination
Write-Host "Copie de la configuration..." -ForegroundColor Yellow
$configContent | Out-File -FilePath $destFile -Encoding UTF8 -NoNewline

Write-Host ""
Write-Host "Configuration MCP copiee avec succes !" -ForegroundColor Green
Write-Host ""
Write-Host "Fichier de configuration :" -ForegroundColor Cyan
Write-Host "   $destFile" -ForegroundColor White
Write-Host ""
Write-Host "PROCHAINE ETAPE :" -ForegroundColor Yellow
Write-Host "   1. Fermez completement Cursor (toutes les fenetres)" -ForegroundColor White
Write-Host "   2. Rouvrez Cursor" -ForegroundColor White
Write-Host "   3. La configuration MCP sera automatiquement chargee" -ForegroundColor White
Write-Host ""
Write-Host "Pour verifier : Appuyez sur Ctrl+Shift+P et tapez 'MCP'" -ForegroundColor Cyan
Write-Host ""

# Proposer d'ouvrir le fichier
$response = Read-Host "Voulez-vous ouvrir le fichier de configuration maintenant ? (O/N)"
if ($response -eq "O" -or $response -eq "o") {
    notepad $destFile
}
