# Build Windows .ico from official IQAI PNG (no branding changes).
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourceCandidates = @(
  (Join-Path $ProjectRoot 'assets\launchers\iqai-logo-source.png'),
  'C:\Users\nicol\OneDrive\Desktop\IQAI LOGO\iqai-logo-black-transparent-4000px.png'
)

$sourcePng = $sourceCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $sourcePng) {
  throw 'Official IQAI PNG source not found. Copy iqai-logo-black-transparent-4000px.png to assets\launchers\iqai-logo-source.png'
}

$outDir = Join-Path $ProjectRoot 'assets\launchers'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outIco = Join-Path $outDir 'iqai-spatial.ico'

$src = [System.Drawing.Image]::FromFile($sourcePng)
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$ratio = [Math]::Min($size / $src.Width, $size / $src.Height)
$w = [int]($src.Width * $ratio)
$h = [int]($src.Height * $ratio)
$x = [int](($size - $w) / 2)
$y = [int](($size - $h) / 2)
$g.DrawImage($src, $x, $y, $w, $h)
$g.Dispose()
$src.Dispose()

$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$stream = [System.IO.File]::Create($outIco)
$icon.Save($stream)
$stream.Close()
$bmp.Dispose()

Write-Output "Created $outIco from $sourcePng"
