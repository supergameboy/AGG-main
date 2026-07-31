#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\ai-2026-07-06.log'
$lines = Get-Content $logPath -Encoding UTF8

# 找 gamemaster 第一次 LLM 调用，看 systemPrompt 中是否含 game-initialization
Write-Host "=== Search ai-log for gamemaster systemPrompt with game-initialization ==="
$found = 0
for ($i = 0; $i -lt $lines.Count -and $found -lt 1; $i++) {
  $line = $lines[$i]
  if ($line -match 'gamemaster' -and $line -match 'system') {
    # 找 systemPrompt 中 available_skills
    if ($line -match 'available_skills') {
      Write-Host "Found available_skills in line $i"
      # 提取 available_skills 段落
      $startIdx = $line.IndexOf('<available_skills>')
      $endIdx = $line.IndexOf('</available_skills>')
      Write-Host "start=$startIdx end=$endIdx lineLength=$($line.Length)"
      if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
        $block = $line.Substring($startIdx, [Math]::Min($endIdx - $startIdx + 25, 3000))
        Write-Host "--- available_skills block ---"
        Write-Host $block
      }
      $found++
    }
  }
}

if ($found -eq 0) {
  Write-Host "available_skills NOT FOUND in any gamemaster log line"
  Write-Host ""
  Write-Host "=== Search for 'game-initialization' in entire ai log ==="
  $count = 0
  for ($i = 0; $i -lt $lines.Count -and $count -lt 5; $i++) {
    if ($lines[$i] -match 'game-initialization') {
      Write-Host "Line $i contains 'game-initialization'"
      $count++
    }
  }
  Write-Host "Total lines containing 'game-initialization': $count"
}

# 在 session.log 中也查找
Write-Host ""
Write-Host "=== session.log: search 'game-initialization' ==="
$sessLog = Get-Content 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log' -Encoding UTF8
$sessCount = 0
$sessCount = ($sessLog | Where-Object { $_ -match 'game-initialization' }).Count
Write-Host "session.log lines containing 'game-initialization': $sessCount"

# 找包含 game-initialization 的行，看上下文
Write-Host ""
Write-Host "=== sample lines with game-initialization ==="
$sessLog | Where-Object { $_ -match 'game-initialization' } | Select-Object -First 5 | ForEach-Object {
  $len = $_.Length
  $snippet = if ($len -gt 300) { $_.Substring(0, 300) + '...' } else { $_ }
  Write-Host "[$len chars] $snippet"
}
