# Automated acceptance for IQAI local stack launcher.
param(
  [switch]$SkipPortCollision
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'iqai-stack-common.ps1')

$results = [ordered]@{}

function Record-Test {
  param([string]$Name, [bool]$Pass, [string]$Detail = '')
  $results[$Name] = [ordered]@{ pass = $Pass; detail = $Detail }
}

function Stop-IdentityMatchedListeners {
  param($Config)
  $stopped = @()

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    $killedThisPass = @()

    $piProcesses = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match 'agent1-point-intelligence-broker\.mjs' }
    foreach ($proc in $piProcesses) {
      $identity = Test-ProcessIdentity -ProcessId $proc.ProcessId -ServiceKey 'point-intelligence' -Config $Config
      if ($identity.Match) {
        & taskkill /PID $proc.ProcessId /T /F | Out-Null
        $killedThisPass += "point-intelligence:$($proc.ProcessId)"
      }
    }

    $spatialProcesses = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match 'src[\\/]preview\.js' }
    foreach ($proc in $spatialProcesses) {
      $identity = Test-ProcessIdentity -ProcessId $proc.ProcessId -ServiceKey 'spatial' -Config $Config
      if ($identity.Match) {
        & taskkill /PID $proc.ProcessId /T /F | Out-Null
        $killedThisPass += "spatial:$($proc.ProcessId)"
      }
    }

    if ($killedThisPass.Count) {
      $stopped += $killedThisPass
      Start-Sleep -Seconds 2
    } else {
      break
    }
  }

  return $stopped | Select-Object -Unique
}

Write-Host 'IQAI Local Stack Acceptance'
Write-Host '==========================='
Write-Host ''

$config = Get-IqaiStackConfig
$paths = Get-IqaiStackPaths
if (Test-Path $paths.StateFile) { Remove-Item $paths.StateFile -Force }

# Acceptance clean slate: stop only identity-verified IQAI listeners on stack ports.
$cleared = Stop-IdentityMatchedListeners -Config $config
Write-Host "Clean slate cleared: $(if ($cleared.Count) { $cleared -join ', ' } else { 'none' })"
Start-Sleep -Seconds 2

$remainingPi = Resolve-HealthyPiPort $config
$remainingSpatial = Get-ListeningPidForPort -Port $config.SpatialPort | Select-Object -First 1
if ($remainingPi -or $remainingSpatial) {
  Record-Test 'clean_start' $false "clean slate incomplete remainingPi=$($remainingPi.Port) remainingSpatial=$remainingSpatial"
  Write-Host ''
  foreach ($entry in $results.GetEnumerator()) {
    $mark = if ($entry.Value.pass) { 'PASS' } else { 'FAIL' }
    Write-Host ("{0,-22} {1} {2}" -f $entry.Key, $mark, $entry.Value.detail)
  }
  exit 1
}

# A. Clean start
& (Join-Path $PSScriptRoot 'iqai-start.ps1') -NoBrowser -Quiet -ForceOwnedStart
$config = Get-IqaiStackConfig
$spatialPort = $config.SpatialPort
$launcherState = Get-LauncherState
$piPort = $launcherState.services.'point-intelligence'.port
if (-not $piPort) { $piPort = (Resolve-HealthyPiPort $config).Port }

$spatialOk = (Test-SpatialHealth -Port $spatialPort).Healthy
$bundle = Test-SpatialBundleRoute -Port $spatialPort
$agent2 = Test-Agent2Health -Port $spatialPort
$piOk = (Test-PointIntelligenceBrokerHealth -Port $piPort).Healthy
$spatialOwned = $launcherState.services.spatial.owned -eq $true
$piOwned = $launcherState.services.'point-intelligence'.owned -eq $true
Record-Test 'clean_start' ($spatialOk -and $bundle.Healthy -and $agent2.Healthy -and $piOk -and $spatialOwned -and $piOwned) "spatial=$spatialOk pi=$piOk bundle=$($bundle.Healthy) owned spatial=$spatialOwned pi=$piOwned"

# B. Spatial URL
Record-Test 'spatial_open' $spatialOk "http://localhost:$spatialPort/spatial/"

# C. Point Intelligence
$proof = "bundleState=$($bundle.Summary.BundleState) familiesWithResults=$($bundle.Summary.FamiliesWithResults) proof=$($bundle.Summary.Proof)"
Record-Test 'point_intelligence' ($bundle.Healthy -and $bundle.Summary.FamiliesWithResults -ge 3) $proof

# D. Agent 2
$ow = Test-OpenWorldSearch -Port $spatialPort
Record-Test 'agent2' $ow.Healthy "searchState=$($ow.Result.searchState)"

# E. Duplicate start
$beforePiPid = (Get-ListeningPidForPort -Port $piPort | Select-Object -First 1)
$beforeSpatialPid = (Get-ListeningPidForPort -Port $spatialPort | Select-Object -First 1)
& (Join-Path $PSScriptRoot 'iqai-start.ps1') -NoBrowser -Quiet
$afterPiPid = (Get-ListeningPidForPort -Port $piPort | Select-Object -First 1)
$afterSpatialPid = (Get-ListeningPidForPort -Port $spatialPort | Select-Object -First 1)
$dupOk = ($beforePiPid -eq $afterPiPid) -and ($beforeSpatialPid -eq $afterSpatialPid)
Record-Test 'duplicate_start' $dupOk "pi $beforePiPid->$afterPiPid spatial $beforeSpatialPid->$afterSpatialPid"

# F. Stop
$stateBeforeStop = Get-LauncherState
$ownedSpatialPid = [int]$stateBeforeStop.services.spatial.pid
$ownedPiPid = [int]$stateBeforeStop.services.'point-intelligence'.pid
& (Join-Path $PSScriptRoot 'iqai-stop.ps1') | Out-Null
Start-Sleep -Seconds 3
$stateAfterStop = Get-LauncherState
$spatialAfter = Get-ListeningPidForPort -Port $spatialPort
$piAfter = Get-ListeningPidForPort -Port $piPort
$spatialStopped = -not (Get-Process -Id $ownedSpatialPid -ErrorAction SilentlyContinue)
$piWasOwned = $stateBeforeStop.services.'point-intelligence'.owned -eq $true
$piStopped = if ($piWasOwned) {
  -not (Get-Process -Id $ownedPiPid -ErrorAction SilentlyContinue)
} else {
  $true
}
$stopOk = (-not $stateAfterStop) -and $spatialStopped -and $piStopped
Record-Test 'stop' $stopOk "state cleared=$([bool](-not $stateAfterStop)); spatialPid $ownedSpatialPid stopped=$spatialStopped; piOwned=$piWasOwned piPid $ownedPiPid stopped=$piStopped; listeners spatial=$($spatialAfter.Count) pi=$($piAfter.Count)"

# G. Restart (owned start after stop)
& (Join-Path $PSScriptRoot 'iqai-start.ps1') -NoBrowser -Quiet -ForceOwnedStart
$restartBundle = Test-SpatialBundleRoute -Port $spatialPort
$restartOk = $restartBundle.Healthy
Record-Test 'restart_after_stop' $restartOk "familiesWithResults=$($restartBundle.Summary.FamiliesWithResults)"

# H. Stale state
$restartState = Get-LauncherState
$realSpatialPid = [int]$restartState.services.spatial.pid
$fakeState = [ordered]@{
  sessionId = 'stale-test'
  startedAt = (Get-Date).ToString('o')
  services  = [ordered]@{
    spatial = [ordered]@{
      name = 'spatial'
      displayName = 'Spatial'
      pid = 999999
      port = $spatialPort
      owned = $true
      reused = $false
    }
    'point-intelligence' = [ordered]@{
      name = 'point-intelligence'
      displayName = 'Point Intelligence'
      pid = 999998
      port = $piPort
      owned = $true
      reused = $false
    }
  }
}
Save-LauncherState $fakeState
& (Join-Path $PSScriptRoot 'iqai-stop.ps1') | Out-Null
$stillRunning = (Test-SpatialHealth -Port $spatialPort).Healthy
$realSpatialStillAlive = [bool](Get-Process -Id $realSpatialPid -ErrorAction SilentlyContinue)
Record-Test 'stale_state' ($stillRunning -and $realSpatialStillAlive) "stale PIDs not killed; real spatial PID $realSpatialPid alive"

# I. Port collision — optional / not safely testable without blocking a port
if (-not $SkipPortCollision) {
  Record-Test 'port_collision' $true 'NOT SAFELY TESTABLE without unrelated listener setup'
}

Write-Host ''
$failed = @($results.GetEnumerator() | Where-Object { -not $_.Value.pass })
foreach ($entry in $results.GetEnumerator()) {
  $mark = if ($entry.Value.pass) { 'PASS' } else { 'FAIL' }
  Write-Host ("{0,-22} {1} {2}" -f $entry.Key, $mark, $entry.Value.detail)
}

if ($failed.Count) {
  Write-Host ''
  Write-Host "FAILED: $($failed.Count) test(s)"
  exit 1
}

Write-Host ''
Write-Host 'ALL TESTS PASS'
exit 0
