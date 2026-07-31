#Requires -Version 7.0
<#
.SYNOPSIS
  从 session.log 中提取 LLM 运行时工具错误（success:false 的工具调用）
#>
param(
  [string]$LogPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
)

$content = Get-Content $LogPath -Raw
$lines = $content -split "`n"

Write-Host "=== 1. 工具调用被拒绝 (Tool call rejected) ===" -ForegroundColor Yellow
$rejected = $lines | Select-String 'Tool call rejected'
if ($rejected) {
  foreach ($r in $rejected) {
    $line = $r.Line
    if ($line -match 'functionName":"([^"]+)".*allowedCount":(\d+)') {
      Write-Host "  $($Matches[1]) (allowedCount: $($Matches[2]))" -ForegroundColor Red
    }
  }
} else {
  Write-Host "  (无)" -ForegroundColor Green
}

Write-Host "`n=== 2. 工具执行返回 success:false (LLM运行时错误) ===" -ForegroundColor Yellow
$toolFailures = [System.Collections.ArrayList]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match 'Method execution completed:.*"success":false') {
    # 找上下文：前一行有 toolType/method 名字
    $prevLine = if ($i -gt 0) { $lines[$i - 1] } else { '' }
    $toolName = ''
    if ($prevLine -match 'Executing method: (\w+) on tool: (\w+)') {
      $toolName = "$($Matches[2])__$($Matches[1])"
    }
    
    # 提取错误信息
    $errorMsg = ''
    if ($line -match '"error":"([^"]+)"') {
      $errorMsg = $Matches[1]
    } elseif ($line -match 'error":"([^"\\]*(?:\\.[^"\\]*)*)"') {
      $errorMsg = $Matches[1]
    }
    
    [void]$toolFailures.Add(@{
      ToolName = $toolName
      Error = $errorMsg
      Line = $i + 1
    })
  }
}

if ($toolFailures.Count -eq 0) {
  Write-Host "  (无)" -ForegroundColor Green
} else {
  $grouped = $toolFailures | Group-Object -Property ToolName
  foreach ($g in $grouped) {
    $examples = $g.Group | Select-Object -First 3
    Write-Host "  $($g.Name) (出现 $($g.Count) 次):" -ForegroundColor Red
    foreach ($ex in $examples) {
      Write-Host "    L$($ex.Line): $($ex.Error)" -ForegroundColor DarkYellow
    }
  }
}

Write-Host "`n=== 3. spawn_agent / batch_spawn_agents 相关错误 ===" -ForegroundColor Yellow
$spawnErrors = $lines | Select-String 'Invalid function name format|spawn_age.*error|spawn.*fail'
if ($spawnErrors) {
  foreach ($e in $spawnErrors) {
    Write-Host "  L$($e.LineNumber): $($e.Line.Substring(0, [Math]::Min(200, $e.Line.Length)))" -ForegroundColor DarkYellow
  }
} else {
  Write-Host "  (无)" -ForegroundColor Green
}

Write-Host "`n=== 4. No locations / program error ===" -ForegroundColor Yellow
$noLocs = $lines | Select-String 'No locations|program error'
if ($noLocs) {
  foreach ($e in $noLocs) {
    Write-Host "  $($e.Line)" -ForegroundColor Red
  }
} else {
  Write-Host "  (无)" -ForegroundColor Green
}

Write-Host "`n=== 5. LLM-OUTPUT 中 toolCalls 但后续执行失败 ===" -ForegroundColor Yellow
$llmOutputs = $lines | Select-String '\[LLM-OUTPUT\].*toolCalls=(\d+)'
$toolCallCount = 0
foreach ($lo in $llmOutputs) {
  if ($lo.Line -match 'toolCalls=(\d+)') {
    $toolCallCount += [int]$Matches[1]
  }
}
Write-Host "  LLM 输出总 toolCalls 数: $toolCallCount" -ForegroundColor Cyan

Write-Host "`n=== 6. 错误/警告摘要 ===" -ForegroundColor Yellow
$errors = $lines | Select-String '\[error\]|\[Error\]'
$warns = $lines | Select-String '\[warn\]|\[Warn\]'
Write-Host "  总 [error] 条目: $($errors.Count)" -ForegroundColor Cyan
Write-Host "  总 [warn] 条目: $($warns.Count)" -ForegroundColor Cyan

Write-Host "`n=== 7. 工具成功/失败统计 ===" -ForegroundColor Yellow
$allExec = $lines | Select-String 'Method execution completed'
$successCount = ($allExec | Select-String '"success":true').Count
$failCount = ($allExec | Select-String '"success":false').Count
Write-Host "  工具执行成功: $successCount" -ForegroundColor Green
Write-Host "  工具执行失败: $failCount" -ForegroundColor Red
