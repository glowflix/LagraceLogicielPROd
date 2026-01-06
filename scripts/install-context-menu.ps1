# ============================================================================
# LA GRACE POS - Installation Menu Contextuel Windows
# Ce script ajoute une entrée "PowerShell Pro" dans le menu contextuel
# ============================================================================

param(
    [switch]$Uninstall,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Chemins du registre
$exeKeyPath = "Registry::HKEY_CLASSES_ROOT\exefile\shell\LaGracePowerShell"
$exeCommandPath = "$exeKeyPath\command"

# Icône PowerShell
$psIcon = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe,0"

function Write-ColorMessage {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-ContextMenu {
    Write-ColorMessage "`n╔══════════════════════════════════════════════════════════════╗" "Cyan"
    Write-ColorMessage "║  🚀 Installation Menu Contextuel - LA GRACE POS              ║" "Cyan"
    Write-ColorMessage "╚══════════════════════════════════════════════════════════════╝`n" "Cyan"

    if (-not (Test-Admin)) {
        Write-ColorMessage "❌ Ce script nécessite les droits administrateur!" "Red"
        Write-ColorMessage "   Relancez PowerShell en tant qu'Administrateur" "Yellow"
        
        # Auto-élévation
        $scriptPath = $MyInvocation.ScriptName
        if ($scriptPath) {
            Write-ColorMessage "`n🔄 Tentative d'élévation automatique..." "Yellow"
            Start-Process powershell.exe -ArgumentList "-ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb RunAs
            exit
        }
        return
    }

    Write-ColorMessage "✅ Droits administrateur confirmés" "Green"

    # Créer la clé principale
    Write-ColorMessage "📝 Création de l'entrée menu contextuel..." "Yellow"
    
    try {
        # Supprimer si existe déjà
        if (Test-Path $exeKeyPath) {
            Remove-Item -Path $exeKeyPath -Recurse -Force
        }

        # Créer la nouvelle entrée
        New-Item -Path $exeKeyPath -Force | Out-Null
        
        # Définir le nom affiché dans le menu
        Set-ItemProperty -Path $exeKeyPath -Name "(Default)" -Value "⚡ PowerShell Pro - LA GRACE"
        Set-ItemProperty -Path $exeKeyPath -Name "Icon" -Value $psIcon
        
        # Créer la commande
        New-Item -Path $exeCommandPath -Force | Out-Null
        
        # Script PowerShell qui s'exécute au clic
        $command = @'
powershell.exe -NoExit -ExecutionPolicy Bypass -Command "& {
    $exePath = '%1'
    $exeDir = Split-Path -Parent $exePath
    $exeName = Split-Path -Leaf $exePath
    
    Set-Location $exeDir
    
    Write-Host ''
    Write-Host '╔══════════════════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
    Write-Host '║  ⚡ PowerShell Pro - LA GRACE POS                                    ║' -ForegroundColor Cyan
    Write-Host '╠══════════════════════════════════════════════════════════════════════╣' -ForegroundColor Cyan
    Write-Host '║  📁 Dossier: ' -NoNewline -ForegroundColor White
    Write-Host $exeDir.Substring(0, [Math]::Min(54, $exeDir.Length)).PadRight(54) '║' -ForegroundColor Yellow
    Write-Host '║  📄 Fichier: ' -NoNewline -ForegroundColor White
    Write-Host $exeName.PadRight(54) '║' -ForegroundColor Green
    Write-Host '╚══════════════════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
    Write-Host ''
    
    Write-Host '🔧 COMMANDES DISPONIBLES:' -ForegroundColor Magenta
    Write-Host '─────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host '  [1] run        - Lancer l''application' -ForegroundColor White
    Write-Host '  [2] logs       - Voir les logs en temps réel' -ForegroundColor White
    Write-Host '  [3] db         - Ouvrir le dossier base de données' -ForegroundColor White
    Write-Host '  [4] print      - Ouvrir le dossier impression' -ForegroundColor White
    Write-Host '  [5] config     - Voir la configuration' -ForegroundColor White
    Write-Host '  [6] kill       - Arrêter tous les processus LA GRACE' -ForegroundColor White
    Write-Host '  [7] unlock     - Débloquer les fichiers verrouillés' -ForegroundColor White
    Write-Host '  [8] rebuild    - Reconstruire l''application' -ForegroundColor White
    Write-Host '  [9] status     - État du système' -ForegroundColor White
    Write-Host '  [0] help       - Afficher cette aide' -ForegroundColor White
    Write-Host '─────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host ''
    
    # Définir les fonctions utilitaires
    function run { 
        Write-Host '🚀 Lancement de l''application...' -ForegroundColor Green
        Start-Process $exePath
    }
    
    function logs {
        `$logPath = Join-Path `$env:APPDATA 'LA GRACE POS\logs\main.log'
        if (Test-Path `$logPath) {
            Write-Host '📋 Logs en temps réel (Ctrl+C pour arrêter):' -ForegroundColor Yellow
            Get-Content `$logPath -Tail 50 -Wait
        } else {
            Write-Host '❌ Fichier log non trouvé: ' `$logPath -ForegroundColor Red
        }
    }
    
    function db {
        `$dbPath = Join-Path `$env:APPDATA 'LA GRACE POS'
        if (Test-Path `$dbPath) {
            explorer.exe `$dbPath
            Write-Host '📁 Dossier ouvert: ' `$dbPath -ForegroundColor Green
        } else {
            Write-Host '❌ Dossier non trouvé' -ForegroundColor Red
        }
    }
    
    function print {
        `$printPath = 'C:\Glowflixprojet\printer'
        if (Test-Path `$printPath) {
            explorer.exe `$printPath
            Write-Host '🖨️ Dossier impression ouvert' -ForegroundColor Green
        } else {
            New-Item -Path `$printPath -ItemType Directory -Force | Out-Null
            explorer.exe `$printPath
            Write-Host '🖨️ Dossier impression créé et ouvert' -ForegroundColor Yellow
        }
    }
    
    function config {
        Write-Host '⚙️ Configuration système:' -ForegroundColor Cyan
        Write-Host '─────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
        Write-Host '  APPDATA:      ' `$env:APPDATA -ForegroundColor White
        Write-Host '  Dossier EXE:  ' `$exeDir -ForegroundColor White
        Write-Host '  Resources:    ' (Join-Path `$exeDir 'resources') -ForegroundColor White
        `$configPath = Join-Path `$exeDir 'resources\config.env'
        if (Test-Path `$configPath) {
            Write-Host '  Config:       ' `$configPath '✅' -ForegroundColor Green
            Write-Host '─────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
            Get-Content `$configPath | ForEach-Object { Write-Host '  ' `$_ -ForegroundColor Gray }
        } else {
            Write-Host '  Config:       Non trouvé ❌' -ForegroundColor Red
        }
    }
    
    function kill {
        Write-Host '🛑 Arrêt des processus LA GRACE...' -ForegroundColor Yellow
        Get-Process | Where-Object { `$_.ProcessName -match 'LA GRACE|lagrace|node|electron' } | ForEach-Object {
            Write-Host '  Arrêt: ' `$_.ProcessName '(PID: ' `$_.Id ')' -ForegroundColor Red
            Stop-Process -Id `$_.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host '✅ Terminé' -ForegroundColor Green
    }
    
    function unlock {
        Write-Host '🔓 Recherche des fichiers verrouillés...' -ForegroundColor Yellow
        `$asarPath = Join-Path `$exeDir 'resources\app.asar'
        if (Test-Path `$asarPath) {
            `$handles = handle.exe `$asarPath 2>`$null
            if (`$handles) {
                Write-Host `$handles -ForegroundColor Gray
            } else {
                Write-Host '  Aucun verrou détecté ou handle.exe non installé' -ForegroundColor Green
            }
        }
        Write-Host ''
        Write-Host '💡 Pour débloquer, exécutez: kill' -ForegroundColor Cyan
    }
    
    function rebuild {
        `$projectRoot = 'D:\logiciel\La Grace pro\v1'
        if (Test-Path `$projectRoot) {
            Set-Location `$projectRoot
            Write-Host '🔨 Reconstruction en cours...' -ForegroundColor Yellow
            npm run build
        } else {
            Write-Host '❌ Dossier projet non trouvé: ' `$projectRoot -ForegroundColor Red
        }
    }
    
    function status {
        Write-Host '📊 État du système LA GRACE POS:' -ForegroundColor Cyan
        Write-Host '─────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
        
        # Processus
        `$procs = Get-Process | Where-Object { `$_.ProcessName -match 'LA GRACE|lagrace|electron' }
        if (`$procs) {
            Write-Host '  ✅ Application en cours d''exécution' -ForegroundColor Green
            `$procs | ForEach-Object { Write-Host '     - ' `$_.ProcessName '(PID: ' `$_.Id ')' -ForegroundColor White }
        } else {
            Write-Host '  ❌ Application non démarrée' -ForegroundColor Red
        }
        
        # Port 3030
        `$port = Get-NetTCPConnection -LocalPort 3030 -ErrorAction SilentlyContinue
        if (`$port) {
            Write-Host '  ✅ Port 3030 actif (Backend)' -ForegroundColor Green
        } else {
            Write-Host '  ❌ Port 3030 inactif' -ForegroundColor Red
        }
        
        # Base de données
        `$dbFile = Join-Path `$env:APPDATA 'LA GRACE POS\lagrace.db'
        if (Test-Path `$dbFile) {
            `$size = (Get-Item `$dbFile).Length / 1MB
            Write-Host ('  ✅ Base de données: {0:N2} MB' -f `$size) -ForegroundColor Green
        } else {
            Write-Host '  ❌ Base de données non trouvée' -ForegroundColor Red
        }
        
        # Dossier impression
        `$printDir = 'C:\Glowflixprojet\printer'
        if (Test-Path `$printDir) {
            `$pending = (Get-ChildItem `$printDir -Filter 'job-*.json' -ErrorAction SilentlyContinue).Count
            Write-Host '  ✅ Dossier impression: ' `$pending ' jobs en attente' -ForegroundColor Green
        } else {
            Write-Host '  ⚠️ Dossier impression non créé' -ForegroundColor Yellow
        }
        
        Write-Host '─────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
    }
    
    function help {
        Write-Host ''
        Write-Host '🔧 COMMANDES DISPONIBLES:' -ForegroundColor Magenta
        Write-Host '─────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
        Write-Host '  run        - Lancer l''application' -ForegroundColor White
        Write-Host '  logs       - Voir les logs en temps réel' -ForegroundColor White
        Write-Host '  db         - Ouvrir le dossier base de données' -ForegroundColor White
        Write-Host '  print      - Ouvrir le dossier impression' -ForegroundColor White
        Write-Host '  config     - Voir la configuration' -ForegroundColor White
        Write-Host '  kill       - Arrêter tous les processus LA GRACE' -ForegroundColor White
        Write-Host '  unlock     - Débloquer les fichiers verrouillés' -ForegroundColor White
        Write-Host '  rebuild    - Reconstruire l''application' -ForegroundColor White
        Write-Host '  status     - État du système' -ForegroundColor White
        Write-Host '  help       - Afficher cette aide' -ForegroundColor White
        Write-Host '─────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
    }
    
    Write-Host '💡 Tapez une commande (ex: status, logs, run)' -ForegroundColor Cyan
    Write-Host ''
}"
'@
        
        Set-ItemProperty -Path $exeCommandPath -Name "(Default)" -Value $command

        Write-ColorMessage "`n✅ Menu contextuel installé avec succès!" "Green"
        Write-ColorMessage ""
        Write-ColorMessage "📋 UTILISATION:" "Cyan"
        Write-ColorMessage "   1. Clic droit sur n'importe quel fichier .exe" "White"
        Write-ColorMessage "   2. Sélectionner '⚡ PowerShell Pro - LA GRACE'" "White"
        Write-ColorMessage "   3. Une console PowerShell s'ouvre avec les outils" "White"
        Write-ColorMessage ""
        
    } catch {
        Write-ColorMessage "❌ Erreur: $_" "Red"
        return
    }
}

function Uninstall-ContextMenu {
    Write-ColorMessage "`n🗑️ Désinstallation du menu contextuel..." "Yellow"
    
    if (-not (Test-Admin)) {
        Write-ColorMessage "❌ Droits administrateur requis!" "Red"
        return
    }
    
    if (Test-Path $exeKeyPath) {
        Remove-Item -Path $exeKeyPath -Recurse -Force
        Write-ColorMessage "✅ Menu contextuel supprimé" "Green"
    } else {
        Write-ColorMessage "⚠️ Menu contextuel non installé" "Yellow"
    }
}

# Point d'entrée
if ($Uninstall) {
    Uninstall-ContextMenu
} else {
    Install-ContextMenu
}

Write-Host ""
Write-Host "Appuyez sur une touche pour fermer..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
