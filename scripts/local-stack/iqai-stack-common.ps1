# IQAI local stack — shared configuration, health probes, and launcher state.
# Inspected stack (Agent 1 worktree):
#   1. PostgreSQL/PostGIS — system service on 5432 (dependency for PI broker)
#   2. Point Intelligence broker — node scripts/agent1-point-intelligence-broker.mjs
#   3. IQAI Spatial — node src/preview.js (Agent 2 routes load in-process)
$ErrorActionPreference = 'Stop'

function Get-IqaiStackPaths {
  $ScriptDir = $PSScriptRoot
  $Agent1Root = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
  $PiRoot = (Resolve-Path (Join-Path $Agent1Root '..\amerigo-vespucci-point-intelligence')).Path
  $ConnectorsRoot = (Resolve-Path (Join-Path $Agent1Root '..\amerigo-vespucci-intelligence-connectors')).Path
  $RuntimeRoot = Join-Path $Agent1Root '.local-runtime'
  $LogsDir = Join-Path $RuntimeRoot 'logs'
  $StateFile = Join-Path $RuntimeRoot 'launcher-state.json'
  [ordered]@{
    ScriptDir       = $ScriptDir
    Agent1Root      = $Agent1Root
    PiRoot          = $PiRoot
    ConnectorsRoot  = $ConnectorsRoot
    RuntimeRoot     = $RuntimeRoot
    LogsDir         = $LogsDir
    StateFile       = $StateFile
    IconPath        = Join-Path $Agent1Root 'assets\launchers\iqai-spatial.ico'
  }
}

function Read-DotEnvFile {
  param([string]$Path)
  $vars = @{}
  if (-not (Test-Path $Path)) { return $vars }
  foreach ($line in Get-Content $Path -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $eq = $trimmed.IndexOf('=')
    if ($eq -le 0) { continue }
    $key = $trimmed.Substring(0, $eq).Trim()
    $value = $trimmed.Substring($eq + 1).Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $vars[$key] = $value
  }
  return $vars
}

function Get-IqaiStackConfig {
  $paths = Get-IqaiStackPaths
  $agent1Env = Read-DotEnvFile (Join-Path $paths.Agent1Root '.env')
  $piEnv = Read-DotEnvFile (Join-Path $paths.PiRoot '.env')

  $spatialPort = 3000
  if ($agent1Env.PORT) { $spatialPort = [int]$agent1Env.PORT }
  elseif ($env:PORT) { $spatialPort = [int]$env:PORT }

  $piBrokerPort = $null
  if ($agent1Env.POINT_INTELLIGENCE_BROKER_URL) {
    try {
      $piBrokerPort = [uri]$agent1Env.POINT_INTELLIGENCE_BROKER_URL | ForEach-Object { $_.Port }
    } catch { }
  }
  if (-not $piBrokerPort -and $piEnv.POINT_INTELLIGENCE_PORT) {
    $piBrokerPort = [int]$piEnv.POINT_INTELLIGENCE_PORT
  }
  if (-not $piBrokerPort) { $piBrokerPort = 3027 }
  if (-not $agent1Env.POINT_INTELLIGENCE_BROKER_URL) {
    $agent1Env.POINT_INTELLIGENCE_BROKER_URL = "http://127.0.0.1:$piBrokerPort"
  }

  $piPortCandidates = @(3027, $piBrokerPort, 3025, 3028, 3029) | Where-Object { $_ } | Select-Object -Unique

  $storeRoot = $agent1Env.INTELLIGENCE_STORE_ROOT
  if (-not $storeRoot) {
    $storeRoot = Join-Path $paths.ConnectorsRoot 'data\intelligence\store'
  } elseif ($storeRoot -match '^\.\.') {
    $storeRoot = (Resolve-Path (Join-Path $paths.Agent1Root $storeRoot)).Path
  }

  [ordered]@{
    SessionId            = [guid]::NewGuid().ToString()
    SpatialPort          = $spatialPort
    SpatialUrl           = "http://localhost:$spatialPort/spatial/"
    PiBrokerPort         = $piBrokerPort
    PiPortCandidates     = $piPortCandidates
    PiBrokerUrl          = "http://127.0.0.1:$piBrokerPort"
    PostgresHost         = '127.0.0.1'
    PostgresPort         = 5432
    NodeExe              = (Get-Command node -ErrorAction Stop).Source
    Paths                = $paths
    Agent1Env            = $agent1Env
    PiEnv                = $piEnv
    IntelligenceStoreRoot = $storeRoot
  }
}

function Ensure-RuntimeDirs {
  param($Config)
  New-Item -ItemType Directory -Force -Path $Config.Paths.RuntimeRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $Config.Paths.LogsDir | Out-Null
}

function Write-LauncherLog {
  param(
    [string]$Message,
    [ValidateSet('INFO', 'WARN', 'ERROR')]
    [string]$Level = 'INFO'
  )
  $paths = Get-IqaiStackPaths
  Ensure-RuntimeDirs ([ordered]@{ Paths = $paths })
  $line = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Level, $Message
  Add-Content -Path (Join-Path $paths.LogsDir 'launcher.log') -Value $line -Encoding UTF8
}

function Get-ListeningPidForPort {
  param([int]$Port)
  $matchedPids = @()
  $output = netstat -ano | Select-String ":$Port\s"
  foreach ($row in $output) {
    $text = $row.ToString().Trim()
    if ($text -notmatch 'LISTENING') { continue }
    $parts = $text -split '\s+'
    $procId = [int]$parts[-1]
    if ($procId -gt 0) { $matchedPids += $procId }
  }
  return $matchedPids | Select-Object -Unique
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $proc) { return $null }
  return $proc.CommandLine
}

function Invoke-HttpJson {
  param(
    [string]$Url,
    [int]$TimeoutSec = 5,
    [string]$Method = 'GET',
    [string]$Body = $null
  )
  try {
    $params = @{
      Uri             = $Url
      Method          = $Method
      UseBasicParsing = $true
      TimeoutSec      = $TimeoutSec
    }
    if ($Body) {
      $params.Body = $Body
      $params.ContentType = 'application/json'
    }
    $res = Invoke-WebRequest @params
    return @{
      Ok     = $true
      Status = [int]$res.StatusCode
      Json   = ($res.Content | ConvertFrom-Json)
      Raw    = $res.Content
    }
  } catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    return @{ Ok = $false; Status = $status; Error = $_.Exception.Message }
  }
}

function Test-PostgresReady {
  param($Config)
  $result = Test-NetConnection -ComputerName $Config.PostgresHost -Port $Config.PostgresPort -WarningAction SilentlyContinue
  return [bool]$result.TcpTestSucceeded
}

function Test-PointIntelligenceBrokerHealth {
  param([int]$Port)
  $health = Invoke-HttpJson -Url "http://127.0.0.1:$Port/health" -TimeoutSec 5
  if (-not $health.Ok) { return @{ Healthy = $false; Reason = $health.Error } }
  $j = $health.Json
  if ($j.service -ne 'iqai-point-intelligence') {
    return @{ Healthy = $false; Reason = "unexpected service: $($j.service)" }
  }
  if ($j.repository -ne 'postgresql') {
    return @{ Healthy = $false; Reason = "repository is $($j.repository), expected postgresql" }
  }
  if ([int]$j.verifiedExecutionCount -lt 7) {
    return @{ Healthy = $false; Reason = "verifiedExecutionCount=$($j.verifiedExecutionCount)" }
  }
  return @{ Healthy = $true; Health = $j }
}

function Test-SpatialHealth {
  param([int]$Port)
  $health = Invoke-HttpJson -Url "http://127.0.0.1:$Port/health" -TimeoutSec 5
  if (-not $health.Ok) { return @{ Healthy = $false; Reason = $health.Error } }
  $j = $health.Json
  if (-not $j.ok) { return @{ Healthy = $false; Reason = 'health ok=false' } }
  if (-not $j.spatialEngine) { return @{ Healthy = $false; Reason = 'missing spatialEngine' } }
  return @{ Healthy = $true; Health = $j }
}

function Test-Agent2Health {
  param([int]$Port)
  $health = Invoke-HttpJson -Url "http://127.0.0.1:$Port/api/spatial/intelligence/health" -TimeoutSec 8
  if (-not $health.Ok) { return @{ Healthy = $false; Reason = $health.Error } }
  $j = $health.Json
  if ($j.service -ne 'iqai-intelligence-connectors') {
    return @{ Healthy = $false; Reason = "unexpected service: $($j.service)" }
  }
  return @{ Healthy = $true; Health = $j }
}

function Get-BundleEvidenceSummary {
  param($Bundle)
  $families = @()
  if ($Bundle.families) {
    if ($Bundle.families -is [System.Collections.IDictionary]) {
      $families = @($Bundle.families.Values)
    } elseif ($Bundle.families.PSObject.Properties) {
      $families = @($Bundle.families.PSObject.Properties | ForEach-Object { $_.Value })
    }
  }

  $withResults = @($families | Where-Object {
    [int]$_.resultCount -gt 0 -or $_.status -eq 'SUCCESS'
  })

  $proof = @()
  foreach ($family in ($withResults | Select-Object -First 3)) {
    $label = $family.informationFamily
    if (-not $label) { $label = $family.nativeId }
    $proof += "$label=$($family.resultCount)"
  }

  return [ordered]@{
    BundleState          = $Bundle.bundleState
    FamilyCount          = $families.Count
    FamiliesWithResults  = $withResults.Count
    Proof                = ($proof -join ', ')
  }
}

function Test-SpatialBundleRoute {
  param([int]$Port)
  $body = '{"geometry":{"type":"Point","coordinates":[-73.5673,45.5017]},"radiusMeters":3000,"informationFamilies":"AUTO","temporalIntent":{"mode":"LATEST"}}'
  $res = Invoke-HttpJson -Url "http://127.0.0.1:$Port/api/spatial/point-intelligence/query-bundle" -Method POST -Body $body -TimeoutSec 90
  if (-not $res.Ok) {
    if ($res.Status -eq 404) { return @{ Healthy = $false; Reason = 'bundle route missing (404)' } }
    return @{ Healthy = $false; Reason = $res.Error }
  }
  if (-not $res.Json.bundleState) { return @{ Healthy = $false; Reason = 'missing bundleState' } }
  $summary = Get-BundleEvidenceSummary -Bundle $res.Json
  $healthy = $summary.FamiliesWithResults -gt 0
  return @{
    Healthy = $healthy
    Bundle  = $res.Json
    Summary = $summary
    Reason  = $(if ($healthy) { $null } else { 'bundle returned zero families with results' })
  }
}

function Test-OpenWorldSearch {
  param([int]$Port)
  $body = '{"keyword":"montreal","interpretation":"APPEARED","plan":{"archive":{"limit":1},"spatial":{"province":"QC"}}}'
  $res = Invoke-HttpJson -Url "http://127.0.0.1:$Port/api/spatial/open-world-intelligence/search" -Method POST -Body $body -TimeoutSec 30
  if (-not $res.Ok) { return @{ Healthy = $false; Reason = $res.Error } }
  if ($res.Json.searchState -notin @('SUCCESS', 'NO_RESULTS')) {
    return @{ Healthy = $false; Reason = "searchState=$($res.Json.searchState)" }
  }
  return @{ Healthy = $true; Result = $res.Json }
}

function Test-ProcessIdentity {
  param(
    [int]$ProcessId,
    [string]$ServiceKey,
    $Config
  )
  $cmd = Get-ProcessCommandLine -ProcessId $ProcessId
  if (-not $cmd) { return @{ Match = $false; Reason = 'process not found'; CommandLine = $null } }

  switch ($ServiceKey) {
    'point-intelligence' {
      $ok = $cmd -match 'agent1-point-intelligence-broker\.mjs'
      return @{ Match = [bool]$ok; Reason = $(if ($ok) { 'ok' } else { 'not PI broker command' }); CommandLine = $cmd }
    }
    'spatial' {
      $ok = ($cmd -match 'src[\\/]preview\.js' -or $cmd -match 'src\\preview\.js')
      $ok = $ok -and ($cmd -match [regex]::Escape($Config.Paths.Agent1Root) -or $cmd -match 'src[\\/]preview\.js')
      return @{ Match = [bool]$ok; Reason = $(if ($ok) { 'ok' } else { 'not Agent 1 spatial preview' }); CommandLine = $cmd }
    }
    default {
      return @{ Match = $false; Reason = 'unknown service'; CommandLine = $cmd }
    }
  }
}

function Get-LauncherState {
  $paths = Get-IqaiStackPaths
  if (-not (Test-Path $paths.StateFile)) { return $null }
  try {
    return Get-Content $paths.StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Save-LauncherState {
  param($State)
  $paths = Get-IqaiStackPaths
  Ensure-RuntimeDirs ([ordered]@{ Paths = $paths })
  $State | ConvertTo-Json -Depth 8 | Set-Content -Path $paths.StateFile -Encoding UTF8
}

function New-LauncherState {
  param($Config)
  [ordered]@{
    sessionId  = $Config.SessionId
    startedAt  = (Get-Date).ToString('o')
    agent1Root = $Config.Paths.Agent1Root
    services   = @{}
  }
}

function Wait-ForHealth {
  param(
    [scriptblock]$Probe,
    [int]$TimeoutSec = 120,
    [string]$Label = 'service'
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $result = & $Probe
    if ($result.Healthy) { return $result }
    Start-Sleep -Milliseconds 750
  }
  $last = & $Probe
  throw "$Label did not become ready within ${TimeoutSec}s: $($last.Reason)"
}

function Start-OwnedProcess {
  param(
    [string]$ServiceKey,
    [string]$DisplayName,
    [string]$FilePath,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [int]$Port,
    [hashtable]$Environment = @{},
    $Config
  )
  $stdout = Join-Path $Config.Paths.LogsDir "$ServiceKey.log"
  $stderr = Join-Path $Config.Paths.LogsDir "$ServiceKey.err.log"
  if (Test-Path $stdout) { Remove-Item $stdout -Force -ErrorAction SilentlyContinue }
  if (Test-Path $stderr) { Remove-Item $stderr -Force -ErrorAction SilentlyContinue }

  $envBackup = @{}
  foreach ($key in $Environment.Keys) {
    $envBackup[$key] = (Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue).Value
    Set-Item -Path "Env:$key" -Value $Environment[$key]
  }

  try {
    $proc = Start-Process `
      -FilePath $FilePath `
      -ArgumentList $Arguments `
      -WorkingDirectory $WorkingDirectory `
      -PassThru `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr
  } finally {
    foreach ($key in $Environment.Keys) {
      if ($null -eq $envBackup[$key]) {
        Remove-Item "Env:$key" -ErrorAction SilentlyContinue
      } else {
        Set-Item -Path "Env:$key" -Value $envBackup[$key]
      }
    }
  }

  Write-LauncherLog "Started $DisplayName PID $($proc.Id) port $Port"

  return [ordered]@{
    name              = $ServiceKey
    displayName       = $DisplayName
    pid               = $proc.Id
    port              = $Port
    command           = "$FilePath $Arguments"
    workingDirectory  = $WorkingDirectory
    startedAt         = (Get-Date).ToString('o')
    owned             = $true
    reused            = $false
    logPath           = $stdout
    errLogPath        = $stderr
    healthUrl         = "http://127.0.0.1:$Port/health"
  }
}

function Stop-OwnedServiceProcess {
  param(
    $ServiceRecord,
    $Config
  )
  if (-not $ServiceRecord.owned) {
    Write-LauncherLog "Skip stop for reused service $($ServiceRecord.name)" 'INFO'
    return $true
  }

  $procId = [int]$ServiceRecord.pid
  if ($procId -le 0) { return $true }

  $identity = Test-ProcessIdentity -ProcessId $procId -ServiceKey $ServiceRecord.name -Config $Config
  if (-not $identity.Match) {
    Write-LauncherLog "Stale PID $procId for $($ServiceRecord.name): $($identity.Reason). Not terminating." 'WARN'
    return $false
  }

  try {
    & taskkill /PID $procId /T /F | Out-Null
    Write-LauncherLog "Stopped $($ServiceRecord.name) PID $procId"
    return $true
  } catch {
    Write-LauncherLog "Failed to stop $($ServiceRecord.name) PID ${procId}: $($_.Exception.Message)" 'ERROR'
    return $false
  }
}

function Resolve-HealthyPiPort {
  param($Config)
  foreach ($port in $Config.PiPortCandidates) {
    $health = Test-PointIntelligenceBrokerHealth -Port $port
    if ($health.Healthy) {
      return @{ Port = $port; Reused = $true; Health = $health.Health }
    }
  }
  return $null
}

function Get-ReusablePointIntelligence {
  param($Config)
  $healthy = Resolve-HealthyPiPort $Config
  if ($healthy) {
    $listenerPid = Get-ListeningPidForPort -Port $healthy.Port | Select-Object -First 1
    return @{
      Port    = $healthy.Port
      Pid     = $listenerPid
      Healthy = $true
      Health  = $healthy.Health
      Source  = 'health'
    }
  }

  foreach ($port in $Config.PiPortCandidates) {
    $listenerPid = Get-ListeningPidForPort -Port $port | Select-Object -First 1
    if (-not $listenerPid) { continue }
    $identity = Test-ProcessIdentity -ProcessId $listenerPid -ServiceKey 'point-intelligence' -Config $Config
    if (-not $identity.Match) { continue }
    $health = Test-PointIntelligenceBrokerHealth -Port $port
    if ($health.Healthy) {
      return @{
        Port    = $port
        Pid     = $listenerPid
        Healthy = $true
        Health  = $health.Health
        Source  = 'identity+health'
      }
    }
  }
  return $null
}

function Get-ReusableSpatial {
  param(
    $Config,
    [int]$Port
  )
  $spatialHealthy = Test-SpatialHealth -Port $Port
  if (-not $spatialHealthy.Healthy) { return $null }
  $bundleHealthy = Test-SpatialBundleRoute -Port $Port
  if (-not $bundleHealthy.Healthy) { return $null }
  if ($bundleHealthy.Summary.FamiliesWithResults -eq 0) { return $null }
  $agent2Healthy = Test-Agent2Health -Port $Port
  if (-not $agent2Healthy.Healthy) { return $null }
  $listenerPid = Get-ListeningPidForPort -Port $Port | Select-Object -First 1
  if (-not $listenerPid) { return $null }
  $identity = Test-ProcessIdentity -ProcessId $listenerPid -ServiceKey 'spatial' -Config $Config
  if (-not $identity.Match) { return $null }
  return @{
    Port          = $Port
    Pid           = $listenerPid
    BundleSummary = $bundleHealthy.Summary
    Agent2        = $agent2Healthy.Health
  }
}

function Resolve-PiStartPort {
  param($Config)
  $reusable = Get-ReusablePointIntelligence $Config
  if ($reusable) { return $reusable.Port }
  foreach ($port in $Config.PiPortCandidates) {
    if (-not $port) { continue }
    $listenerPid = Get-ListeningPidForPort -Port $port | Select-Object -First 1
    if (-not $listenerPid) { return $port }
    $identity = Test-ProcessIdentity -ProcessId $listenerPid -ServiceKey 'point-intelligence' -Config $Config
    if ($identity.Match) {
      $health = Test-PointIntelligenceBrokerHealth -Port $port
      throw "Port $port has IQAI Point Intelligence broker PID $listenerPid but is not healthy: $($health.Reason)"
    }
    Write-LauncherLog "Port $port occupied by unrelated PID $listenerPid; trying next PI port candidate" 'WARN'
  }
  throw "No available port for Point Intelligence broker among: $($Config.PiPortCandidates -join ', ')"
}

function Get-ServiceStackDefinition {
  param($Config)
  @(
    [ordered]@{
      key         = 'postgresql'
      displayName = 'PostgreSQL'
      startable   = $false
    },
    [ordered]@{
      key         = 'point-intelligence'
      displayName = 'Point Intelligence'
      startable   = $true
      port        = $Config.PiBrokerPort
      script      = Join-Path $Config.Paths.Agent1Root 'scripts\agent1-point-intelligence-broker.mjs'
      workdir     = $Config.Paths.Agent1Root
      env         = @{ POINT_INTELLIGENCE_PORT = [string]$Config.PiBrokerPort }
    },
    [ordered]@{
      key         = 'spatial'
      displayName = 'Spatial'
      startable   = $true
      port        = $Config.SpatialPort
      script      = Join-Path $Config.Paths.Agent1Root 'src\preview.js'
      workdir     = $Config.Paths.Agent1Root
      env         = @{
        PORT                           = [string]$Config.SpatialPort
        POINT_INTELLIGENCE_BROKER_URL  = $Config.PiBrokerUrl
        INTELLIGENCE_STORE_ROOT        = $Config.IntelligenceStoreRoot
      }
    }
  )
}

function Format-StatusLine {
  param(
    [string]$Label,
    [int]$Width = 22,
    [ValidateSet('READY', 'REUSED', 'FAILED', 'WAIT', 'SKIP')]
    [string]$State
  )
  $dots = '.' * [Math]::Max(1, $Width - $Label.Length)
  "$Label $dots $State"
}
