# Create IQAI Spatial desktop shortcuts for Investigation and Intelligence workspaces.
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'build-launcher-icon.ps1') -ProjectRoot $ProjectRoot

$Desktop = [Environment]::GetFolderPath('Desktop')
$IconPath = Join-Path $ProjectRoot 'assets\launchers\iqai-spatial.ico'
$Launcher = Join-Path $PSScriptRoot 'launch-workspace.ps1'

if (-not (Test-Path $IconPath)) {
  throw "Launcher icon missing: $IconPath"
}

$definitions = @(
  @{ Name = 'IQAI Spatial - Investigation'; Workspace = 'investigation' },
  @{ Name = 'IQAI Spatial - Intelligence'; Workspace = 'intelligence' }
)

$shell = New-Object -ComObject WScript.Shell

foreach ($def in $definitions) {
  $lnkPath = Join-Path $Desktop ($def.Name + '.lnk')
  $shortcut = $shell.CreateShortcut($lnkPath)
  $shortcut.TargetPath = 'powershell.exe'
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launcher`" -Workspace $($def.Workspace)"
  $shortcut.WorkingDirectory = $ProjectRoot
  $shortcut.IconLocation = "$IconPath,0"
  $shortcut.Description = "Launch IQAI Spatial $($def.Workspace) workspace"
  $shortcut.Save()
  Write-Output "Created $lnkPath"
}

Write-Output "Desktop: $Desktop"
Write-Output "Project root: $ProjectRoot"
Write-Output "Configure project path in scripts\launchers\launch-workspace.ps1 (auto-resolved from script location)."
