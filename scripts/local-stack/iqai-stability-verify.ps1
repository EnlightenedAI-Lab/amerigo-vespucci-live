# IQAI Spatial product stability — launcher operator workflow verification.
param(
  [switch]$SkipLauncherCycle
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'iqai-stack-common.ps1')

$results = [ordered]@{}

function Record {
  param([string]$Name, [bool]$Pass, [string]$Detail = '')
  $results[$Name] = [ordered]@{ pass = $Pass; detail = $Detail }
}

Write-Host 'IQAI Spatial Stability — Launcher'
Write-Host '================================='
Write-Host ''

$config = Get-IqaiStackConfig
$spatialPort = $config.SpatialPort

if (-not $SkipLauncherCycle) {
  # Scenario: services already running (operator double-click START again)
  $beforePi = Get-ReusablePointIntelligence $config
  $beforeSpatial = Get-ReusableSpatial -Config $config -Port $spatialPort
  $beforePiPid = if ($beforePi) { $beforePi.Pid } else { $null }
  $beforeSpatialPid = if ($beforeSpatial) { $beforeSpatial.Pid } else { $null }

  & (Join-Path $PSScriptRoot 'iqai-start.ps1') -NoBrowser -Quiet
  $afterPi = Get-ReusablePointIntelligence $config
  $afterSpatial = Get-ReusableSpatial -Config $config -Port $spatialPort
  $afterPiPid = if ($afterPi) { $afterPi.Pid } else { $null }
  $afterSpatialPid = if ($afterSpatial) { $afterSpatial.Pid } else { $null }

  $reuseOk = (Test-SpatialHealth -Port $spatialPort).Healthy
  if ($beforePiPid) { $reuseOk = $reuseOk -and ($beforePiPid -eq $afterPiPid) }
  if ($beforeSpatialPid) { $reuseOk = $reuseOk -and ($beforeSpatialPid -eq $afterSpatialPid) }
  Record 'start_reuse_running' $reuseOk "pi $beforePiPid->$afterPiPid spatial $beforeSpatialPid->$afterSpatialPid"

  # Duplicate START
  & (Join-Path $PSScriptRoot 'iqai-start.ps1') -NoBrowser -Quiet
  $dupPiPid = (Get-ReusablePointIntelligence $config).Pid
  $dupSpatialPid = (Get-ReusableSpatial -Config $config -Port $spatialPort).Pid
  $dupOk = ($dupPiPid -eq $afterPiPid) -and ($dupSpatialPid -eq $afterSpatialPid)
  Record 'duplicate_start' $dupOk "pi $afterPiPid->$dupPiPid spatial $afterSpatialPid->$dupSpatialPid"

  # STOP (only launcher-owned; reused services may remain if not owned)
  $stateBefore = Get-LauncherState
  $ownedSpatial = $stateBefore.services.spatial.owned -eq $true
  $ownedPi = $stateBefore.services.'point-intelligence'.owned -eq $true
  & (Join-Path $PSScriptRoot 'iqai-stop.ps1') | Out-Null
  Start-Sleep -Seconds 2
  $stateAfter = Get-LauncherState
  $stopOk = -not $stateAfter
  Record 'stop' $stopOk "state cleared=$stopOk ownedSpatial=$ownedSpatial ownedPi=$ownedPi"

  # Restart after STOP
  & (Join-Path $PSScriptRoot 'iqai-start.ps1') -NoBrowser -Quiet
  $restartOk = (Test-SpatialHealth -Port $spatialPort).Healthy -and (Test-SpatialBundleRoute -Port $spatialPort).Healthy
  Record 'restart_after_stop' $restartOk ''
}

Write-Host ''
foreach ($entry in $results.GetEnumerator()) {
  $mark = if ($entry.Value.pass) { 'PASS' } else { 'FAIL' }
  Write-Host ("{0,-22} {1} {2}" -f $entry.Key, $mark, $entry.Value.detail)
}

$failed = @($results.GetEnumerator() | Where-Object { -not $_.Value.pass })
if ($failed.Count) { exit 1 }
Write-Host ''
Write-Host 'LAUNCHER STABILITY PASS'
exit 0
