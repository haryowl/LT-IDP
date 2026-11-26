# LT-IDP web server starter (used by Task Scheduler / NSSM / manual runs).
# Usage:
#   .\scripts\start-lt-idp-web.ps1
#   .\scripts\start-lt-idp-web.ps1 -InstallDir "C:\Users\sparing\LT-IDP" -DataDir "C:\ProgramData\LT-IDP\data" -Port 3001

[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$DataDir = (Join-Path $env:ProgramData "LT-IDP\data"),
  [int]$Port = 3001
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

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw "node.exe not found on PATH. Install Node.js 18–22 LTS and reopen PowerShell."
}
$nodeExe = $nodeCmd.Source

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$env:DATA_DIR = $DataDir
$env:PORT = "$Port"
$env:NODE_ENV = "production"

Set-Location $InstallDir
Write-Host "Starting LT-IDP web server..."
Write-Host "  Install: $InstallDir"
Write-Host "  Data:    $DataDir"
Write-Host "  Port:    $Port"
Write-Host "  URL:     http://localhost:$Port"
Write-Host ""

& $nodeExe $serverJs
