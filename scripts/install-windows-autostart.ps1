# Register LT-IDP web mode to start automatically on Windows (Task Scheduler).
# Uses a generated .cmd launcher with an absolute path to node.exe so nvm4w / SYSTEM
# PATH issues do not break auto-start.
#
# Run PowerShell as Administrator for -Trigger Startup (recommended for always-on PCs).
#
# Usage:
#   .\scripts\install-windows-autostart.ps1
#   .\scripts\install-windows-autostart.ps1 -Trigger Logon
#   .\scripts\install-windows-autostart.ps1 -InstallDir "C:\Users\sparing\LT-IDP" -Port 3001
#   .\scripts\install-windows-autostart.ps1 -NodeExe "C:\nvm4w\nodejs\node.exe" -StartNow
#   .\scripts\install-windows-autostart.ps1 -Uninstall

[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$DataDir = (Join-Path $env:ProgramData "LT-IDP\data"),
  [int]$Port = 3001,
  [ValidateSet("Startup", "Logon")]
  [string]$Trigger = "Startup",
  [string]$TaskName = "LT-IDP Web",
  [string]$NodeExe = "",
  [switch]$StartNow,
  [switch]$Uninstall,
  [switch]$Diagnose
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
  $InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$launcherDir = Join-Path $env:ProgramData "LT-IDP"
$launcherCmd = Join-Path $launcherDir "start-lt-idp-web.cmd"
$launcherLog = Join-Path $DataDir "autostart.log"

function Show-TaskDiagnostics {
  param([string]$Name)
  $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-Host "Scheduled task '$Name' not found." -ForegroundColor Yellow
    return
  }
  $info = Get-ScheduledTaskInfo -TaskName $Name
  Write-Host "=== LT-IDP task diagnostics ===" -ForegroundColor Cyan
  Write-Host "  State:          $($task.State)"
  Write-Host "  LastRunTime:    $($info.LastRunTime)"
  $resultHint = switch ([int]$info.LastTaskResult) {
    0 { "completed OK (server may have exited — for a long-running server prefer State=Running)" }
    267009 { "TASK_RUNNING (normal while LT-IDP is up)" }
    267011 { "task has not run yet" }
    default { "error — see autostart.log" }
  }
  Write-Host "  LastTaskResult: $($info.LastTaskResult) ($resultHint)"
  Write-Host "  NextRunTime:    $($info.NextRunTime)"
  Write-Host "  Principal:      $($task.Principal.UserId) ($($task.Principal.LogonType))"
  foreach ($a in $task.Actions) {
    Write-Host "  Action:         $($a.Execute) $($a.Arguments)"
    Write-Host "  WorkingDir:     $($a.WorkingDirectory)"
  }
  if (Test-Path $launcherLog) {
    Write-Host ""
    Write-Host "  Last lines of $launcherLog :"
    Get-Content $launcherLog -Tail 30
  } else {
    Write-Host "  No log yet at $launcherLog (task may never have started the launcher)."
  }
  $listen = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listen) {
    Write-Host "  Port $Port : LISTENING (pid $($listen.OwningProcess))" -ForegroundColor Green
  } else {
    Write-Host "  Port $Port : not listening" -ForegroundColor Yellow
  }
}

if ($Diagnose) {
  Show-TaskDiagnostics -Name $TaskName
  exit 0
}

$serverJs = Join-Path $InstallDir "dist-server\server\index.js"
if (-not $Uninstall -and -not (Test-Path $serverJs)) {
  throw "Built server not found: $serverJs`nRun first:`n  cd `"$InstallDir`"`n  Set-ExecutionPolicy -Scope Process Bypass`n  npm.cmd run build:web"
}

# --- Uninstall ---
if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
  } else {
    Write-Host "No scheduled task named '$TaskName' found."
  }
  if (Test-Path $launcherCmd) {
    Remove-Item -Force $launcherCmd
    Write-Host "Removed launcher $launcherCmd"
  }
  exit 0
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

$resolvedNode = Resolve-NodeExe -Preferred $NodeExe
if (-not $resolvedNode) {
  throw @"
node.exe not found on PATH.

If you use nvm4w, pass the full path, for example:
  .\scripts\install-windows-autostart.ps1 -NodeExe `"C:\nvm4w\nodejs\node.exe`" -Trigger Startup -StartNow
"@
}

$principalIsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if ($Trigger -eq "Startup" -and -not $principalIsAdmin) {
  throw @"
Trigger 'Startup' requires an elevated PowerShell (Run as Administrator).

Right-click PowerShell → Run as administrator, then:
  cd `"$InstallDir`"
  Set-ExecutionPolicy -Scope Process Bypass
  .\scripts\install-windows-autostart.ps1 -Trigger Startup -StartNow

Or use logon (no admin required for current user):
  .\scripts\install-windows-autostart.ps1 -Trigger Logon -StartNow
"@
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null

# .cmd launcher: absolute paths, works under SYSTEM (no PowerShell execution policy / no user PATH)
$cmdLines = @(
  "@echo off",
  "setlocal",
  "set DATA_DIR=$DataDir",
  "set PORT=$Port",
  "set NODE_ENV=production",
  "cd /d `"$InstallDir`"",
  "echo [%date% %time%] starting LT-IDP >> `"$launcherLog`"",
  "echo node=$resolvedNode >> `"$launcherLog`"",
  "echo install=$InstallDir >> `"$launcherLog`"",
  "`"$resolvedNode`" `"$serverJs`" >> `"$launcherLog`" 2>&1",
  "echo [%date% %time%] exited code %ERRORLEVEL% >> `"$launcherLog`"",
  "exit /b %ERRORLEVEL%"
)
Set-Content -Path $launcherCmd -Value ($cmdLines -join "`r`n") -Encoding ASCII

$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$launcherCmd`"" `
  -WorkingDirectory $InstallDir

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
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

# Remove previous registration if present
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $taskTrigger `
  -Principal $principal `
  -Settings $settings `
  -Description "LT-IDP IoT SCADA web server (auto-start). InstallDir=$InstallDir PORT=$Port DATA_DIR=$DataDir Node=$resolvedNode" `
  | Out-Null

Write-Host "=== LT-IDP auto-start installed ===" -ForegroundColor Green
Write-Host "  Task name:   $TaskName"
Write-Host "  Trigger:     $Trigger"
Write-Host "  Node.exe:    $resolvedNode"
Write-Host "  Launcher:    $launcherCmd"
Write-Host "  Install dir: $InstallDir"
Write-Host "  Data dir:    $DataDir"
Write-Host "  Log file:    $launcherLog"
Write-Host "  Port:        $Port"
Write-Host "  URL:         http://localhost:$Port"
Write-Host ""
Write-Host "  Useful commands:"
Write-Host "    .\scripts\install-windows-autostart.ps1 -Diagnose"
Write-Host "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "    Stop-ScheduledTask -TaskName '$TaskName'"
Write-Host "    .\scripts\install-windows-autostart.ps1 -Uninstall"
Write-Host ""

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
  Write-Host "Started task '$TaskName'. Checking status..." -ForegroundColor Cyan
  Show-TaskDiagnostics -Name $TaskName
  $state = (Get-ScheduledTask -TaskName $TaskName).State
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  $okRunning = ($state -eq "Running") -or ([int]$info.LastTaskResult -eq 267009)
  $listen = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $okRunning -and -not $listen) {
    Write-Host ""
    Write-Host "Task does not look healthy. Common fix for nvm4w:" -ForegroundColor Yellow
    Write-Host "  .\scripts\install-windows-autostart.ps1 -NodeExe `"C:\nvm4w\nodejs\node.exe`" -Trigger $Trigger -StartNow"
  } elseif ($listen) {
    Write-Host ""
    Write-Host "LT-IDP appears up at http://localhost:$Port" -ForegroundColor Green
  }
} else {
  Write-Host "Task will run on next $($Trigger.ToLower()). To start immediately:"
  Write-Host "  .\scripts\install-windows-autostart.ps1 -StartNow"
  Write-Host "  # or: Start-ScheduledTask -TaskName '$TaskName'"
}
