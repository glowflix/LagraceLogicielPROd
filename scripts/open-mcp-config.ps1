# Script pour ouvrir ou créer le fichier de configuration MCP dans Cursor

Write-Host "🔍 Recherche du fichier de configuration MCP..." -ForegroundColor Cyan
Write-Host ""

$mcpConfigPath = "$env:USERPROFILE\.cursor\mcp.json"
$settingsPath = "$env:APPDATA\Cursor\User\settings.json"
$cursorConfigPath = "$env:USERPROFILE\.cursor\config.json"

$configToUse = $null

# Vérifier mcp.json
if (Test-Path $mcpConfigPath) {
    Write-Host "✅ Fichier trouvé: $mcpConfigPath" -ForegroundColor Green
    $configToUse = $mcpConfigPath
}
# Vérifier config.json dans .cursor
elseif (Test-Path $cursorConfigPath) {
    Write-Host "✅ Fichier trouvé: $cursorConfigPath" -ForegroundColor Green
    $configToUse = $cursorConfigPath
}
# Vérifier settings.json de Cursor
elseif (Test-Path $settingsPath) {
    Write-Host "✅ Fichier trouvé: $settingsPath" -ForegroundColor Green
    $configToUse = $settingsPath
}
# Créer mcp.json si aucun fichier n'existe
else {
    Write-Host "⚠️  Aucun fichier de configuration MCP trouvé" -ForegroundColor Yellow
    Write-Host "📝 Création du fichier: $mcpConfigPath" -ForegroundColor Cyan
    
    # Créer le dossier s'il n'existe pas
    $cursorDir = "$env:USERPROFILE\.cursor"
    if (-not (Test-Path $cursorDir)) {
        New-Item -ItemType Directory -Path $cursorDir -Force | Out-Null
    }
    
    # Configuration par défaut
    $defaultConfig = @{
        mcpServers = @{
            "chrome-devtools" = @{
                command = "npx"
                args = @("-y", "chrome-devtools-mcp@latest")
            }
        }
    } | ConvertTo-Json -Depth 10
    
    # Écrire le fichier
    $defaultConfig | Out-File -FilePath $mcpConfigPath -Encoding UTF8
    Write-Host "✅ Fichier créé avec la configuration par défaut" -ForegroundColor Green
    $configToUse = $mcpConfigPath
}

Write-Host ""
Write-Host "📂 Ouverture du fichier dans Cursor..." -ForegroundColor Cyan
Write-Host "   Chemin: $configToUse" -ForegroundColor Gray
Write-Host ""

# Ouvrir dans Cursor
try {
    # Essayer d'ouvrir avec Cursor
    Start-Process "cursor" -ArgumentList "`"$configToUse`"" -ErrorAction SilentlyContinue
    
    # Si ça ne fonctionne pas, ouvrir avec Notepad
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Name "Cursor" -ErrorAction SilentlyContinue)) {
        Write-Host "⚠️  Cursor n'a pas pu être lancé. Ouverture avec Notepad..." -ForegroundColor Yellow
        notepad $configToUse
    }
} catch {
    Write-Host "⚠️  Impossible d'ouvrir avec Cursor. Ouverture avec Notepad..." -ForegroundColor Yellow
    notepad $configToUse
}

Write-Host ""
Write-Host "✅ Fichier ouvert !" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Instructions:" -ForegroundColor Cyan
Write-Host "   1. Si le fichier est vide ou ne contient pas 'mcpServers', ajoutez cette configuration:" -ForegroundColor White
Write-Host ""
Write-Host '   {' -ForegroundColor Gray
Write-Host '     "mcpServers": {' -ForegroundColor Gray
Write-Host '       "chrome-devtools": {' -ForegroundColor Gray
Write-Host '         "command": "npx",' -ForegroundColor Gray
Write-Host '         "args": ["-y", "chrome-devtools-mcp@latest"]' -ForegroundColor Gray
Write-Host '       }' -ForegroundColor Gray
Write-Host '     }' -ForegroundColor Gray
Write-Host '   }' -ForegroundColor Gray
Write-Host ""
Write-Host "   2. Sauvegardez le fichier (Ctrl+S)" -ForegroundColor White
Write-Host "   3. Redémarrez Cursor complètement" -ForegroundColor White
Write-Host ""

