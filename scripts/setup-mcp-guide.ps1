# Script PowerShell pour guider la configuration Chrome DevTools MCP
# Affiche les instructions et ouvre les fichiers nécessaires

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Configuration Chrome DevTools MCP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Vérifier Node.js
Write-Host "Vérification de Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js $nodeVersion installé" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js non trouvé" -ForegroundColor Red
    Write-Host "   Installez Node.js depuis https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Vérifier npx
Write-Host "Vérification de npx..." -ForegroundColor Yellow
try {
    $npxVersion = npx --version
    Write-Host "✅ npx disponible" -ForegroundColor Green
} catch {
    Write-Host "❌ npx non trouvé" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Instructions de configuration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Ouvrez Cursor Settings :" -ForegroundColor Yellow
Write-Host "   - Appuyez sur Ctrl+, (ou Cmd+, sur Mac)" -ForegroundColor White
Write-Host "   - Ou allez dans File → Preferences → Settings" -ForegroundColor White
Write-Host ""
Write-Host "2. Dans les paramètres, recherchez 'MCP'" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Cliquez sur 'New MCP Server' ou 'Add MCP Server'" -ForegroundColor Yellow
Write-Host ""
Write-Host "4. Copiez la configuration suivante :" -ForegroundColor Yellow
Write-Host ""

# Afficher la configuration
$config = @"
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
"@

Write-Host $config -ForegroundColor Cyan
Write-Host ""

Write-Host "5. Collez cette configuration dans Cursor Settings" -ForegroundColor Yellow
Write-Host ""
Write-Host "6. Redémarrez Cursor" -ForegroundColor Yellow
Write-Host ""

# Demander si l'utilisateur veut ouvrir les fichiers
$openFiles = Read-Host "Voulez-vous ouvrir les fichiers de configuration ? (O/N)"
if ($openFiles -eq "O" -or $openFiles -eq "o") {
    $configFile = Join-Path $PSScriptRoot "..\.cursor-mcp-config.json"
    if (Test-Path $configFile) {
        Write-Host "Ouverture de .cursor-mcp-config.json..." -ForegroundColor Green
        notepad $configFile
    }
    
    $docFile = Join-Path $PSScriptRoot "..\SETUP-CHROME-DEVTOOLS-MCP.md"
    if (Test-Path $docFile) {
        Write-Host "Ouverture de SETUP-CHROME-DEVTOOLS-MCP.md..." -ForegroundColor Green
        Start-Process $docFile
    }
}

Write-Host ""
Write-Host "✅ Configuration terminée !" -ForegroundColor Green
Write-Host ""
Write-Host "Pour tester, demandez à l'IA dans Cursor :" -ForegroundColor Yellow
Write-Host '  "Lis les messages console de Chrome"' -ForegroundColor Cyan
Write-Host ""

