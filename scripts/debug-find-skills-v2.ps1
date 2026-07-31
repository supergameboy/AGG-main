#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 直接在原文中找 gamemaster 的 LLM-INPUT 行（按整行扫描），不依赖 JSON 解析
Write-Host "=== scanning session.log for gamemaster LLM-INPUT with available_skills ==="
$found = 0
$maxFind = 3
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -notmatch '"tag":"LLM-INPUT"') { continue }
  if ($line -notmatch '"agent":"gamemaster"') { continue }
  # 用 \d+ 取 iteration 数，再判断
  $m = [regex]::Match($line, '"iteration"\s*:\s*(\d+)')
  if (-not $m.Success) { continue }
  $iter = [int]$m.Groups[1].Value
  if ($iter -ne 1) { continue }

  $found++
  Write-Host ""
  Write-Host "=== LLM-INPUT line $i iteration=1 ==="
  Write-Host "line length: $($line.Length)"

  # 直接在原文里搜 available_skills
  $startIdx = $line.IndexOf('<available_skills>')
  $endIdx = $line.IndexOf('</available_skills>')
  Write-Host "available_skills startIdx=$startIdx endIdx=$endIdx"

  if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
    $block = $line.Substring($startIdx, $endIdx - $startIdx + '</available_skills>'.Length)
    Write-Host "=== available_skills block ($($block.Length) chars) ==="
    $chunkSize = 2000
    for ($c = 0; $c -lt $block.Length; $c += $chunkSize) {
      $end = [Math]::Min($c + $chunkSize, $block.Length)
      Write-Host $line.Substring($startIdx + $c, $end - $c)
    }
  } else {
    Write-Host "available_skills NOT in this LLM-INPUT line"
    # 看是否含 skill 关键字
    $skillIdx = $line.IndexOf('skill')
    Write-Host "first 'skill' keyword at: $skillIdx"
    if ($skillIdx -ge 0) {
      $start = [Math]::Max(0, $skillIdx - 80)
      $len = [Math]::Min(400, $line.Length - $start)
      Write-Host "snippet: $($line.Substring($start, $len))"
    }
    # 看 intentHint
    $hintIdx = $line.IndexOf('intentHint')
    Write-Host "first 'intentHint' keyword at: $hintIdx"
    if ($hintIdx -ge 0) {
      $start = [Math]::Max(0, $hintIdx - 50)
      $len = [Math]::Min(300, $line.Length - $start)
      Write-Host "snippet: $($line.Substring($start, $len))"
    }
  }

  if ($found -ge $maxFind) { break }
}

if ($found -eq 0) {
  Write-Host "NO gamemaster LLM-INPUT iteration=1 found"
  # 退而求其次：列出所有 LLM-INPUT 的 iteration 值
  Write-Host ""
  Write-Host "=== all gamemaster LLM-INPUT iterations ==="
  $iterSet = @{}
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -notmatch '"tag":"LLM-INPUT"') { continue }
    if ($line -notmatch '"agent":"gamemaster"') { continue }
    $m = [regex]::Match($line, '"iteration"\s*:\s*(\d+)')
    if ($m.Success) { $iterSet[[int]$m.Groups[1].Value] = $true }
  }
  $iters = $iterSet.Keys | Sort-Object
  Write-Host "iterations: $($iters -join ',')"
}
