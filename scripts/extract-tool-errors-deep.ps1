#Requires -Version 7.0
<#
.SYNOPSIS
  深度分析 session.log，提取 LLM 运行时工具错误的详细信息及其上下文
#>
param(
  [string]$LogPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
)

$content = Get-Content $LogPath -Raw
$lines = $content -split "`n"

Write-Host "=== 1. 所有 success:false 的工具调用（带完整错误信息）===" -ForegroundColor Yellow

for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match 'Method execution completed:.*"success":false') {
    # 提取 toolType 和 method
    $toolType = ''; $methodName = ''
    if ($line -match '"toolType":"([^"]+)"') { $toolType = $Matches[1] }
    if ($line -match '"method":"([^"]+)"') { $methodName = $Matches[1] }
    
    # 提取 error
    $errorMsg = ''
    if ($line -match '"error":"((?:[^"\\]|\\.)*)"') {
      $errorMsg = $Matches[1] -replace '\\"','"'
    }
    
    # 往前找 LLM 的原始 tool call 参数
    $llmArgs = ''
    for ($j = [Math]::Max(0, $i - 15); $j -lt $i; $j++) {
      if ($lines[$j] -match '\[LLM-OUTPUT\]' -and $lines[$j] -match "function.*name.*${toolType}__${methodName}") {
        # 尝试从 LLM-OUTPUT 中提取 arguments
        if ($lines[$j] -match '"arguments":"((?:[^"\\]|\\.)*)"') {
          $llmArgs = $Matches[1] -replace '\\\\','\' -replace '\\"','"'
          break
        }
      }
    }
    
    Write-Host "`n  L$($i+1): ${toolType}__${methodName}" -ForegroundColor Red
    Write-Host "    错误: $errorMsg" -ForegroundColor DarkYellow
    if ($llmArgs) {
      # 截断过长的参数
      if ($llmArgs.Length -gt 300) { $llmArgs = $llmArgs.Substring(0, 300) + '...' }
      Write-Host "    LLM参数: $llmArgs" -ForegroundColor Cyan
    }
  }
}

Write-Host "`n=== 2. LLM 每轮次的行为摘要 ===" -ForegroundColor Yellow
$llmOutLines = $lines | Select-String '\[LLM-OUTPUT\].*agent=gamemaster'
$iterCount = 0
$totalTokens = 0
foreach ($lo in $llmOutLines) {
  $iterCount++
  if ($lo.Line -match 'toolCalls=(\d+)') {
    $tc = [int]$Matches[1]
    if ($lo.Line -match 'tokens=(\d+)') {
      $totalTokens += [int]$Matches[1]
    }
    if ($tc -gt 0) {
      # 提取 function names
      $funcs = [regex]::Matches($lo.Line, '"name":"([^"]+__[^"]+)"')
      $funcNames = ($funcs | ForEach-Object { $_.Groups[1].Value }) -join ', '
      if ($funcNames.Length -gt 200) { $funcNames = $funcNames.Substring(0, 200) + '...' }
      Write-Host "  iter${iterCount}: toolCalls=$tc, tokens=$($Matches[1]) => $funcNames" -ForegroundColor Cyan
    } else {
      if ($lo.Line -match 'tokens=(\d+)') {
        Write-Host "  iter${iterCount}: noTool, tokens=$($Matches[1])" -ForegroundColor DarkGray
      }
    }
  }
}
Write-Host "`n  总迭代: $iterCount, 总 tokens: $totalTokens" -ForegroundColor Cyan

Write-Host "`n=== 3. spawn_agent 调用详情 ===" -ForegroundColor Yellow
$spawnCalls = $lines | Select-String 'spawn_agent\b' | Select-String -NotMatch '\[LLM-INPUT\]'
foreach ($sc in $spawnCalls) {
  $line = $sc.Line
  # 只关心 tool call 和 observation
  if ($line -match '\[LLM-OUTPUT\]' -or $line -match 'Executing tool call' -or $line -match 'Tool call parsed' -or $line -match 'Method execution completed') {
    if ($line.Length -gt 400) { $line = $line.Substring(0, 400) + '...' }
    Write-Host "  L$($sc.LineNumber): $line" -ForegroundColor DarkYellow
  }
}

Write-Host "`n=== 4. 子 Agent (npc_party/quest/inventory/skill/map) 的 toolsCount 与成功/失败 ===" -ForegroundColor Yellow
$subAgents = @('npc_party', 'quest', 'inventory', 'skill', 'map')
foreach ($sa in $subAgents) {
  $saInputs = $lines | Select-String "\[LLM-INPUT\].*agent=$sa"
  if ($saInputs) {
    $firstInput = $saInputs | Select-Object -First 1
    if ($firstInput.Line -match 'toolsCount":(\d+)') {
      $tc = [int]$Matches[1]
    } else { $tc = 0 }
    
    $saOutputs = $lines | Select-String "\[LLM-OUTPUT\].*agent=$sa"
    $saOutputCount = $saOutputs.Count
    
    $saExec = $lines | Select-String "Executing method.*agentType.*$sa"
    $saSuccess = ($saExec | Select-String '"success":true').Count
    $saFail = ($saExec | Select-String '"success":false').Count
    
    Write-Host "  $sa : toolsCount=$tc, LLMOUT=$saOutputCount, success=$saSuccess, fail=$saFail" -ForegroundColor $(if ($saFail -gt 0) { 'Red' } else { 'Green' })
  } else {
    Write-Host "  $sa : (无 LLM-INPUT)" -ForegroundColor DarkGray
  }
}
