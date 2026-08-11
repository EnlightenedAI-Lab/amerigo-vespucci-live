# IQAI Spatial — START local development stack
param(
  [switch]$NoBrowser,
  [switch]$Quiet,
  [switch]$ForceOwnedStart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'iqai-stack-common.ps1')

function Write-Status {
  param([string]$Message)
  Write-Host $Message
  Write-LauncherLog $Message
}

try {
  $config = Get-IqaiStackConfig
  Ensure-RuntimeDirs $config
  $state = New-LauncherState $config
  $failures = @()

  Write-Status ''
  Write-Status 'IQAI Spatial — Starting'
  Write-Status ''

  # PostgreSQL readiness (dependency only — never started/stopped by launcher)
  if (Test-PostgresReady $config) {
    Write-Status (Format-StatusLine -Label 'PostgreSQL' -State 'READY')
    $state.services.postgresql = [ordered]@{
      name    = 'postgresql'
      owned   = $false
      reused  = $true
      port    = $config.PostgresPort
      note    = 'system service — not managed by launcher'
    }
  } else {
    Write-Status (Format-StatusLine -Label 'PostgreSQL' -State 'FAILED')
    throw "PostgreSQL is not reachable on $($config.PostgresHost):$($config.PostgresPort). Point Intelligence requires PostgreSQL/PostGIS."
  }

  # Point Intelligence broker
  $piPort = Resolve-PiStartPort $config
  $config.PiBrokerPort = $piPort
  $config.PiBrokerUrl = "http://127.0.0.1:$piPort"
  $reusablePi = $null
  if (-not $ForceOwnedStart) {
    $reusablePi = Get-ReusablePointIntelligence $config
  }
  if ($reusablePi) {
    $piPort = $reusablePi.Port
    $config.PiBrokerUrl = "http://127.0.0.1:$piPort"
    Write-Status (Format-StatusLine -Label 'Point Intelligence' -State 'REUSED')
    $listenerPid = $reusablePi.Pid
    if (-not $listenerPid) {
      $listenerPid = Get-ListeningPidForPort -Port $piPort | Select-Object -First 1
    }
    $priorState = Get-LauncherState
    $preservePiOwned = $false
    if ($priorState -and $priorState.services -and $priorState.services.'point-intelligence') {
      $priorPi = $priorState.services.'point-intelligence'
      if ($priorPi.owned -eq $true -and [int]$priorPi.pid -eq [int]$listenerPid) {
        $preservePiOwned = $true
      }
    }
    if ($preservePiOwned) {
      $state.services.'point-intelligence' = $priorState.services.'point-intelligence'
    } else {
      $state.services.'point-intelligence' = [ordered]@{
        name         = 'point-intelligence'
        displayName  = 'Point Intelligence'
        pid          = $listenerPid
        port         = $piPort
        owned        = $false
        reused       = $true
        healthUrl    = "http://127.0.0.1:$piPort/health"
        startedAt    = (Get-Date).ToString('o')
      }
    }
  } else {
    $listenerPid = Get-ListeningPidForPort -Port $piPort | Select-Object -First 1
    if ($listenerPid) {
      $identity = Test-ProcessIdentity -ProcessId $listenerPid -ServiceKey 'point-intelligence' -Config $config
      if (-not $identity.Match) {
        $cmd = $identity.CommandLine
        throw "Port $piPort is occupied by unrelated process PID $listenerPid. Command: $cmd"
      }
      if ($ForceOwnedStart) {
        Write-LauncherLog "ForceOwnedStart: replacing identity-matched PI PID $listenerPid on port $piPort"
        & taskkill /PID $listenerPid /T /F | Out-Null
        Start-Sleep -Seconds 2
        $listenerPid = $null
      } else {
        $health = Test-PointIntelligenceBrokerHealth -Port $piPort
        throw "Port $piPort has IQAI Point Intelligence broker PID $listenerPid but is not healthy: $($health.Reason)"
      }
    }

    if ($listenerPid) {
      throw "Port $piPort still occupied by PID $listenerPid after ForceOwnedStart cleanup."
    }

    $piDef = (Get-ServiceStackDefinition $config) | Where-Object { $_.key -eq 'point-intelligence' } | Select-Object -First 1
    $record = Start-OwnedProcess `
      -ServiceKey 'point-intelligence' `
      -DisplayName 'Point Intelligence' `
      -FilePath $config.NodeExe `
      -Arguments "`"$($piDef.script)`"" `
      -WorkingDirectory $piDef.workdir `
      -Port $piPort `
      -Environment @{ POINT_INTELLIGENCE_PORT = [string]$piPort } `
      -Config $config

    Wait-ForHealth -Label 'Point Intelligence' -TimeoutSec 120 -Probe {
      Test-PointIntelligenceBrokerHealth -Port $piPort
    } | Out-Null

    Write-Status (Format-StatusLine -Label 'Point Intelligence' -State 'READY')
    $state.services.'point-intelligence' = $record
    $state.services.'point-intelligence'.port = $piPort
    $state.services.'point-intelligence'.healthUrl = "http://127.0.0.1:$piPort/health"
  }

  # Spatial (Agent 2 routes load in-process)
  $spatialPort = $config.SpatialPort
  $reusableSpatial = $null
  if (-not $ForceOwnedStart) {
    $reusableSpatial = Get-ReusableSpatial -Config $config -Port $spatialPort
  }

  if ($reusableSpatial) {
    Write-Status (Format-StatusLine -Label 'Spatial' -State 'REUSED')
    Write-Status (Format-StatusLine -Label 'Agent 2 (in-process)' -State 'REUSED')
    $listenerPid = $reusableSpatial.Pid
    $priorState = Get-LauncherState
    $preserveOwned = $false
    if ($priorState -and $priorState.services -and $priorState.services.spatial) {
      $prior = $priorState.services.spatial
      if ($prior.owned -eq $true -and [int]$prior.pid -eq [int]$listenerPid) {
        $preserveOwned = $true
      }
    }
    if ($preserveOwned) {
      $state.services.spatial = $priorState.services.spatial
    } else {
      $state.services.spatial = [ordered]@{
        name         = 'spatial'
        displayName  = 'Spatial'
        pid          = $listenerPid
        port         = $spatialPort
        owned        = $false
        reused       = $true
        healthUrl    = "http://127.0.0.1:$spatialPort/health"
        spatialUrl   = $config.SpatialUrl
        startedAt    = (Get-Date).ToString('o')
      }
    }
  } else {
    $spatialHealthy = Test-SpatialHealth -Port $spatialPort
    $bundleHealthy = $null
    if ($spatialHealthy.Healthy) {
      $bundleHealthy = Test-SpatialBundleRoute -Port $spatialPort
    }

    if ($spatialHealthy.Healthy -and $bundleHealthy -and -not $bundleHealthy.Healthy) {
      $listenerPid = Get-ListeningPidForPort -Port $spatialPort | Select-Object -First 1
      if ($listenerPid) {
        $identity = Test-ProcessIdentity -ProcessId $listenerPid -ServiceKey 'spatial' -Config $config
        if ($identity.Match) {
          $reason = if ($bundleHealthy.Reason) { $bundleHealthy.Reason } else { 'bundle route unhealthy' }
          Write-Status "Replacing stale IQAI Spatial ($reason)..."
          Write-LauncherLog "Replacing stale spatial PID $listenerPid before restart ($reason)"
          & taskkill /PID $listenerPid /T /F | Out-Null
          Start-Sleep -Seconds 2
          $spatialHealthy = @{ Healthy = $false }
        }
      }
    }

    $listenerPid = Get-ListeningPidForPort -Port $spatialPort | Select-Object -First 1
    if ($listenerPid) {
      $identity = Test-ProcessIdentity -ProcessId $listenerPid -ServiceKey 'spatial' -Config $config
      if (-not $identity.Match) {
        throw "Port $spatialPort is occupied by unrelated process PID $listenerPid. Command: $($identity.CommandLine)"
      }
      if ($ForceOwnedStart) {
        Write-LauncherLog "ForceOwnedStart: replacing identity-matched spatial PID $listenerPid on port $spatialPort"
        & taskkill /PID $listenerPid /T /F | Out-Null
        Start-Sleep -Seconds 2
        $listenerPid = $null
      } elseif ($spatialHealthy.Healthy) {
        $reason = if ($bundleHealthy.Reason) { $bundleHealthy.Reason } else { 'bundle route unhealthy' }
        throw "Port $spatialPort has IQAI Spatial PID $listenerPid but cannot be reused: $reason"
      }
    }

    if ($listenerPid) {
      throw "Port $spatialPort still occupied by PID $listenerPid after ForceOwnedStart cleanup."
    }

    $spatialDef = (Get-ServiceStackDefinition $config) | Where-Object { $_.key -eq 'spatial' } | Select-Object -First 1

    $record = Start-OwnedProcess `
      -ServiceKey 'spatial' `
      -DisplayName 'Spatial' `
      -FilePath $config.NodeExe `
      -Arguments "`"$($spatialDef.script)`"" `
      -WorkingDirectory $spatialDef.workdir `
      -Port $spatialPort `
      -Environment @{
        PORT                          = [string]$spatialPort
        POINT_INTELLIGENCE_BROKER_URL = $config.PiBrokerUrl
        INTELLIGENCE_STORE_ROOT       = $config.IntelligenceStoreRoot
      } `
      -Config $config

    Wait-ForHealth -Label 'Spatial' -TimeoutSec 90 -Probe {
      Test-SpatialHealth -Port $spatialPort
    } | Out-Null

    Wait-ForHealth -Label 'Spatial bundle route' -TimeoutSec 30 -Probe {
      Test-SpatialBundleRoute -Port $spatialPort
    } | Out-Null

    Wait-ForHealth -Label 'Agent 2' -TimeoutSec 30 -Probe {
      Test-Agent2Health -Port $spatialPort
    } | Out-Null

    Write-Status (Format-StatusLine -Label 'Spatial' -State 'READY')
    Write-Status (Format-StatusLine -Label 'Agent 2 (in-process)' -State 'READY')
    $record.spatialUrl = $config.SpatialUrl
    $state.services.spatial = $record
  }

  $state.piBrokerUrl = $config.PiBrokerUrl
  $state.spatialUrl = $config.SpatialUrl
  Save-LauncherState $state

  # Post-start verification (real PI + Agent 2, not health-only)
  $bundle = Test-SpatialBundleRoute -Port $spatialPort
  if (-not $bundle.Healthy) {
    throw "Point Intelligence bundle verification failed: $($bundle.Reason)"
  }
  $agent2 = Test-OpenWorldSearch -Port $spatialPort
  if (-not $agent2.Healthy) {
    throw "Agent 2 open-world search verification failed: $($agent2.Reason)"
  }

  $evidenceSummary = $bundle.Summary
  if (-not $evidenceSummary) {
    $evidenceSummary = Get-BundleEvidenceSummary -Bundle $bundle.Bundle
  }

  Write-Status ''
  Write-Status "Point Intelligence evidence: bundleState=$($evidenceSummary.BundleState) familiesWithResults=$($evidenceSummary.FamiliesWithResults) ($($evidenceSummary.Proof))"
  Write-Status "Agent 2 search: $($agent2.Result.searchState)"
  Write-Status ''
  Write-Status 'Opening IQAI Spatial...'
  Write-Status $config.SpatialUrl
  Write-Status ''

  if (-not $NoBrowser) {
    Start-Process $config.SpatialUrl | Out-Null
  }

  if ($Quiet) {
    Start-Sleep -Seconds 2
  } else {
    Write-Status 'Stack ready. This window will close in 5 seconds.'
    Start-Sleep -Seconds 5
  }
} catch {
  Write-Status ''
  Write-Status "START FAILED: $($_.Exception.Message)"
  Write-LauncherLog $_.Exception.Message 'ERROR'
  $paths = Get-IqaiStackPaths
  Write-Status "See log: $(Join-Path $paths.LogsDir 'launcher.log')"
  Write-Status 'Unrelated processes were not terminated.'
  Write-Status ''
  Write-Status 'Press Enter to close.'
  Read-Host | Out-Null
  exit 1
}
