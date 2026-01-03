# POST-INSTALLATION VERIFICATION CHECKLIST

After installing **LA GRACE POS**, use this checklist to verify everything is working correctly.

## ✅ Installation Verification

```powershell
# 1. Check if app is installed
$appPath = "C:\Program Files\LA GRACE POS"
if (Test-Path $appPath) {
  Write-Host "[OK] App installed at: $appPath"
} else {
  Write-Host "[ERR] App not found!"
}

# 2. Check database location
$dbPath = "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db"
if (Test-Path $dbPath) {
  Write-Host "[OK] Database created: $dbPath"
  $size = (Get-Item $dbPath).Length
  Write-Host "    Size: $($size) bytes"
} else {
  Write-Host "[WARN] Database not yet created (will be on first launch)"
}

# 3. Check data folder
$dataPath = "$env:APPDATA\Glowflixprojet"
if (Test-Path $dataPath) {
  Write-Host "[OK] Data folder exists: $dataPath"
  Get-ChildItem $dataPath -Directory | ForEach-Object {
    Write-Host "      - $_"
  }
}

# 4. List installed files
Write-Host "[INFO] Installed files:"
Get-ChildItem "C:\Program Files\LA GRACE POS" | ForEach-Object {
  Write-Host "       - $_"
}
```

## 🚀 First Launch Verification

1. **Start the app:**
   ```powershell
   Start-Process "C:\Program Files\LA GRACE POS\LA GRACE POS.exe"
   ```

2. **Check output:**
   - Should see Electron window open
   - Should see "Express prêt" in console
   - UI should load at http://localhost:3030/

3. **Verify database was created:**
   ```powershell
   $dbPath = "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db"
   if ((Get-Item $dbPath).Length -gt 1000) {
     Write-Host "[OK] Database initialized successfully"
   }
   ```

## 🔍 Database Health Check

```powershell
# Check database file
$dbPath = "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db"

$dbFile = Get-Item $dbPath -ErrorAction SilentlyContinue
if ($dbFile) {
  Write-Host "[OK] Database file exists"
  Write-Host "     Path: $dbPath"
  Write-Host "     Size: $($dbFile.Length) bytes"
  Write-Host "     Created: $($dbFile.CreationTime)"
  Write-Host "     Modified: $($dbFile.LastWriteTime)"
} else {
  Write-Host "[ERR] Database file not found"
}

# Check WAL files (Write-Ahead Logging)
$walFile = Get-Item "$dbPath-wal" -ErrorAction SilentlyContinue
if ($walFile) {
  Write-Host "[OK] WAL log found: $($walFile.Length) bytes"
}

$shmFile = Get-Item "$dbPath-shm" -ErrorAction SilentlyContinue
if ($shmFile) {
  Write-Host "[OK] SHM temp found: $($shmFile.Length) bytes"
}
```

## 🌐 Network/API Verification

```powershell
# 1. Check if backend is listening
$port = 3030
$listening = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($listening) {
  Write-Host "[OK] Backend listening on port $port"
  Write-Host "     Process: $($listening.OwningProcess)"
} else {
  Write-Host "[WARN] Port $port not listening (app may not be running)"
}

# 2. Test API health endpoint
try {
  $response = Invoke-WebRequest -Uri "http://localhost:3030/api/health" -TimeoutSec 3
  if ($response.StatusCode -eq 200) {
    Write-Host "[OK] API health check passed"
    Write-Host "     Response: $($response.Content)"
  }
} catch {
  Write-Host "[ERR] API health check failed: $_"
}

# 3. Test main page loads
try {
  $response = Invoke-WebRequest -Uri "http://localhost:3030/" -TimeoutSec 3
  if ($response.StatusCode -eq 200) {
    Write-Host "[OK] Main page loads successfully"
    Write-Host "     HTML size: $($response.Content.Length) bytes"
  }
} catch {
  Write-Host "[ERR] Main page load failed: $_"
}
```

## 📁 Folder Structure Verification

```powershell
# Expected structure after first launch
$expectedDirs = @(
  "db",                   # Database
  "data",                 # Data files
  "data/cache",
  "data/imports",
  "data/exports",
  "data/backups",
  "data/attachments",
  "logs",                 # Application logs
  "printer",              # Printer files
  "config"                # Configuration
)

$dataRoot = "$env:APPDATA\Glowflixprojet"

Write-Host "[INFO] Checking folder structure in: $dataRoot"
foreach ($dir in $expectedDirs) {
  $path = Join-Path $dataRoot $dir
  if (Test-Path $path) {
    Write-Host "  [OK] $dir"
  } else {
    Write-Host "  [ERR] $dir - MISSING"
  }
}
```

## 🔧 Configuration Verification

```powershell
# Check if logs are being created
$logsPath = "$env:APPDATA\Glowflixprojet\logs"
if (Test-Path $logsPath) {
  $logFiles = Get-ChildItem $logsPath -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($logFiles) {
    Write-Host "[OK] Log file created: $($logFiles.Name)"
    Write-Host "     Size: $($logFiles.Length) bytes"
    Write-Host "     Time: $($logFiles.LastWriteTime)"
  } else {
    Write-Host "[WARN] No log files found yet"
  }
}

# Check environment variables
Write-Host "[INFO] Environment variables:"
Write-Host "  GLOWFLIX_ROOT_DIR: $env:GLOWFLIX_ROOT_DIR"
Write-Host "  LAGRACE_DATA_DIR: $env:LAGRACE_DATA_DIR"
```

## ❌ Troubleshooting

### If database is not created
```powershell
# 1. Check permissions
Write-Host "Checking AppData permissions..."
$acl = Get-Acl "$env:APPDATA"
$acl.Access | Where-Object { $_.IdentityReference -like "*$env:USERNAME*" } | ForEach-Object {
  Write-Host "  $($_.IdentityReference): $($_.FileSystemRights)"
}

# 2. Manually create the folder
New-Item "$env:APPDATA\Glowflixprojet\db" -Type Directory -Force | Out-Null
Write-Host "[OK] Created folder structure"

# 3. Restart the app
```

### If port 3030 is in use
```powershell
# Find process using port 3030
$proc = Get-NetTCPConnection -LocalPort 3030 -ErrorAction SilentlyContinue
if ($proc) {
  Write-Host "[ERR] Port 3030 already in use by process: $($proc.OwningProcess)"
  
  # Get process details
  Get-Process -Id $proc.OwningProcess | ForEach-Object {
    Write-Host "      Name: $($_.ProcessName)"
    Write-Host "      Path: $($_.Path)"
  }
  
  # Kill it if needed
  # Stop-Process -Id $proc.OwningProcess -Force
}
```

### If database is corrupted
```powershell
# Backup and reset
$dbPath = "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db"
$backup = "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"

Copy-Item $dbPath $backup
Write-Host "[OK] Backup created: $backup"

# Remove corrupted database (will be recreated on next launch)
Remove-Item $dbPath
Write-Host "[OK] Removed corrupted database"
Write-Host "     App will create a fresh database on next launch"
```

## 📊 Summary Checklist

- [ ] App installed at `C:\Program Files\LA GRACE POS`
- [ ] Database created at `%APPDATA%\Glowflixprojet\db\`
- [ ] Data folder structure created
- [ ] First launch completed
- [ ] Backend listening on port 3030
- [ ] API health check passes
- [ ] Main page loads
- [ ] Database file is not empty
- [ ] Logs being created
- [ ] No npm processes running

---

## For Support

If anything fails:
1. Check the logs: `%APPDATA%\Glowflixprojet\logs\`
2. Run these verification scripts
3. Compare output with this checklist
4. Report any missing steps

**Expected result:** All checks pass ✅
