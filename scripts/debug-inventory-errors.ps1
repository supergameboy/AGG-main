#Requires -Version 7.0
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 找所有 equipItem: category not allowed 附近的日志
Write-Host "=== equipItem errors context ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -notmatch 'equipItem: category not allowed') { continue }
  Write-Host ""
  Write-Host "--- line $i ---"
  # 前 2 行后 2 行
  $start = [Math]::Max(0, $i - 2)
  $end = [Math]::Min($lines.Count - 1, $i + 2)
  for ($j = $start; $j -le $end; $j++) {
    $l = $lines[$j]
    # 截取关键信息
    $ts = ''
    $tm = [regex]::Match($l, '"timestamp"\s*:\s*"([^"]+)"')
    if ($tm.Success) { $ts = $tm.Groups[1].Value }
    $tag = ''
    $tg = [regex]::Match($l, '"tag"\s*:\s*"([^"]+)"')
    if ($tg.Success) { $tag = $tg.Groups[1].Value }
    $ag = ''
    $am = [regex]::Match($l, '"agent"\s*:\s*"([^"]+)"')
    if ($am.Success) { $ag = $am.Groups[1].Value }
    $msg = ''
    $mm = [regex]::Match($l, '"message"\s*:\s*"((?:[^"\\]|\\.)*)"')
    if ($mm.Success) { $msg = $mm.Groups[1].Value }
    # 如果是 TOOL-CALL/TOOL-RESULT，提取工具名和参数
    $tool = ''
    $tn = [regex]::Match($l, '"tool"\s*:\s*"([^"]+)"')
    if ($tn.Success) { $tool = $tn.Groups[1].Value }
    if (-not $tool) {
      $tn2 = [regex]::Match($l, '"toolName"\s*:\s*"([^"]+)"')
      if ($tn2.Success) { $tool = $tn2.Groups[1].Value }
    }
    $args = ''
    $am2 = [regex]::Match($l, '"args"\s*:\s*(\{[^}]+\})')
    if ($am2.Success) { $args = $am2.Groups[1].Value }
    Write-Host ("  [{0}] {1} {2} {3} tool={4} args={5} msg={6}" -f $ts, $ag, $tag, $j, $tool, $args, $msg)
  }
}

Write-Host ""
Write-Host "=== ReAct loop: 3 consecutive tool failures ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -notmatch '3 consecutive tool failures') { continue }
  $l = $lines[$i]
  $ts = ''
  $tm = [regex]::Match($l, '"timestamp"\s*:\s*"([^"]+)"')
  if ($tm.Success) { $ts = $tm.Groups[1].Value }
  $ag = ''
  $am = [regex]::Match($l, '"agent"\s*:\s*"([^"]+)"')
  if ($am.Success) { $ag = $am.Groups[1].Value }
  Write-Host "  line $i $ts agent=$ag"
  # 看附近 30 行
  $start = [Math]::Max(0, $i - 5)
  $end = [Math]::Min($lines.Count - 1, $i + 5)
  for ($j = $start; $j -le $end; $j++) {
    $l2 = $lines[$j]
    $ts2 = ''
    $tm2 = [regex]::Match($l2, '"timestamp"\s*:\s*"([^"]+)"')
    if ($tm2.Success) { $ts2 = $tm2.Groups[1].Value }
    $tag2 = ''
    $tg2 = [regex]::Match($l2, '"tag"\s*:\s*"([^"]+)"')
    if ($tg2.Success) { $tag2 = $tg2.Groups[1].Value }
    $msg2 = ''
    $mm2 = [regex]::Match($l2, '"message"\s*:\s*"((?:[^"\\]|\\.)*)"')
    if ($mm2.Success) { $msg2 = $mm2.Groups[1].Value }
    if ($msg2.Length -gt 150) { $msg2 = $msg2.Substring(0, 150) + '...' }
    Write-Host ("    [{0}] {1} {2}" -f $ts2, $tag2, $msg2)
  }
}

Write-Host ""
Write-Host "=== Failed to add item from pool ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -notmatch 'Failed to add item from pool') { continue }
  $l = $lines[$i]
  $ts = ''
  $tm = [regex]::Match($l, '"timestamp"\s*:\s*"([^"]+)"')
  if ($tm.Success) { $ts = $tm.Groups[1].Value }
  $ag = ''
  $am = [regex]::Match($l, '"agent"\s*:\s*"([^"]+)"')
  if ($am.Success) { $ag = $am.Groups[1].Value }
  $msg = ''
  $mm = [regex]::Match($l, '"message"\s*:\s*"((?:[^"\\]|\\.)*)"')
  if ($mm.Success) { $msg = $mm.Groups[1].Value }
  Write-Host ("  line {0} {1} agent={2} msg={3}" -f $i, $ts, $ag, $msg)
  # 看附近内容
  $start = [Math]::Max(0, $i - 1)
  $end = [Math]::Min($lines.Count - 1, $i + 3)
  for ($j = $start; $j -le $end; $j++) {
    $l2 = $lines[$j]
    # 找 itemId / templateId / 等关键字
    $m = [regex]::Match($l2, '"(itemId|templateId|category|itemCategory|slot)"\s*:\s*"([^"]*)"')
    if ($m.Success) {
      Write-Host ("    line {0}: {1}={2}" -f $j, $m.Groups[1].Value, $m.Groups[2].Value)
    }
  }
}
