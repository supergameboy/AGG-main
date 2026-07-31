#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 找第一条 gamemaster LLM-INPUT，提取完整 systemPrompt（可能很长，单独成行）
Write-Host "=== gamemaster first LLM-INPUT systemPrompt analysis ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match '"tag":"LLM-INPUT"' -and $line -match '"agent":"gamemaster"' -and $line -match 'iteration.*1') {
    Write-Host "Found first gamemaster LLM-INPUT at line $i, length=$($line.Length)"
    try {
      $o = $line | ConvertFrom-Json -Depth 100 -AsHashtable
      $messages = $o.data.messages
      if ($messages -is [System.Collections.ArrayList]) {
        $messages = [array]$messages
      }
      $messages = $o.data.messages
      if ($messages) {
        Write-Host "messages count: $($messages.Count)"
        foreach ($m in $messages) {
          $role = $m.role
          $contentLen = if ($m.content) { $m.content.Length } else { 0 }
          Write-Host "  role=$role contentLength=$contentLen"
          if ($role -eq 'system' -and $contentLen -gt 0) {
            $content = $m.content
            # 找 available_skills
            $startIdx = $content.IndexOf('<available_skills>')
            $endIdx = $content.IndexOf('</available_skills>')
            Write-Host "  available_skills: start=$startIdx end=$endIdx"
            if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
              $block = $content.Substring($startIdx, $endIdx - $startIdx + '</available_skills>'.Length)
              Write-Host "  === available_skills block ($($block.Length) chars) ==="
              # 分段打印避免截断
              $chunkSize = 1500
              for ($c = 0; $c -lt $block.Length; $c += $chunkSize) {
                $end = [Math]::Min($c + $chunkSize, $block.Length)
                Write-Host $block.Substring($c, $end - $c)
              }
            } else {
              Write-Host "  available_skills NOT in systemPrompt"
              # 看看是否含 'skill' 关键字
              $skillKeywordIdx = $content.IndexOf('skill')
              Write-Host "  first 'skill' keyword at: $skillKeywordIdx"
              if ($skillKeywordIdx -ge 0) {
                $start = [Math]::Max(0, $skillKeywordIdx - 100)
                $len = [Math]::Min(500, $content.Length - $start)
                Write-Host "  snippet: $($content.Substring($start, $len))"
              }
            }
          }
        }
      }
    } catch {
      Write-Host "PARSE_FAIL: $($_.Exception.Message)"
    }
    break
  }
}
