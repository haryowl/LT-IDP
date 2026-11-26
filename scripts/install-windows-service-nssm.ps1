# Install LT-IDP web mode as a Windows service via NSSM (optional alternative to Task Scheduler).
# Download NSSM first: https://nssm.cc/download  (use win64\nssm.exe)
#
# Usage:
#   .\scripts\install-windows-service-nssm.ps1 -NssmPath "C:\Tools\nssm\win64\nssm.exe"
#   .\scripts\install-windows-service-nssm.ps1 -NssmPath "...\nssm.exe" -Uninstall
#
# Requires: Administrator PowerShell, Node.js on PATH, npm run build:web already done.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$NssmPath,
  [string]$InstallDir = "",
  [string]$DataDir = (Join-Path $env:ProgramData "LT-IDP\data"),
  [int]$Port = 3001,
  [string]$ServiceName = "LT-IDP",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$principalIsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $principalIsAdmin) {
  throw "Run this script in an elevated PowerShell (Run as Administrator)."
}

if (-not (Test-Path $NssmPath)) {
  throw "NSSM not found at: $NssmPath`nDownload from https://nssm.cc/download"
}

if (-not $InstallDir) {
  $InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$nssm = (Resolve-Path $NssmPath).Path

if ($Uninstall) {
  & $nssm stop $ServiceName confirm 2>$null
  & $nssm remove $ServiceName confirm
  Write-Host "Removed Windows service '$ServiceName'." -ForegroundColor Green
  exit 0
}

$serverJs = Join-Path $InstallDir "dist-server\server\index.js"
if (-not (Test-Path $serverJs)) {
  throw "Built server not found: $serverJs`nRun 'npm run build:web' in $InstallDir first."
}

$nodeCmd = Get-Command node -ErrorAction Stop
$nodeExe = $nodeCmd.Source

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Reinstall cleanly if present
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  & $nssm stop $ServiceName confirm 2>$null
  & $nssm remove $ServiceName confirm
}

& $nssm install $ServiceName $nodeExe $serverJs
& $nssm set $ServiceName AppDirectory $InstallDir
& $nssm set $ServiceName AppEnvironmentExtra "PORT=$Port" "DATA_DIR=$DataDir" "NODE_ENV=production"
& $nssm set $ServiceName DisplayName "LT-IDP Web Server"
& $nssm set $ServiceName Description "LT-IDP IoT SCADA web server"
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppStdout (Join-Path $DataDir "service-stdout.log")
& $nssm set $ServiceName AppStderr (Join-Path $DataDir "service-stderr.log")
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 1048576

& $nssm start $ServiceName

Write-Host "=== LT-IDP Windows service installed ===" -ForegroundColor Green
Write-Host "  Service:     $ServiceName"
Write-Host "  Install dir: $InstallDir"
Write-Host "  Data dir:    $DataDir"
Write-Host "  Port:        $Port"
Write-Host "  URL:         http://localhost:$Port"
Write-Host "  Logs:        $DataDir\service-*.log"
Write-Host ""
Write-Host "  Useful commands:"
Write-Host "    Get-Service $ServiceName"
Write-Host "    Restart-Service $ServiceName"
Write-Host "    .\scripts\install-windows-service-nssm.ps1 -NssmPath `"$NssmPath`" -Uninstall"
