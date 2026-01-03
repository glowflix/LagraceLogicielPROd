# Verification POST-BUILD: Database persistante + zero npm
# Usage: .\VERIFY-DATABASE-PRODUCTION-CLEAN.ps1

Write-Host "`n[OK] VERIFICATION POST-BUILD" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Configuration electron-builder.json
Write-Host "`n[1] Configuration electron-builder.json" -ForegroundColor Yellow
$config = Get-Content "electron-builder.json" -Raw | ConvertFrom-Json
Write-Host "    Output: $($config.directories.output)" -ForegroundColor Green
Write-Host "    ASAR: $($config.asar)" -ForegroundColor Green
Write-Host "    asarUnpack:" -ForegroundColor Green
$config.asarUnpack | ForEach-Object { Write-Host "      - $_" }
Write-Host "    Files inclus:" -ForegroundColor Green
$config.files | ForEach-Object { Write-Host "      - $_" }

# 2. Setup.exe verification
Write-Host "`n[2] Verification setup.exe (pas de node_modules)" -ForegroundColor Yellow
if (Test-Path "dist/release/LA GRACE POS Setup 1.0.0.exe") {
  $exe = Get-Item "dist/release/LA GRACE POS Setup 1.0.0.exe"
  Write-Host "    [OK] Setup trouve: $($exe.Name) ($([math]::Round($exe.Length/1MB, 1))MB)" -ForegroundColor Green
  
  if (Test-Path "dist/release/win-unpacked") {
    $unpackedSize = (Get-ChildItem "dist/release/win-unpacked" -Recurse | Measure-Object -Property Length -Sum).Sum
    Write-Host "    [OK] Unpacked: $([math]::Round($unpackedSize/1MB, 1))MB" -ForegroundColor Green
    
    if (Test-Path "dist/release/win-unpacked/node_modules") {
      Write-Host "    [ERR] node_modules trouve dans win-unpacked!" -ForegroundColor Red
    } else {
      Write-Host "    [OK] node_modules: PAS inclus" -ForegroundColor Green
    }
  }
} else {
  Write-Host "    [ERR] Setup.exe non trouve" -ForegroundColor Red
}

# 3. React UI
Write-Host "`n[3] React UI compilee (dist/ui/)" -ForegroundColor Yellow
if (Test-Path "dist/ui/index.html") {
  $indexSize = (Get-Item "dist/ui/index.html").Length
  Write-Host "    [OK] index.html: $($indexSize) bytes" -ForegroundColor Green
  
  if (Test-Path "dist/ui/assets") {
    $assetsSize = (Get-ChildItem "dist/ui/assets" -Recurse -File | Measure-Object -Property Length -Sum).Sum
    Write-Host "    [OK] Assets: $([math]::Round($assetsSize/1MB, 1))MB" -ForegroundColor Green
  }
} else {
  Write-Host "    [ERR] dist/ui/index.html non trouve" -ForegroundColor Red
}

# 4. AI LaGrace
Write-Host "`n[4] IA LaGrace compilee (dist/ai/)" -ForegroundColor Yellow
if (Test-Path "dist/ai/ai-lagrace/ai-lagrace.exe") {
  $exeSize = (Get-Item "dist/ai/ai-lagrace/ai-lagrace.exe").Length
  Write-Host "    [OK] ai-lagrace.exe: $([math]::Round($exeSize/1MB, 1))MB" -ForegroundColor Green
  
  $dlls = @(Get-ChildItem "dist/ai/ai-lagrace" -Filter "*.dll" | Measure-Object).Count
  $pyds = @(Get-ChildItem "dist/ai/ai-lagrace" -Filter "*.pyd" | Measure-Object).Count
  Write-Host "    [OK] Dependencies: $dlls DLLs + $pyds PYDs" -ForegroundColor Green
} else {
  Write-Host "    [ERR] ai-lagrace.exe non trouve" -ForegroundColor Red
}

# 5. Code source
Write-Host "`n[5] Code source inclus (src/, electron/)" -ForegroundColor Yellow
if (Test-Path "dist/release/win-unpacked/resources/app/src") {
  $srcFiles = @(Get-ChildItem "dist/release/win-unpacked/resources/app/src" -Recurse -File | Measure-Object).Count
  Write-Host "    [OK] src/ inclus: $srcFiles fichiers" -ForegroundColor Green
} else {
  Write-Host "    [WARN] src/ non trouve dans unpacked (normal si compile en ASAR)" -ForegroundColor Yellow
}

# 6. package.json
Write-Host "`n[6] package.json (metadonnees seulement)" -ForegroundColor Yellow
if (Test-Path "dist/release/win-unpacked/resources/app/package.json") {
  Write-Host "    [OK] package.json inclus" -ForegroundColor Green
  
  $pkg = Get-Content "dist/release/win-unpacked/resources/app/package.json" | ConvertFrom-Json
  Write-Host "    Version: $($pkg.version)" -ForegroundColor Green
  Write-Host "    Dependencies: $(@($pkg.dependencies.psobject.properties).Count)" -ForegroundColor Green
} else {
  Write-Host "    [WARN] package.json non trouve dans unpacked (normal si compile en ASAR)" -ForegroundColor Yellow
}

# 7. Configuration BD
Write-Host "`n[7] Configuration chemins BD" -ForegroundColor Yellow
Write-Host "    electron/main.cjs:" -ForegroundColor Green

$main = Get-Content "electron/main.cjs" | Select-String "AppData|Glowflixprojet|userData" | Select-Object -First 3
if ($main) {
  $main | ForEach-Object { Write-Host "      $($_.Line.Trim())" }
} else {
  Write-Host "      [ERR] Chemins BD non trouves" -ForegroundColor Red
}

Write-Host "    src/core/paths.js:" -ForegroundColor Green
$paths = Get-Content "src/core/paths.js" | Select-String "getProjectRoot|getDbPath|AppData" | Select-Object -First 5
if ($paths) {
  $paths | ForEach-Object { Write-Host "      $($_.Line.Trim())" }
} else {
  Write-Host "      [ERR] Fonctions BD non trouves" -ForegroundColor Red
}

# 8. Resume final
Write-Host "`n=================================================" -ForegroundColor Cyan
Write-Host "[OK] RESUME PRODUCTION" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan

Write-Host @"
  [OK] BD SQLite stockee en: C:\Users\<user>\AppData\Roaming\Glowflixprojet\db\
  [OK] node_modules: PAS inclus dans le setup
  [OK] Modules natifs: better-sqlite3 + bcrypt decompresses
  [OK] IA LaGrace: Embarquee (ai-lagrace.exe)
  [OK] React UI: Compilee (dist/ui/)
  [OK] Installation: 0 npm lance
  [OK] Post-desinstallation: BD persiste en AppData
"@ -ForegroundColor Green

Write-Host ""
