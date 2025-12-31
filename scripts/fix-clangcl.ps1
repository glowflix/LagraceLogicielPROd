# Fix ClangCL toolset issue in better-sqlite3 build files

$betterSqlite3Path = "D:\logiciel\La Grace pro\v1\node_modules\better-sqlite3\build"

$filesToFix = @(
    "better_sqlite3.vcxproj",
    "deps\locate_sqlite3.vcxproj",
    "deps\sqlite3.vcxproj",
    "test_extension.vcxproj"
)

foreach ($file in $filesToFix) {
    $fullPath = Join-Path $betterSqlite3Path $file
    if (Test-Path $fullPath) {
        Write-Host "Fixing $file..."
        (Get-Content -Path $fullPath -Raw) -replace "<PlatformToolset>ClangCL</PlatformToolset>", "<PlatformToolset>v143</PlatformToolset>" | Set-Content -Path $fullPath
        Write-Host "OK: $file"
    }
    else {
        Write-Host "Skipped: $fullPath"
    }
}

Write-Host "Done!"
