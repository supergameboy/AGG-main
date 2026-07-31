#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 找第一条 gamemaster LLM-INPUT，完整打印 systemPrompt 中的 available_skills 段落
Write-Host "=== gamemaster systemPrompt available_skills (full) ==="
$found = 0
for ($i = 0; $i -lt $lines.Count -and $found -lt 1; $i++) {
  $line = $lines[$i]
  if ($line -match '"tag":"LLM-INPUT"' -and $line -match '"agent":"gamemaster"') {
    Write-Host "Found gamemaster LLM-INPUT at line $i"
    try {
      $o = $line | ConvertFrom-Json
      Write-Host ("messageCount: $($o.data.messages.Count)")
      $messages = $o.data.messages
      if ($messages) {
        foreach ($m in $messages) {
          if ($m.role -eq 'system') {
            $content = $m.content
            Write-Host "systemPrompt length: $($content.Length)"
            # 查找 available_skills
            $startIdx = $content.IndexOf('<available_skills>')
            $endIdx = $content.IndexOf('</available_skills>')
            Write-Host "available_skills start=$startIdx end=$endIdx"
            if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
              $skillsBlock = $content.Substring($startIdx, $endIdx - $startIdx + '</available_skills>'.Length)
              Write-Host "--- available_skills block ---"
              Write-Host $skillsBlock
            } else {
              Write-Host "available_skills block NOT FOUND in systemPrompt"
              # 看看有没有 skill 关键字
              $skillIdx = $content.IndexOf('skill')
              Write-Host "first 'skill' keyword at index: $skillIdx"
              if ($skillIdx -ge 0) {
                $snippet = $content.Substring([Math]::Max(0, $skillIdx - 50), [Math]::Min(300, $content.Length - $skillIdx + 50))
                Write-Host "snippet around 'skill': $snippet"
              }
            }
            # 看看 intentHint 相关
            $intentIdx = $content.IndexOf('intentHint')
            if ($intentIdx -ge 0) {
              Write-Host "intentHint found in systemPrompt at $intentIdx"
            }
          }
        }
      }
      $found++
    } catch {
      Write-Host "PARSE_FAIL at line $i"
    }
  }
}

# 同时看 LLM-INPUT 的 metadata（intentHint）
Write-Host ""
Write-Host "=== gamemaster LLM-INPUT metadata ==="
$foundMeta = 0
for ($i = 0; $i -lt $lines.Count -and $foundMeta -lt 3; $i++) {
  $line = $lines[$i]
  if ($line -match '"tag":"LLM-INPUT"' -and $line -match '"agent":"gamemaster"') {
    try {
      $o = $line | ConvertFrom-Json
      $ts = $o.timestamp
      $intentHint = $o.data.intentHint
      $action = $o.data.action
      Write-Host ("{0} | intentHint={1} | action={2}" -f $ts, $intentHint, $action)
      $foundMeta++
    } catch {}
  }
}
