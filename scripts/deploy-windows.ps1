# LT-IDP Windows deployment script (web application)
# Prerequisites: Git for Windows, Node.js 18-22 (LTS). Run in PowerShell.
# Usage:
#   .\scripts\deploy-windows.ps1
#   .\scripts\deploy-windows.ps1 -InstallDir "C:\LT-IDP" -DataDir "C:\ProgramData\LT-IDP\data" -Port 3001
#   .\scripts\deploy-windows.ps1 -EnableAutostart
#   .\scripts\deploy-windows.ps1 -EnableAutostart -NodeExe "C:\nvm4w\nodejs\node.exe"
#
# -EnableAutostart registers Task Scheduler (boot as SYSTEM by default).
# For -AutostartTrigger Startup, run this script in Administrator PowerShell.

[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $HOME "LT-IDP"),
  [string]$DataDir = (Join-Path $env:ProgramData "LT-IDP\data"),
  [int]$Port = 3001,
  [string]$RepoUrl = "https://github.com/haryowl/LT-IDP.git",
  [string]$NodeExe = "",
  [ValidateSet("Startup", "Logon")]
  [string]$AutostartTrigger = "Startup",
  [switch]$EnableAutostart,
  [switch]$SkipStart
)

$ErrorActionPreference = "Stop"

Write-Host "=== LT-IDP Windows Deployment ===" -ForegroundColor Cyan
Write-Host "  Install dir: $InstallDir"
Write-Host "  Data dir:    $DataDir"
Write-Host "  Port:        $Port"
Write-Host "  Autostart:   $EnableAutostart ($AutostartTrigger)"
Write-Host ""

function Assert-Command {
  param([string]$Name, [string]$Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' not found. $Hint"
  }
}

function Resolve-NodeExe {
  param([string]$Preferred)
  if ($Preferred -and (Test-Path $Preferred)) {
    return (Resolve-Path $Preferred).Path
  }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
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

function Invoke-Npm {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NpmArgs)
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCmd) {
    & $npmCmd.Source @NpmArgs
  } else {
    npm @NpmArgs
  }
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($NpmArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

# --- 1. Prerequisites ---
Write-Host "[1/7] Checking prerequisites..."
Assert-Command "git" "Install Git for Windows: https://git-scm.com/download/win"
Assert-Command "node" "Install Node.js 22 LTS: https://nodejs.org/"

$resolvedNode = Resolve-NodeExe -Preferred $NodeExe
if (-not $resolvedNode) {
  throw "node.exe not found. Install Node.js 18-22 LTS, or pass -NodeExe (e.g. C:\nvm4w\nodejs\node.exe)."
}

$nodeMajor = [int]((& $resolvedNode -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 18 -or $nodeMajor -ge 24) {
  throw "Unsupported Node.js $(& $resolvedNode -v). Use Node 18, 20, or 22 LTS (not 24+)."
}
Write-Host "  Node $(& $resolvedNode -v) ($resolvedNode)"

if ($EnableAutostart -and $AutostartTrigger -eq "Startup") {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
  if (-not $isAdmin) {
    throw @"
-EnableAutostart with -AutostartTrigger Startup requires Administrator PowerShell.

Right-click PowerShell -> Run as administrator, then re-run:
  .\scripts\deploy-windows.ps1 -EnableAutostart -NodeExe `"$resolvedNode`"

Or use logon trigger (no admin):
  .\scripts\deploy-windows.ps1 -EnableAutostart -AutostartTrigger Logon
"@
  }
}

# --- 2. Clone or update ---
Write-Host ""
Write-Host "[2/7] Cloning / updating repository..."
if (Test-Path (Join-Path $InstallDir ".git")) {
  Push-Location $InstallDir
  try {
    git fetch origin
    git checkout main
    git pull origin main
  } finally {
    Pop-Location
  }
} else {
  $parent = Split-Path -Parent $InstallDir
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  git clone $RepoUrl $InstallDir
}

Set-Location $InstallDir

# --- 3. Install dependencies ---
Write-Host ""
Write-Host "[3/7] Installing npm dependencies..."
try {
  Invoke-Npm install
} catch {
  throw "npm install failed. Install Visual Studio Build Tools (Desktop development with C++) and retry. $_"
}

# --- 4. Build web ---
Write-Host ""
Write-Host "[4/7] Building web application..."
Invoke-Npm run build:web

# Ensure Node-native addons (in case Electron rebuild ran earlier on this machine)
Write-Host ""
Write-Host "[5/7] Rebuilding native modules for Node..."
try {
  Invoke-Npm run rebuild:native
} catch {
  Write-Warning "rebuild:native reported an error; continuing if start:web works."
}

# --- 5. Data directory ---
Write-Host ""
Write-Host "[6/7] Setting up data directory..."
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$env:DATA_DIR = $DataDir
$env:PORT = "$Port"
$env:NODE_ENV = "production"

# --- 6/7. Autostart and/or start ---
Write-Host ""
Write-Host "[7/7] Finishing..."

$autostartScript = Join-Path $InstallDir "scripts\install-windows-autostart.ps1"
if ($EnableAutostart) {
  if (-not (Test-Path $autostartScript)) {
    throw "Missing $autostartScript. Pull the latest LT-IDP that includes Windows auto-start scripts."
  }
  Write-Host "  Registering Task Scheduler auto-start ($AutostartTrigger)..."
  & $autostartScript `
    -InstallDir $InstallDir `
    -DataDir $DataDir `
    -Port $Port `
    -NodeExe $resolvedNode `
    -Trigger $AutostartTrigger `
    -StartNow
}

Write-Host ""
Write-Host "=== Deployment complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "  Application URL: http://localhost:$Port"
Write-Host "  Data directory:  $DataDir"
Write-Host "  Working directory: $InstallDir"
Write-Host "  Node.exe:        $resolvedNode"
Write-Host "  Autostart:       $EnableAutostart ($AutostartTrigger)"
Write-Host ""
Write-Host "  Default login: admin / admin  (change immediately in Settings)"
Write-Host ""

if ($EnableAutostart) {
  Write-Host "  Auto-start is enabled. Manage with:"
  Write-Host "    .\scripts\install-windows-autostart.ps1 -Diagnose"
  Write-Host "    .\scripts\install-windows-autostart.ps1 -Uninstall"
  Write-Host ""
  # Task already started via -StartNow; do not also run foreground start:web
} elseif (-not $SkipStart) {
  Write-Host "  Starting web server in this window (Ctrl+C stops it)..."
  Write-Host "  Tip: re-run with -EnableAutostart for boot auto-start."
  Write-Host ""
  Invoke-Npm run start:web
} else {
  Write-Host "  Skipped start (-SkipStart). To run later:"
  Write-Host "    cd `"$InstallDir`""
  Write-Host "    `$env:DATA_DIR = `"$DataDir`"; `$env:PORT = `"$Port`""
  Write-Host "    npm.cmd run start:web"
  Write-Host ""
  Write-Host "  Or enable auto-start:"
  Write-Host "    .\scripts\deploy-windows.ps1 -EnableAutostart -NodeExe `"$resolvedNode`""
  Write-Host ""
}
