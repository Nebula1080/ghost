# Packs every downloaded Bungie icon (data/raw/icons/b, order from data/raw/icons/list.json) into one
# sprite sheet, data/sprite.png, so the page never loads images from bungie.net (claude.ai blocks them).
# Uses only .NET's built-in System.Drawing (Windows PowerShell 5.1), no extra installs.
# Usage: powershell -ExecutionPolicy Bypass -File tools/build-sprite.ps1 [-Size 48] [-Cols 48]
param([int]$Size = 48, [int]$Cols = 48)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$list = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/raw/icons/list.json') | ConvertFrom-Json
$rows = [math]::Ceiling($list.Count / $Cols)
$sheet = New-Object System.Drawing.Bitmap ($Cols * $Size), ($rows * $Size), ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$missing = 0
for ($i = 0; $i -lt $list.Count; $i++) {
  $f = Join-Path $root ('data/raw/icons/b/' + ($list[$i] -replace '/', '_'))
  if (-not (Test-Path $f)) { $missing++; continue }
  try {
    $img = [System.Drawing.Image]::FromFile($f)
    $x = ($i % $Cols) * $Size; $y = [math]::Floor($i / $Cols) * $Size
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle $x, $y, $Size, $Size))
    $img.Dispose()
  } catch { $missing++ }
}
$g.Dispose()
$out = Join-Path $root 'data/sprite.png'
$sheet.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
"sprite: $($list.Count) icons, $Cols x $rows at ${Size}px, missing $missing, $((Get-Item $out).Length) bytes"
