# LT-IDP web server starter (used by Task Scheduler / NSSM / manual runs).
# Usage:
#   .\scripts\start-lt-idp-web.ps1
#   .\scripts\start-lt-idp-web.ps1 -InstallDir "C:\Users\sparing\LT-IDP" -DataDir "C:\ProgramData\LT-IDP\data" -Port 3001
#   .\scripts\start-lt-idp-web.ps1 -NodeExe "C:\nvm4w\nodejs\node.exe"

[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$DataDir = (Join-Path $env:ProgramData "LT-IDP\data"),
  [int]$Port = 3001,
  [string]$NodeExe = ""
)

$ErrorActionPreference = "Stop"

# Default install dir = repo root (parent of scripts/)
if (-not $InstallDir) {
  $InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$serverJs = Join-Path $InstallDir "dist-server\server\index.js"
if (-not (Test-Path $serverJs)) {
  throw "Built server not found: $serverJs`nRun 'npm run build:web' in $InstallDir first."
}

function Resolve-NodeExe {
  param([string]$Preferred)
  if ($Preferred -and (Test-Path $Preferred)) {
    return (Resolve-Path $Preferred).Path
  }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -like "*.exe") { return $cmd.Source }
  # Common nvm4w / nvm-windows locations
  $candidates = @(
    "C:\nvm4w\nodejs\node.exe",
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  ) | Where-Object { $_ }
  foreach ($c in $candidates) {
    if (Test-Path $c) { return (Resolve-Path $c).Path }
  }
  return $null
}

$resolvedNode = Resolve-NodeExe -Preferred $NodeExe
if (-not $resolvedNode) {
  throw "node.exe not found. Install Node.js 18-22 LTS, or pass -NodeExe with the full path (e.g. C:\nvm4w\nodejs\node.exe)."
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$env:DATA_DIR = $DataDir
$env:PORT = "$Port"
$env:NODE_ENV = "production"

Set-Location $InstallDir
Write-Host "Starting LT-IDP web server..."
Write-Host "  Node:    $resolvedNode"
Write-Host "  Install: $InstallDir"
Write-Host "  Data:    $DataDir"
Write-Host "  Port:    $Port"
Write-Host "  URL:     http://localhost:$Port"
Write-Host ""

& $resolvedNode $serverJs
if ($LASTEXITCODE -ne 0) {
  throw "LT-IDP exited with code $LASTEXITCODE"
}
