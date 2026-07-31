#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 提取每条日志的时间戳、tag、agent、iteration
$records = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  $ts = ''
  $tag = ''
  $agent = ''
  $iter = $null
  $tm = [regex]::Match($line, '"timestamp"\s*:\s*"([^"]+)"')
  if ($tm.Success) { $ts = $tm.Groups[1].Value }
  $tg = [regex]::Match($line, '"tag"\s*:\s*"([^"]+)"')
  if ($tg.Success) { $tag = $tg.Groups[1].Value }
  $ag = [regex]::Match($line, '"agent"\s*:\s*"([^"]+)"')
  if ($ag.Success) { $agent = $ag.Groups[1].Value }
  $im = [regex]::Match($line, '"iteration"\s*:\s*(\d+)')
  if ($im.Success) { $iter = [int]$im.Groups[1].Value }

  if ($ts -and $tag) {
    $records += [PSCustomObject]@{
      Line = $i
      Timestamp = $ts
      Tag = $tag
      Agent = $agent
      Iteration = $iter
    }
  }
}

Write-Host "=== total log records: $($records.Count) ==="
if ($records.Count -eq 0) { exit }

$first = $records[0].Timestamp
$last = $records[$records.Count - 1].Timestamp
Write-Host "first timestamp: $first"
Write-Host "last timestamp:  $last"

# 时间范围（按 datetime 解析）
$fmt = 'yyyy-MM-ddTHH:mm:ss.fffZ'
try {
  $tStart = [DateTime]::ParseExact($first, $fmt, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)
  $tEnd = [DateTime]::ParseExact($last, $fmt, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)
  $totalSec = ($tEnd - $tStart).TotalSeconds
  Write-Host "total duration: $totalSec seconds"
} catch {
  Write-Host "time parse failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "=== record count by tag ==="
$records | Group-Object Tag | Sort-Object Count -Descending | ForEach-Object {
  Write-Host ("  {0,-25} {1}" -f $_.Name, $_.Count)
}

Write-Host ""
Write-Host "=== record count by agent ==="
$records | Group-Object Agent | Sort-Object Count -Descending | ForEach-Object {
  Write-Host ("  {0,-25} {1}" -f $_.Name, $_.Count)
}

Write-Host ""
Write-Host "=== gamemaster LLM calls (LLM-INPUT + LLM-OUTPUT pairs) ==="
$gmLlmIn = $records | Where-Object { $_.Agent -eq 'gamemaster' -and $_.Tag -eq 'LLM-INPUT' } | Sort-Object Line
$gmLlmOut = $records | Where-Object { $_.Agent -eq 'gamemaster' -and $_.Tag -eq 'LLM-OUTPUT' } | Sort-Object Line
Write-Host "  LLM-INPUT:  $($gmLlmIn.Count)"
Write-Host "  LLM-OUTPUT: $($gmLlmOut.Count)"

# 每次 LLM 调用耗时
if ($gmLlmIn.Count -gt 0 -and $gmLlmOut.Count -gt 0) {
  Write-Host ""
  Write-Host "  per-iteration LLM latency:"
  for ($k = 0; $k -lt [Math]::Min($gmLlmIn.Count, $gmLlmOut.Count); $k++) {
    $in = $gmLlmIn[$k]
    $out = $gmLlmOut[$k]
    try {
      $tIn = [DateTime]::ParseExact($in.Timestamp, $fmt, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)
      $tOut = [DateTime]::ParseExact($out.Timestamp, $fmt, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)
      $lat = ($tOut - $tIn).TotalSeconds
      Write-Host ("    iter {0,3}: in={1}  out={2}  latency={3:N2}s" -f $in.Iteration, $in.Timestamp, $out.Timestamp, $lat)
    } catch {
      Write-Host "    parse fail at $k"
    }
  }
}

Write-Host ""
Write-Host "=== sub-agent dispatch & duration ==="
# 子 agent 调度：找 LLM-INPUT 中 agent != gamemaster 的
$subAgents = $records | Where-Object { $_.Agent -ne 'gamemaster' -and $_.Agent -ne '' } | Group-Object Agent
foreach ($sa in $subAgents) {
  $agentName = $sa.Name
  $agentRecs = $sa.Group | Sort-Object Line
  $tFirst = $agentRecs[0].Timestamp
  $tLastRec = $agentRecs[$agentRecs.Count - 1]
  $tLast = $tLastRec.Timestamp
  try {
    $t1 = [DateTime]::ParseExact($tFirst, $fmt, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    $t2 = [DateTime]::ParseExact($tLast, $fmt, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    $dur = ($t2 - $t1).TotalSeconds
    $llmInCount = ($agentRecs | Where-Object { $_.Tag -eq 'LLM-INPUT' }).Count
    Write-Host ("  {0,-15} records={1,4} llm-in={2,3} duration={3:N2}s" -f $agentName, $agentRecs.Count, $llmInCount, $dur)
  } catch {
    Write-Host "  $agentName parse fail"
  }
}

Write-Host ""
Write-Host "=== load_skill calls ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -notmatch '"tag":"TOOL-CALL"') { continue }
  if ($line -notmatch 'load_skill') { continue }
  $tm = [regex]::Match($line, '"timestamp"\s*:\s*"([^"]+)"')
  $ts = if ($tm.Success) { $tm.Groups[1].Value } else { 'unknown' }
  $am = [regex]::Match($line, '"agent"\s*:\s*"([^"]+)"')
  $ag = if ($am.Success) { $am.Groups[1].Value } else { 'unknown' }
  $nm = [regex]::Match($line, '"skillName"\s*:\s*"([^"]+)"')
  $sn = if ($nm.Success) { $nm.Groups[1].Value } else { 'unknown' }
  Write-Host "  $ts agent=$ag skill=$sn"
}

Write-Host ""
Write-Host "=== errors / warnings ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match '"tag":"ERROR"' -or $line -match '"tag":"WARN"' -or $line -match '"level":"error"' -or $line -match '"level":"warn"') {
    $tm = [regex]::Match($line, '"timestamp"\s*:\s*"([^"]+)"')
    $ts = if ($tm.Success) { $tm.Groups[1].Value } else { '' }
    $msg = ''
    $mm = [regex]::Match($line, '"message"\s*:\s*"((?:[^"\\]|\\.)*)"')
    if ($mm.Success) { $msg = $mm.Groups[1].Value }
    if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) + '...' }
    Write-Host "  line $i $ts $msg"
  }
}
