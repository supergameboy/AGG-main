#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

$warns = $lines | Where-Object { $_ -match '"level":"warn"' }

Write-Host "=== All warn lines (full detail) ==="
$warns | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $dataStr = if ($o.data) { ($o.data | ConvertTo-Json -Compress -Depth 3) } else { '' }
    if ($dataStr.Length -gt 300) { $dataStr = $dataStr.Substring(0, 300) + '...' }
    Write-Host ("{0} | {1} | {2} | data={3}" -f $o.timestamp, $o.source, $o.message, $dataStr)
  } catch {
    Write-Host "PARSE_FAIL: $($_.Substring(0, [Math]::Min(200, $_.Length)))"
  }
}
