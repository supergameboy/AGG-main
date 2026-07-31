#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 排除数据库问题
$errors = $lines | Where-Object {
  $_ -match '"level":"error"' -and
  $_ -notmatch 'malformed' -and
  $_ -notmatch 'frontend_logs'
}
Write-Host "=== Total error lines (excluding DB): $($errors.Count) ==="
Write-Host ""

# 显示前 30 条错误（截断长行）
$errors | Select-Object -First 30 | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $shortErr = if ($o.data.error) { $o.data.error.Substring(0, [Math]::Min(200, $o.data.error.Length)) } else { '' }
    Write-Host ("{0} | {1} | {2} | err={3}" -f $o.timestamp, $o.source, $o.message, $shortErr)
  } catch {
    Write-Host "PARSE_FAIL: $($_.Substring(0, [Math]::Min(200, $_.Length)))"
  }
}

Write-Host ""
Write-Host "=== warn level summary ==="
$warns = $lines | Where-Object { $_ -match '"level":"warn"' }
Write-Host "Total warn lines: $($warns.Count)"
$warns | Group-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $o.message
  } catch { 'parse_fail' }
} | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object {
  Write-Host ("{0,5} | {1}" -f $_.Count, $_.Name)
}
