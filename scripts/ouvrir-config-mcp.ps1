# Script pour ouvrir ou créer le fichier de configuration MCP dans Cursor
# Usage: powershell -ExecutionPolicy Bypass -File scripts/ouvrir-config-mcp.ps1

Write-Host ""
Write-Host "🔍 Configuration MCP pour Cursor" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Chemin du fichier de configuration MCP dans Cursor
$mcpPath = "$env:USERPROFILE\.cursor\mcp.json"
$cursorDir = "$env:USERPROFILE\.cursor"

# Chemin du fichier source dans le projet
$sourceConfig = Join-Path $PSScriptRoot "..\.cursor-mcp-config.json"

Write-Host "📁 Dossier Cursor : $cursorDir" -ForegroundColor Yellow
Write-Host "📄 Fichier MCP : $mcpPath" -ForegroundColor Yellow
Write-Host ""

# Créer le dossier .cursor s'il n'existe pas
if (-not (Test-Path $cursorDir)) {
    Write-Host "📂 Création du dossier .cursor..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $cursorDir -Force | Out-Null
    Write-Host "✅ Dossier créé" -ForegroundColor Green
}

# Vérifier si le fichier source existe
if (Test-Path $sourceConfig) {
    Write-Host "📋 Lecture de la configuration source..." -ForegroundColor Cyan
    $configContent = Get-Content $sourceConfig -Raw -Encoding UTF8
    
    # Vérifier si le fichier mcp.json existe déjà
    if (Test-Path $mcpPath) {
        Write-Host "⚠️  Le fichier mcp.json existe déjà." -ForegroundColor Yellow
        Write-Host "   Voulez-vous le remplacer ? (O/N)" -ForegroundColor Yellow
        $response = Read-Host
        
        if ($response -eq "O" -or $response -eq "o" -or $response -eq "Y" -or $response -eq "y") {
            # Sauvegarder une copie de sauvegarde
            $backupPath = "$mcpPath.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item $mcpPath $backupPath
            Write-Host "💾 Sauvegarde créée : $backupPath" -ForegroundColor Cyan
            
            # Écrire la nouvelle configuration
            $configContent | Out-File -FilePath $mcpPath -Encoding UTF8 -NoNewline
            Write-Host "✅ Configuration mise à jour !" -ForegroundColor Green
        } else {
            Write-Host "ℹ️  Aucune modification effectuée." -ForegroundColor Cyan
        }
    } else {
        # Créer le fichier avec la configuration
        Write-Host "📝 Création du fichier mcp.json..." -ForegroundColor Cyan
        $configContent | Out-File -FilePath $mcpPath -Encoding UTF8 -NoNewline
        Write-Host "✅ Fichier créé avec succès !" -ForegroundColor Green
    }
} else {
    Write-Host "⚠️  Fichier source non trouvé : $sourceConfig" -ForegroundColor Yellow
    Write-Host "   Création d'un fichier vide..." -ForegroundColor Yellow
    
    # Créer un fichier avec la configuration par défaut
    $defaultConfig = @"
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
"@
    $defaultConfig | Out-File -FilePath $mcpPath -Encoding UTF8 -NoNewline
    Write-Host "✅ Fichier créé avec la configuration par défaut" -ForegroundColor Green
}

Write-Host ""
Write-Host "📋 Contenu du fichier mcp.json :" -ForegroundColor Cyan
Write-Host "--------------------------------" -ForegroundColor Cyan
if (Test-Path $mcpPath) {
    Get-Content $mcpPath | Write-Host
} else {
    Write-Host "❌ Fichier non trouvé" -ForegroundColor Red
}

Write-Host ""
Write-Host "🔄 PROCHAINES ÉTAPES :" -ForegroundColor Yellow
Write-Host "   1. Vérifiez le contenu ci-dessus" -ForegroundColor White
Write-Host "   2. Redémarrez Cursor complètement" -ForegroundColor White
Write-Host "   3. Ouvrez les paramètres Cursor (Ctrl + ,)" -ForegroundColor White
Write-Host "   4. Recherchez 'MCP' pour vérifier la configuration" -ForegroundColor White
Write-Host ""

# Demander si l'utilisateur veut ouvrir le fichier
Write-Host "💡 Voulez-vous ouvrir le fichier dans Notepad ? (O/N)" -ForegroundColor Cyan
$openFile = Read-Host

if ($openFile -eq "O" -or $openFile -eq "o" -or $openFile -eq "Y" -or $openFile -eq "y") {
    if (Test-Path $mcpPath) {
        notepad $mcpPath
        Write-Host "✅ Fichier ouvert dans Notepad" -ForegroundColor Green
    } else {
        Write-Host "❌ Impossible d'ouvrir le fichier" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✨ Terminé !" -ForegroundColor Green
Write-Host ""

