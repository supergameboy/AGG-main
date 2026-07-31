# Sprite atlas post-processing (Protocol v3 companion tool, Appendix A sec.4)
# ImageGen output is .jpg with an "AI" watermark badge and dark-gray grid lines. This script:
#   1. jpg -> png, normalized to the target size (chroma-key needs lossless edges)
#   2. fills grid lines + outer frame with pure black (residual lines bleed through soft alpha band)
#   3. fills the bottom-right watermark area with pure black (lands on an unmapped cell)
# Grids: vertical layer is 4x4 (1024x1024); entity layer is 3x2 (2400x1600).
# NOTE: keep this file pure ASCII - Windows PowerShell 5.1 misreads UTF-8-no-BOM CJK comments.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/atlas-postprocess.ps1 -SrcName 'vertical-tiles-v3.jpg' -DstName 'vertical-tiles-v3.png'
#   powershell -ExecutionPolicy Bypass -File scripts/atlas-postprocess.ps1 -SrcName 'entity-x.jpg' -DstName 'entity-x.png' -Cols 3 -Rows 2 -DstWidth 2400 -DstHeight 1600
param(
  [string]$SrcName = 'vertical-tiles-v2(1).jpg',
  [string]$DstName = 'vertical-tiles-v2.png',
  [int]$Cols = 4,
  [int]$Rows = 4,
  [int]$DstWidth = 1024,
  [int]$DstHeight = 1024
)

$ErrorActionPreference = 'Stop'
$sprites = Join-Path $PSScriptRoot '..\public\sprites'
Add-Type -AssemblyName System.Drawing

function Convert-Atlas([string]$srcPath, [string]$dstPath) {
  if (-not (Test-Path $srcPath)) { Write-Output "skip (missing): $srcPath"; return }
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $cellW = $DstWidth / $Cols
  $cellH = $DstHeight / $Rows
  $bmp = New-Object System.Drawing.Bitmap($DstWidth, $DstHeight)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $DstWidth, $DstHeight)
  $black = [System.Drawing.Brushes]::Black
  # grid lines: line center drifts proportionally to cell size; fill +/-4% of the cell.
  # mapped sprites are centered with wide margins, so the fill never touches content.
  $halfX = [Math]::Max(10, [int]($cellW * 0.04))
  $halfY = [Math]::Max(10, [int]($cellH * 0.04))
  for ($i = 1; $i -lt $Cols; $i += 1) {
    $p = $i * $cellW
    $g.FillRectangle($black, [int]($p - $halfX), 0, $halfX * 2, $DstHeight)
  }
  for ($i = 1; $i -lt $Rows; $i += 1) {
    $p = $i * $cellH
    $g.FillRectangle($black, 0, [int]($p - $halfY), $DstWidth, $halfY * 2)
  }
  # outer frame (generated images sometimes carry bright edges)
  $g.FillRectangle($black, 0, 0, $DstWidth, 2)
  $g.FillRectangle($black, 0, ($DstHeight - 2), $DstWidth, 2)
  $g.FillRectangle($black, 0, 0, 2, $DstHeight)
  $g.FillRectangle($black, ($DstWidth - 2), 0, 2, $DstHeight)
  # watermark area: bottom-right badge + tiny label at bottom edge (proportional to the 1024 baseline)
  $g.FillRectangle($black, [int]($DstWidth * 0.75), [int]($DstHeight * 0.836), [int]($DstWidth * 0.25), [int]($DstHeight * 0.164))
  $g.Dispose()
  $bmp.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $src.Dispose()
  Write-Output "ok: $dstPath ($DstWidth x $DstHeight, $Cols x $Rows)"
}

Convert-Atlas (Join-Path $sprites $SrcName) (Join-Path $sprites $DstName)
