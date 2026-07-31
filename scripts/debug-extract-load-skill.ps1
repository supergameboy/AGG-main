#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 提取所有 load_skill 的工具调用完整数据（含 params.skillName）
Write-Host "=== load_skill full params ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match 'load_skill' -and $line -match '"tag":"TOOL-CALL"') {
    try {
      $o = $line | ConvertFrom-Json
      $agent = $o.data.agent
      if (-not $agent) { continue }
      $params = $o.data.params
      $ts = $o.timestamp
      $paramsStr = if ($params) { ($params | ConvertTo-Json -Compress -Depth 5) } else { 'null' }
      Write-Host ("{0} | agent={1} | params={2}" -f $ts, $agent, $paramsStr)
    } catch {}
  }
}

# 提取 LLM-OUTPUT 中 gamemaster 的 tool_calls 字段（含 skillName）
Write-Host ""
Write-Host "=== gamemaster LLM-OUTPUT tool_calls (load_skill only) ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match '"tag":"LLM-OUTPUT"' -and $line -match '"agent":"gamemaster"' -and $line -match 'load_skill') {
    try {
      $o = $line | ConvertFrom-Json
      $ts = $o.timestamp
      $iter = $o.data.iteration
      # 提取 toolCalls 数组
      $toolCalls = $o.data.toolCalls
      if ($toolCalls) {
        foreach ($tc in $toolCalls) {
          if ($tc.function.name -match 'load_skill') {
            $argsStr = $tc.function.arguments
            Write-Host ("{0} | iter={1} | load_skill args={2}" -f $ts, $iter, $argsStr)
          }
        }
      }
    } catch {
      Write-Host "PARSE_FAIL at line $i"
    }
  }
}

# 提取 gamemaster systemPrompt 中 available_skills 部分
Write-Host ""
Write-Host "=== gamemaster systemPrompt available_skills (first occurrence) ==="
$found = $false
for ($i = 0; $i -lt $lines.Count -and -not $found; $i++) {
  $line = $lines[$i]
  if ($line -match '"tag":"LLM-INPUT"' -and $line -match '"agent":"gamemaster"') {
    try {
      $o = $line | ConvertFrom-Json
      $messages = $o.data.messages
      if ($messages) {
        foreach ($m in $messages) {
          if ($m.role -eq 'system' -and $m.content -match 'available_skills') {
            # 提取 available_skills 段落
            $content = $m.content
            $startIdx = $content.IndexOf('<available_skills>')
            $endIdx = $content.IndexOf('</available_skills>')
            if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
              $skillsBlock = $content.Substring($startIdx, $endIdx - $startIdx + '</available_skills>'.Length)
              Write-Host "First gamemaster LLM-INPUT systemPrompt available_skills:"
              Write-Host $skillsBlock
              $found = $true
              break
            }
          }
        }
      }
    } catch {
      Write-Host "PARSE_FAIL at line $i"
    }
  }
}

# 提取 gamemaster 全部 18 次迭代的时间戳和工具调用
Write-Host ""
Write-Host "=== gamemaster iteration timeline ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match '"tag":"LLM-OUTPUT"' -and $line -match '"agent":"gamemaster"') {
    try {
      $o = $line | ConvertFrom-Json
      $ts = $o.timestamp
      $iter = $o.data.iteration
      $tokens = $o.data.tokens
      $toolCalls = $o.data.toolCalls
      $toolNames = @()
      if ($toolCalls) {
        foreach ($tc in $toolCalls) {
          $toolNames += $tc.function.name
        }
      }
      $toolsStr = if ($toolNames.Count -gt 0) { $toolNames -join ', ' } else { '(no tool)' }
      Write-Host ("{0} | iter={1} | tokens={2} | tools={3}" -f $ts, $iter, $tokens, $toolsStr)
    } catch {}
  }
}
