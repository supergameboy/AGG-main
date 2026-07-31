#Requires -Version 7.0
<#
.SYNOPSIS
    Deep analysis of game initialization timing issues.
#>

$ErrorActionPreference = 'Stop'
$LogDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs"

$sessionLog = Join-Path $LogDir "session.log"
$aiLog = Get-ChildItem -Path $LogDir -Filter "ai-*.log" | Select-Object -First 1 -ExpandProperty FullName

# Parse all entries
$sessionEntries = Get-Content $sessionLog | ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
} | Where-Object { $_ -ne $null }

$aiEntries = Get-Content $aiLog | ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
} | Where-Object { $_ -ne $null }

Write-Host "=== TOOL CALLS ==="
$toolCalls = $sessionEntries | Where-Object { $_.tag -eq "TOOL-CALL" }
Write-Host ("Total tool calls: {0}" -f $toolCalls.Count)
Write-Host ""
Write-Host "=== Tool calls by agent ==="
$toolCalls | Group-Object { $_.data.agent } | Sort-Object Count -Descending | ForEach-Object {
    Write-Host ("  {0,3}x  agent={1}" -f $_.Count, $_.Name)
}
Write-Host ""
Write-Host "=== Tool calls by tool.method ==="
$toolCalls | Group-Object { "$($_.data.toolType).$($_.data.method)" } | Sort-Object Count -Descending | ForEach-Object {
    Write-Host ("  {0,3}x  {1}" -f $_.Count, $_.Name)
}
Write-Host ""
Write-Host "=== Tool call timeline (compact) ==="
$toolCalls | ForEach-Object {
    Write-Host ("  [{0}] {1}.{2}  agent={3} iter={4}" -f $_.timestamp, $_.data.toolType, $_.data.method, $_.data.agent, $_.data.iteration)
}
Write-Host ""

Write-Host "=== AGENT INVOCATIONS (re-starts of agents) ==="
$agentStarts = $sessionEntries | Where-Object { $_.tag -eq "AGENT-START" }
Write-Host ("Total AGENT-START events: {0}" -f $agentStarts.Count)
$agentStarts | ForEach-Object {
    Write-Host ("  [{0}] agent={1}  isSubAgent={2}  maxIter={3}  tools={4}" -f $_.timestamp, $_.data.agent, $_.data.isSubAgent, $_.data.maxIterations, $_.data.toolsConfigured)
}
Write-Host ""

Write-Host "=== LLM INPUT/OUTPUT AGENT BREAKDOWN ==="
$llmInputs = $aiEntries | Where-Object { $_.tag -eq "LLM-INPUT" }
$llmInputs | Group-Object { $_.data.agent } | Sort-Object Count -Descending | ForEach-Object {
    Write-Host ("  {0,3}x LLM-INPUT for agent={1}" -f $_.Count, $_.Name)
}
Write-Host ""

Write-Host "=== ITERATIONS PER AGENT ==="
$llmInputs | Group-Object { $_.data.agent } | ForEach-Object {
    $agent = $_.Name
    $maxIter = ($_.Group | ForEach-Object { $_.iteration } | Measure-Object -Maximum).Maximum
    Write-Host ("  agent={0}  total LLM calls={1}  max iteration reached={2}" -f $agent, $_.Count, $maxIter)
}
Write-Host ""

Write-Host "=== HIGH-TOKEN LLM INPUTS (>5000 prompt tokens) ==="
$bigInputs = $aiEntries | Where-Object { $_.tag -eq "LLM-OUTPUT" -and [int]$_.data.usage.promptTokens -gt 5000 }
$bigInputs | Sort-Object { [int]$_.data.usage.promptTokens } -Descending | ForEach-Object {
    Write-Host ("  [{0}] iter={1}  agent={2}  in={3}  out={4}  cache={5}  cache%={6:N1}%  elapsed={7}ms" -f $_.timestamp, $_.iteration, $_.data.agent, $_.data.usage.promptTokens, $_.data.usage.completionTokens, $_.data.usage.promptCacheHitTokens, (100 * [int]$_.data.usage.promptCacheHitTokens / [int]$_.data.usage.promptTokens), $_.data.elapsed)
}
Write-Host ""

Write-Host "=== LOW CACHE-HIT RATIO CALLS (<50% of prompt cached, prompt>1000) ==="
$lowCache = $aiEntries | Where-Object { $_.tag -eq "LLM-OUTPUT" -and [int]$_.data.usage.promptTokens -gt 1000 -and (100 * [int]$_.data.usage.promptCacheHitTokens / [int]$_.data.usage.promptTokens) -lt 50 }
$lowCache | ForEach-Object {
    Write-Host ("  [{0}] iter={1}  agent={2}  in={3}  cache={4}  cache%={5:N1}%" -f $_.timestamp, $_.iteration, $_.data.agent, $_.data.usage.promptTokens, $_.data.usage.promptCacheHitTokens, (100 * [int]$_.data.usage.promptCacheHitTokens / [int]$_.data.usage.promptTokens))
}
Write-Host ""

Write-Host "=== TOOL RESULTS (ERRORS/LARGE) ==="
$toolResults = $sessionEntries | Where-Object { $_.tag -eq "TOOL-RESULT" -or $_.message -like "*Tool result*" }
Write-Host ("Total tool results: {0}" -f $toolResults.Count)
$toolResults | Select-Object -First 20 | ForEach-Object {
    Write-Host ("  [{0}] {1}" -f $_.timestamp, $_.message)
}
Write-Host ""

Write-Host "=== CONTEXT-INJECT EVENTS ==="
$ctxInject = $sessionEntries | Where-Object { $_.tag -eq "CONTEXT-INJECT" }
$ctxInject | ForEach-Object {
    Write-Host ("  [{0}] agent={1}  rules={2}  tokens={3}  skipped={4}" -f $_.timestamp, $_.data.agent, ($_.data.injectedRules | Measure-Object).Count, $_.data.totalTokens, ($_.data.skippedRules -join ','))
}
Write-Host ""

Write-Host "=== DECISION LOGS ==="
$decisions = $sessionEntries | Where-Object { $_.source -like "*decision*" -or $_.message -like "*decision*" }
$decisions | Select-Object -First 10 | ForEach-Object {
    Write-Host ("  [{0}] {1}" -f $_.timestamp, $_.message)
}
Write-Host ""

Write-Host "=== WAIT/ASYNC EVENTS ==="
$waitEvents = $sessionEntries | Where-Object { $_.message -like "*waiting*" -or $_.message -like "*queue*" -or $_.message -like "*pending*" }
$waitEvents | Select-Object -First 10 | ForEach-Object {
    Write-Host ("  [{0}] {1}" -f $_.timestamp, $_.message)
}
