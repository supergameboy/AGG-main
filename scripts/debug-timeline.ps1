#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 用 [DateTime]::Parse 处理 +08:00 时区
function ParseTs([string]$ts) {
  if (-not $ts) { return $null }
  try { return [DateTime]::Parse($ts) } catch { return $null }
}

# 提取所有记录
$records = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  $tm = [regex]::Match($line, '"timestamp"\s*:\s*"([^"]+)"')
  $tg = [regex]::Match($line, '"tag"\s*:\s*"([^"]+)"')
  $ag = [regex]::Match($line, '"agent"\s*:\s*"([^"]+)"')
  $im = [regex]::Match($line, '"iteration"\s*:\s*(\d+)')
  if (-not ($tm.Success -and $tg.Success)) { continue }
  $records += [PSCustomObject]@{
    Line = $i
    Timestamp = $tm.Groups[1].Value
    Dt = (ParseTs $tm.Groups[1].Value)
    Tag = $tg.Groups[1].Value
    Agent = if ($ag.Success) { $ag.Groups[1].Value } else { '' }
    Iteration = if ($im.Success) { [int]$im.Groups[1].Value } else { $null }
  }
}

Write-Host "=== total duration ==="
$valid = $records | Where-Object { $_.Dt -ne $null }
$tStart = ($valid | Sort-Object Dt)[0].Dt
$tEnd = ($valid | Sort-Object Dt)[-1].Dt
Write-Host ("  start: {0:HH:mm:ss.fff}" -f $tStart)
Write-Host ("  end:   {0:HH:mm:ss.fff}" -f $tEnd)
Write-Host ("  total: {0:N2} seconds ({1:N2} min)" -f ($tEnd - $tStart).TotalSeconds, ($tEnd - $tStart).TotalMinutes)

Write-Host ""
Write-Host "=== gamemaster per-iter LLM latency ==="
$gmIn = $valid | Where-Object { $_.Agent -eq 'gamemaster' -and $_.Tag -eq 'LLM-INPUT' } | Sort-Object Line
$gmOut = $valid | Where-Object { $_.Agent -eq 'gamemaster' -and $_.Tag -eq 'LLM-OUTPUT' } | Sort-Object Line
$totLat = 0
for ($k = 0; $k -lt [Math]::Min($gmIn.Count, $gmOut.Count); $k++) {
  $lat = ($gmOut[$k].Dt - $gmIn[$k].Dt).TotalSeconds
  $totLat += $lat
  Write-Host ("  iter {0,3}: {1:N2}s" -f $gmIn[$k].Iteration, $lat)
}
Write-Host ("  GM LLM total: {0:N2}s ({1:N1}% of total)" -f $totLat, ($totLat / ($tEnd - $tStart).TotalSeconds * 100))

Write-Host ""
Write-Host "=== sub-agent duration ==="
$agents = $valid | Where-Object { $_.Agent -ne '' -and $_.Agent -ne 'gamemaster' } | Group-Object Agent
foreach ($a in $agents) {
  $r = $a.Group | Sort-Object Dt
  $dur = ($r[-1].Dt - $r[0].Dt).TotalSeconds
  $llmInCount = ($a.Group | Where-Object { $_.Tag -eq 'LLM-INPUT' }).Count
  $startLine = $r[0].Line
  $endLine = $r[-1].Line
  Write-Host ("  {0,-12} dur={1,7:N2}s  llm-in={2,3}  records={3,4}  lines {4}-{5}" -f $a.Name, $dur, $llmInCount, $a.Group.Count, $startLine, $endLine)
}

Write-Host ""
Write-Host "=== top 10 longest gaps (consecutive records in same agent) ==="
$gaps = @()
foreach ($a in $agents) {
  $r = $a.Group | Sort-Object Line
  for ($k = 1; $k -lt $r.Count; $k++) {
    $gap = ($r[$k].Dt - $r[$k-1].Dt).TotalSeconds
    if ($gap -gt 1) {
      $gaps += [PSCustomObject]@{
        Agent = $a.Name
        Gap = $gap
        From = $r[$k-1]
        To = $r[$k]
      }
    }
  }
}
$gaps | Sort-Object Gap -Descending | Select-Object -First 10 | ForEach-Object {
  Write-Host ("  {0,-12} {1,6:N2}s  {2} {3} -> {4} {5}" -f $_.Agent, $_.Gap, $_.From.Timestamp, $_.From.Tag, $_.To.Timestamp, $_.To.Tag)
}

Write-Host ""
Write-Host "=== AGENT-START / AGENT-END events ==="
$agEvents = $valid | Where-Object { $_.Tag -eq 'AGENT-START' -or $_.Tag -eq 'AGENT-END' } | Sort-Object Line
foreach ($e in $agEvents) {
  # 提取该行的关键字段
  $line = $lines[$e.Line]
  $msg = ''
  $mm = [regex]::Match($line, '"message"\s*:\s*"((?:[^"\\]|\\.)*)"')
  if ($mm.Success) { $msg = $mm.Groups[1].Value }
  $reason = ''
  $rm = [regex]::Match($line, '"reason"\s*:\s*"((?:[^"\\]|\\.)*)"')
  if ($rm.Success) { $reason = $rm.Groups[1].Value }
  Write-Host ("  {0} {1,-12} {2} {3}" -f $e.Timestamp, $e.Agent, $msg, $reason)
}
