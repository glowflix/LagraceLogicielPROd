#!/usr/bin/env powershell

# Fix ClangCL toolset in better-sqlite3 vcxproj files

$files = @(
  "D:\logiciel\La Grace pro\v1\node_modules\better-sqlite3\build\better_sqlite3.vcxproj",
  "D:\logiciel\La Grace pro\v1\node_modules\better-sqlite3\build\deps\sqlite3.vcxproj",
  "D:\logiciel\La Grace pro\v1\node_modules\better-sqlite3\build\deps\locate_sqlite3.vcxproj",
  "D:\logiciel\La Grace pro\v1\node_modules\better-sqlite3\build\test_extension.vcxproj"
)

foreach ($file in $files) {
  if (Test-Path $file) {
    $content = Get-Content $file -Raw
    $content = $content -replace '<PlatformToolset>ClangCL</PlatformToolset>', '<PlatformToolset>v143</PlatformToolset>'
    Set-Content $file $content
    Write-Host "Fixed $file"
  }
}
