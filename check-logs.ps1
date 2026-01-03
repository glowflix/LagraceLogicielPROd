#!/usr/bin/env pwsh

Write-Host "VERIFICATION DES LOGS ET DB" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# Verifier les logs
$appLog = "$env:APPDATA\Glowflixprojet\logs\app.log"
$errorLog = "$env:APPDATA\Glowflixprojet\logs\error.log"
$db = "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db"

Write-Host ""
Write-Host "1. DATABASE:" -ForegroundColor Yellow
if (Test-Path $db) {
  $size = (Get-Item $db).Length
  Write-Host "[OK] CREEE: $([math]::Round($size/1KB, 2)) KB" -ForegroundColor Green
} else {
  Write-Host "[ERREUR] N'EXISTE PAS" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. APP.LOG:" -ForegroundColor Yellow
if (Test-Path $appLog) {
  Write-Host "[OK] EXISTS - 10 dernieres lignes:" -ForegroundColor Green
  Write-Host ""
  Get-Content $appLog -Tail 10
} else {
  Write-Host "[ERREUR] PAS TROUVE" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "3. ERROR.LOG:" -ForegroundColor Yellow
if (Test-Path $errorLog) {
  $errors = Get-Content $errorLog -Tail 5
  if ($errors) {
    Write-Host "[ERREUR] 5 dernieres:" -ForegroundColor Red
    Write-Host ""
    $errors
  } else {
    Write-Host "[OK] VIDE" -ForegroundColor Green
  }
} else {
  Write-Host "[OK] PAS DE FICHIER" -ForegroundColor Green
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
