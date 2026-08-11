# IQAI Spatial — STOP launcher-owned services only
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'iqai-stack-common.ps1')

function Write-Status {
  param([string]$Message)
  Write-Host $Message
  Write-LauncherLog $Message
}

try {
  $config = Get-IqaiStackConfig
  $state = Get-LauncherState

  Write-Status ''
  Write-Status 'IQAI Spatial — Stopping'
  Write-Status ''

  if (-not $state -or -not $state.services) {
    Write-Status 'No launcher state found — nothing to stop.'
    Write-Status 'Reused/system services were left running.'
    Write-Status ''
    Start-Sleep -Seconds 3
    exit 0
  }

  $stopped = @()
  $stale = @()
  $skipped = @()

  # Stop spatial before PI broker
  foreach ($key in @('spatial', 'point-intelligence')) {
    $svc = $state.services.$key
    if (-not $svc) { continue }

    if ($svc.reused -eq $true -and $svc.owned -eq $false) {
      Write-Status (Format-StatusLine -Label $svc.displayName -State 'SKIP')
      $skipped += $key
      continue
    }

    $ok = Stop-OwnedServiceProcess -ServiceRecord $svc -Config $config
    if ($ok) {
      Write-Status (Format-StatusLine -Label $svc.displayName -State 'READY')
      $stopped += $key
    } else {
      Write-Status (Format-StatusLine -Label $svc.displayName -State 'FAILED')
      $stale += $key
    }
  }

  if ($state.services.postgresql) {
    Write-Status (Format-StatusLine -Label 'PostgreSQL' -State 'SKIP')
  }

  # Remove state file after stop attempt
  $paths = Get-IqaiStackPaths
  if (Test-Path $paths.StateFile) {
    Remove-Item $paths.StateFile -Force
  }

  Write-Status ''
  Write-Status "Stopped launcher-owned: $(if ($stopped.Count) { $stopped -join ', ' } else { 'none' })"
  if ($stale.Count) {
    Write-Status "Stale/unverified (not killed): $($stale -join ', ')"
  }
  if ($skipped.Count) {
    Write-Status "Reused services left running: $($skipped -join ', ')"
  }
  Write-Status 'Unrelated node/npm/PostgreSQL processes were not touched.'
  Write-Status ''
  Start-Sleep -Seconds 4
} catch {
  Write-Status "STOP FAILED: $($_.Exception.Message)"
  Write-LauncherLog $_.Exception.Message 'ERROR'
  Write-Status 'Press Enter to close.'
  Read-Host | Out-Null
  exit 1
}
