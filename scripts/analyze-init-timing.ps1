#Requires -Version 7.0
<#
.SYNOPSIS
    Analyze game initialization timing from logs.
.DESCRIPTION
    Extracts LLM call durations, tool call counts, and timeline from session.log and ai-*.log.
#>

param(
    [string]$LogDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs"
)

$ErrorActionPreference = 'Stop'

$sessionLog = Join-Path $LogDir "session.log"
$aiLog = Get-ChildItem -Path $LogDir -Filter "ai-*.log" | Select-Object -First 1 -ExpandProperty FullName
$agentLog = Join-Path $LogDir "agent-2026-07-04.log"

Write-Host "=== Log files ==="
Write-Host "Session: $sessionLog"
Write-Host "AI: $aiLog"
Write-Host "Agent: $agentLog"
Write-Host ""

# Parse session.log entries
$sessionEntries = Get-Content $sessionLog | ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
} | Where-Object { $_ -ne $null }

Write-Host "=== Session timeline ==="
Write-Host ("Total entries: {0}" -f $sessionEntries.Count)
Write-Host ("First timestamp: {0}" -f $sessionEntries[0].timestamp)
Write-Host ("Last timestamp:  {0}" -f $sessionEntries[-1].timestamp)
Write-Host ""

# Find initialization start/end markers
$initStart = $sessionEntries | Where-Object { $_.message -like "*Initializing AI-generated Games*" } | Select-Object -First 1
$firstGame = $sessionEntries | Where-Object { $_.message -like "*POST /api/v1/game*" -or $_.message -like "*POST / 201*" } | Select-Object -First 1
Write-Host "=== Init markers ==="
if ($initStart) { Write-Host ("Backend start: {0}" -f $initStart.timestamp) }
if ($firstGame) { Write-Host ("First POST /: {0}" -f $firstGame.timestamp) }
Write-Host ""

# Parse AI log entries
$aiEntries = Get-Content $aiLog | ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
} | Where-Object { $_ -ne $null }

Write-Host "=== AI log stats ==="
Write-Host ("Total entries: {0}" -f $aiEntries.Count)
Write-Host ""

# Extract LLM calls with duration
$llmCalls = $aiEntries | Where-Object { $_.message -eq "LLM API call completed" -and $_.data.duration }
Write-Host "=== LLM call summary ==="
Write-Host ("Total LLM calls: {0}" -f $llmCalls.Count)
if ($llmCalls.Count -gt 0) {
    $durations = $llmCalls | ForEach-Object { [int]$_.data.duration }
    $tokens = $llmCalls | ForEach-Object { [int]$_.data.tokens.totalTokens }
    Write-Host ("Total LLM time: {0} ms ({1:N2} sec)" -f ($durations | Measure-Object -Sum).Sum, (($durations | Measure-Object -Sum).Sum / 1000))
    Write-Host ("Avg duration:   {0:N0} ms" -f (($durations | Measure-Object -Average).Average))
    Write-Host ("Max duration:   {0} ms" -f (($durations | Measure-Object -Maximum).Maximum))
    Write-Host ("Min duration:   {0} ms" -f (($durations | Measure-Object -Minimum).Minimum))
    Write-Host ("Total tokens:   {0}" -f ($tokens | Measure-Object -Sum).Sum)
    Write-Host ""
    Write-Host "=== Top 10 slowest LLM calls ==="
    $llmCalls | Sort-Object { [int]$_.data.duration } -Descending | Select-Object -First 10 | ForEach-Object {
        Write-Host ("  [{0}] {1,6} ms  tokens={2}  model={3}  finish={4}" -f $_.timestamp, $_.data.duration, $_.data.tokens.totalTokens, $_.data.model, $_.data.finishReason)
    }
    Write-Host ""
    Write-Host "=== All LLM calls timeline ==="
    $llmCalls | ForEach-Object {
        Write-Host ("  [{0}] {1,6} ms  in={2}  out={3}  cache={4}  finish={5}" -f $_.timestamp, $_.data.duration, $_.data.tokens.promptTokens, $_.data.tokens.completionTokens, $_.data.tokens.promptCacheHitTokens, $_.data.finishReason)
    }
}
Write-Host ""

# Extract tool calls from session.log
$toolCalls = $sessionEntries | Where-Object { $_.message -eq "Tool call" -and $_.data.toolType -and $_.data.method }
Write-Host "=== Tool call summary ==="
Write-Host ("Total tool calls: {0}" -f $toolCalls.Count)
Write-Host ""
Write-Host "=== Tool calls by method ==="
$toolCalls | Group-Object { "$($_.data.toolType).$($_.data.method)" } | Sort-Object Count -Descending | ForEach-Object {
    Write-Host ("  {0,3}x  {1}" -f $_.Count, $_.Name)
}
Write-Host ""
Write-Host "=== Tool call timeline ==="
$toolCalls | ForEach-Object {
    Write-Host ("  [{0}] {1}.{2}  agent={3}  iter={4}" -f $_.timestamp, $_.data.toolType, $_.data.method, $_.data.agent, $_.data.iteration)
}
Write-Host ""

# Extract ReAct iterations
$reactIter = $sessionEntries | Where-Object { $_.message -like "ReAct iteration*" }
Write-Host "=== ReAct iterations ==="
Write-Host ("Total iterations: {0}" -f $reactIter.Count)
Write-Host ("Max iteration:    {0}" -f (($reactIter | ForEach-Object { $_.data.currentIteration } | Measure-Object -Maximum).Maximum))
Write-Host ""

# Extract agent starts
$agentStarts = $sessionEntries | Where-Object { $_.message -eq "Agent gamemaster starting" }
Write-Host "=== GameMaster agent start events ==="
$agentStarts | ForEach-Object {
    Write-Host ("  [{0}] gamemaster start" -f $_.timestamp)
}
Write-Host ""

# LLM input/output pairs to compute inter-call gaps
Write-Host "=== LLM iteration intervals (gap between LLM output and next LLM input) ==="
$llmOutputs = $aiEntries | Where-Object { $_.tag -eq "LLM-OUTPUT" }
$llmInputs = $aiEntries | Where-Object { $_.tag -eq "LLM-INPUT" }
for ($i = 0; $i -lt $llmOutputs.Count; $i++) {
    $out = $llmOutputs[$i]
    if ($i + 1 -lt $llmInputs.Count) {
        $nextIn = $aiEntries | Where-Object { $_.timestamp -gt $out.timestamp -and $_.tag -eq "LLM-INPUT" } | Select-Object -First 1
        if ($nextIn) {
            $gap = [DateTime]::Parse($nextIn.timestamp) - [DateTime]::Parse($out.timestamp)
            Write-Host ("  iter {0}  out@{1}  next-in@{2}  gap={3}s" -f $out.iteration, $out.timestamp, $nextIn.timestamp, [int]$gap.TotalSeconds)
        }
    }
}
