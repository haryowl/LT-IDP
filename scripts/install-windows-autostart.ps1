# Register LT-IDP web mode to start automatically on Windows (Task Scheduler).
# Run PowerShell as Administrator for -Trigger Startup (recommended for always-on PCs).
#
# Usage:
#   .\scripts\install-windows-autostart.ps1
#   .\scripts\install-windows-autostart.ps1 -Trigger Logon
#   .\scripts\install-windows-autostart.ps1 -InstallDir "C:\Users\sparing\LT-IDP" -Port 3001
#   .\scripts\install-windows-autostart.ps1 -Uninstall

[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$DataDir = (Join-Path $env:ProgramData "LT-IDP\data"),
  [int]$Port = 3001,
  [ValidateSet("Startup", "Logon")]
  [string]$Trigger = "Startup",
  [string]$TaskName = "LT-IDP Web",
  [switch]$StartNow,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
  $InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$startScript = Join-Path $InstallDir "scripts\start-lt-idp-web.ps1"
if (-not (Test-Path $startScript)) {
  throw "Missing start script: $startScript`nPull the latest LT-IDP (branch with Windows scripts) or restore scripts\start-lt-idp-web.ps1."
}

$serverJs = Join-Path $InstallDir "dist-server\server\index.js"
if (-not $Uninstall -and -not (Test-Path $serverJs)) {
  throw "Built server not found: $serverJs`nRun first:`n  cd `"$InstallDir`"`n  npm run build:web"
}

# --- Uninstall ---
if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
  } else {
    Write-Host "No scheduled task named '$TaskName' found."
  }
  exit 0
}

$principalIsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if ($Trigger -eq "Startup" -and -not $principalIsAdmin) {
  throw @"
Trigger 'Startup' requires an elevated PowerShell (Run as Administrator).

Right-click PowerShell → Run as administrator, then:
  cd `"$InstallDir`"
  .\scripts\install-windows-autostart.ps1 -Trigger Startup

Or use logon (no admin required for current user):
  .\scripts\install-windows-autostart.ps1 -Trigger Logon
"@
}

$pwsh = (Get-Command powershell.exe).Source
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -InstallDir `"$InstallDir`" -DataDir `"$DataDir`" -Port $Port"

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg -WorkingDirectory $InstallDir

if ($Trigger -eq "Startup") {
  $taskTrigger = New-ScheduledTaskTrigger -AtStartup
  # SYSTEM so it runs even before interactive login
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
} else {
  $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 0) `
  -MultipleInstances IgnoreNew

# Remove previous registration if present
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $taskTrigger `
  -Principal $principal `
  -Settings $settings `
  -Description "LT-IDP IoT SCADA web server (auto-start). InstallDir=$InstallDir PORT=$Port DATA_DIR=$DataDir" `
  | Out-Null

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

Write-Host "=== LT-IDP auto-start installed ===" -ForegroundColor Green
Write-Host "  Task name:   $TaskName"
Write-Host "  Trigger:     $Trigger"
Write-Host "  Install dir: $InstallDir"
Write-Host "  Data dir:    $DataDir"
Write-Host "  Port:        $Port"
Write-Host "  URL:         http://localhost:$Port"
Write-Host ""
Write-Host "  Useful commands:"
Write-Host "    Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "    Stop-ScheduledTask -TaskName '$TaskName'"
Write-Host "    .\scripts\install-windows-autostart.ps1 -Uninstall"
Write-Host ""

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started task '$TaskName' now." -ForegroundColor Cyan
} else {
  Write-Host "Task will run on next $($Trigger.ToLower()). To start immediately:"
  Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
  Write-Host "  # or: .\scripts\install-windows-autostart.ps1 -StartNow"
}
