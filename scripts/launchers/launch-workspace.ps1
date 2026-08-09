# IQAI Spatial — shared Windows launcher (start server if needed, open workspace).
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('investigation', 'intelligence')]
  [string]$Workspace
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Port = if ($env:PORT) { [int]$env:PORT } elseif ($env:PREVIEW_PORT) { [int]$env:PREVIEW_PORT } else { 3000 }
$LogFile = Join-Path $env:TEMP 'iqai-spatial-server.log'
$LockFile = Join-Path $env:TEMP 'iqai-spatial-preview.lock'

$Routes = @{
  investigation = '/spatial/intelligence-lab/'
  intelligence  = '/spatial/'
}

$TargetUrl = "http://localhost:$Port$($Routes[$Workspace])"

function Test-IqaiServer {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-IqaiServer {
  param([int]$TimeoutSec = 90)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-IqaiServer) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Start-IqaiServer {
  if (Test-IqaiServer) { return }

  if (Test-Path $LockFile) {
    $existingPid = Get-Content $LockFile -ErrorAction SilentlyContinue
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
      if (Wait-IqaiServer -TimeoutSec 30) { return }
    }
  }

  $node = (Get-Command node -ErrorAction Stop).Source
  $serverScript = Join-Path $ProjectRoot 'src\preview.js'
  if (-not (Test-Path $serverScript)) {
    throw "Server entry not found: $serverScript"
  }

  $outLog = Join-Path $env:TEMP 'iqai-spatial-server-out.log'
  $errLog = Join-Path $env:TEMP 'iqai-spatial-server.err.log'

  $proc = Start-Process `
    -FilePath $node `
    -ArgumentList "`"$serverScript`"" `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

  Set-Content -Path $LockFile -Value $proc.Id -Encoding ascii

  if (-not (Wait-IqaiServer)) {
    throw "IQAI Spatial server did not become ready on port $Port. See $LogFile"
  }
}

Start-IqaiServer
Start-Process $TargetUrl | Out-Null
