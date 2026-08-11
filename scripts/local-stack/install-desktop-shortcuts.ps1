# Install IQAI Spatial START/STOP desktop shortcuts.
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

$iconScript = Join-Path $ProjectRoot 'scripts\launchers\build-launcher-icon.ps1'
if (Test-Path $iconScript) {
  & $iconScript -ProjectRoot $ProjectRoot
}

$IconPath = Join-Path $ProjectRoot 'assets\launchers\iqai-spatial.ico'
if (-not (Test-Path $IconPath)) {
  throw "Launcher icon missing: $IconPath"
}

$StartScript = Join-Path $PSScriptRoot 'iqai-start.ps1'
$StopScript = Join-Path $PSScriptRoot 'iqai-stop.ps1'
$Desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

$shortcuts = @(
  @{
    Name        = 'IQAI Spatial — START'
    Script      = $StartScript
    Description = 'Start IQAI Spatial local stack (Point Intelligence + Agent 2 + Spatial)'
  },
  @{
    Name        = 'IQAI Spatial — STOP'
    Script      = $StopScript
    Description = 'Stop launcher-owned IQAI Spatial services'
  }
)

foreach ($def in $shortcuts) {
  $lnkPath = Join-Path $Desktop ($def.Name + '.lnk')
  $shortcut = $shell.CreateShortcut($lnkPath)
  $shortcut.TargetPath = 'powershell.exe'
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($def.Script)`""
  $shortcut.WorkingDirectory = $ProjectRoot
  $shortcut.IconLocation = "$IconPath,0"
  $shortcut.Description = $def.Description
  $shortcut.Save()
  Write-Output "Created $lnkPath"
}

Write-Output "Desktop: $Desktop"
Write-Output "Project root: $ProjectRoot"
