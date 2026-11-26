# LT-IDP Windows deployment script (web application)
# Prerequisites: Git for Windows, Node.js 18-22 (LTS). Run in PowerShell.
# Usage:
#   .\scripts\deploy-windows.ps1
#   .\scripts\deploy-windows.ps1 -InstallDir "C:\LT-IDP" -DataDir "C:\ProgramData\LT-IDP\data" -Port 3001

[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $HOME "LT-IDP"),
  [string]$DataDir = (Join-Path $env:ProgramData "LT-IDP\data"),
  [int]$Port = 3001,
  [string]$RepoUrl = "https://github.com/haryowl/LT-IDP.git",
  [switch]$SkipStart
)

$ErrorActionPreference = "Stop"

Write-Host "=== LT-IDP Windows Deployment ===" -ForegroundColor Cyan
Write-Host "  Install dir: $InstallDir"
Write-Host "  Data dir:    $DataDir"
Write-Host "  Port:        $Port"
Write-Host ""

function Assert-Command {
  param([string]$Name, [string]$Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' not found. $Hint"
  }
}

# --- 1. Prerequisites ---
Write-Host "[1/6] Checking prerequisites..."
Assert-Command "git" "Install Git for Windows: https://git-scm.com/download/win"
Assert-Command "node" "Install Node.js 22 LTS: https://nodejs.org/"
Assert-Command "npm" "Reinstall Node.js so npm is on PATH."

$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 18 -or $nodeMajor -ge 24) {
  throw "Unsupported Node.js $(node -v). Use Node 18, 20, or 22 LTS (not 24+)."
}
Write-Host "  Node $(node -v), npm $(npm -v)"

# --- 2. Clone or update ---
Write-Host ""
Write-Host "[2/6] Cloning / updating repository..."
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
Write-Host "[3/6] Installing npm dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
  throw "npm install failed. Install Visual Studio Build Tools (Desktop development with C++) and retry."
}

# --- 4. Build web ---
Write-Host ""
Write-Host "[4/6] Building web application..."
npm run build:web
if ($LASTEXITCODE -ne 0) {
  throw "npm run build:web failed."
}

# Ensure Node-native addons (in case Electron rebuild ran earlier on this machine)
npm run rebuild:native
if ($LASTEXITCODE -ne 0) {
  Write-Warning "rebuild:native reported an error; continuing if start:web works."
}

# --- 5. Data directory ---
Write-Host ""
Write-Host "[5/6] Setting up data directory..."
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# --- 6. Start ---
Write-Host ""
Write-Host "[6/6] Starting LT-IDP web server..."
$env:DATA_DIR = $DataDir
$env:PORT = "$Port"
$env:NODE_ENV = "production"

Write-Host ""
Write-Host "=== Deployment complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "  Application URL: http://localhost:$Port"
Write-Host "  Data directory:  $DataDir"
Write-Host "  Working directory: $InstallDir"
Write-Host ""
Write-Host "  Default login: admin / admin  (change immediately in Settings)"
Write-Host ""
Write-Host "  To start again later:"
Write-Host "    cd `"$InstallDir`""
Write-Host "    `$env:DATA_DIR = `"$DataDir`"; `$env:PORT = `"$Port`""
Write-Host "    npm run start:web"
Write-Host ""
Write-Host "  To auto-start after reboot (Administrator PowerShell):"
Write-Host "    .\scripts\install-windows-autostart.ps1 -InstallDir `"$InstallDir`" -DataDir `"$DataDir`" -Port $Port -Trigger Startup -StartNow"
Write-Host ""

if (-not $SkipStart) {
  npm run start:web
}
