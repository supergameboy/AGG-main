#Requires -Version 7.0
<#
.SYNOPSIS
    AGG 日志阅读器 — 结构化日志的过滤、查看和实时跟踪工具

.DESCRIPTION
    读取 JSON 格式的日志文件，支持按 requestId/agent/tag/iteration/时间范围过滤，
    输出人类可读的彩色终端格式或 JSON 格式（供 AI 消费）。

.EXAMPLE
    pwsh -File scripts/log-reader.ps1 -RequestId "req_abc123"
    pwsh -File scripts/log-reader.ps1 -Agent "gamemaster" -Tag "TOOL-CALL"
    pwsh -File scripts/log-reader.ps1 -RequestId "req_abc123" -Iteration 3
    pwsh -File scripts/log-reader.ps1 -Tail -Agent "gamemaster"
    pwsh -File scripts/log-reader.ps1 -RequestId "req_abc123" -Format json
#>

param(
    [string]$RequestId,
    [string]$Agent,
    [string]$Tag,
    [int]$Iteration,
    [datetime]$From,
    [datetime]$To,
    [switch]$Tail,
    [ValidateSet('human', 'json')]
    [string]$Format = 'human',
    [string]$LogDir,
    [ValidateSet('session', 'ai', 'agent', 'system', 'error', 'frontend')]
    [string[]]$Sources = @('session', 'ai', 'agent'),
    [int]$Limit = 500
)

# ─── 日志目录 ──────────────────────────────────────────────────────
if (-not $LogDir) {
    $LogDir = Join-Path $PSScriptRoot '..' 'game_data' 'logs'
}
if (-not (Test-Path $LogDir)) {
    Write-Host "日志目录不存在: $LogDir" -ForegroundColor Red
    exit 1
}

# ─── 颜色映射 ──────────────────────────────────────────────────────
$TagColors = @{
    'AGENT-START'     = 'Green'
    'AGENT-END'       = 'DarkGreen'
    'LLM-INPUT'       = 'Cyan'
    'LLM-OUTPUT'      = 'DarkCyan'
    'LLM-REQUEST'     = 'DarkCyan'
    'LLM-RESPONSE'    = 'DarkCyan'
    'TOOL-CALL'       = 'Yellow'
    'TOOL-RESULT'     = 'DarkYellow'
    'CONTEXT-INJECT'  = 'Magenta'
    'CONTEXT-DELTA'   = 'DarkMagenta'
    'REACT-ITER'      = 'Blue'
    'REACT-DELTA'     = 'DarkBlue'
}

$LevelColors = @{
    'error' = 'Red'
    'warn'  = 'Yellow'
    'info'  = 'White'
    'debug' = 'DarkGray'
}

# ─── 获取日志文件 ──────────────────────────────────────────────────
function Get-LogFiles {
    $files = @()
    foreach ($src in $Sources) {
        if ($src -eq 'session') {
            $f = Join-Path $LogDir 'session.log'
            if (Test-Path $f) { $files += $f }
        } else {
            $pattern = "${src}-*.log"
            $found = Get-ChildItem -Path $LogDir -Filter $pattern -ErrorAction SilentlyContinue
            if ($found) {
                # 取最新的文件
                $latest = $found | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                $files += $latest.FullName
            }
        }
    }
    return $files
}

# ─── 解析日志行 ────────────────────────────────────────────────────
function Parse-LogLine {
    param([string]$Line)
    if ($Line.Trim() -eq '') { return $null }
    try {
        $obj = $Line | ConvertFrom-Json -Depth 20 -ErrorAction Stop
        return $obj
    } catch {
        return $null
    }
}

# ─── 过滤日志 ──────────────────────────────────────────────────────
function Test-LogFilter {
    param([PSCustomObject]$Entry)
    if ($RequestId -and -not ($Entry.requestId -like "$RequestId*")) { return $false }
    if ($Agent -and $Entry.data.agent -ne $Agent -and $Entry.agent -ne $Agent) { return $false }
    if ($Tag -and $Entry.tag -ne $Tag) { return $false }
    if ($Iteration -and $Entry.iteration -ne $Iteration) { return $false }
    if ($From) {
        $ts = [datetime]$Entry.timestamp
        if ($ts -lt $From) { return $false }
    }
    if ($To) {
        $ts = [datetime]$Entry.timestamp
        if ($ts -gt $To) { return $false }
    }
    return $true
}

# ─── 人类可读格式输出 ──────────────────────────────────────────────
function Write-HumanEntry {
    param([PSCustomObject]$Entry)

    $time = ''
    if ($Entry.timestamp) {
        try {
            $dt = [datetime]$Entry.timestamp
            $time = $dt.ToString('HH:mm:ss.fff')
        } catch {
            $time = $Entry.timestamp
        }
    }

    $tag = if ($Entry.tag) { "[$($Entry.tag)]" } else { '' }
    $agent = ''
    if ($Entry.data.agent) { $agent = $Entry.data.agent }
    elseif ($Entry.agent) { $agent = $Entry.agent }

    $iterStr = if ($Entry.iteration) { " iter=$($Entry.iteration)" } else { '' }
    $reqStr = if ($Entry.requestId) { " $($Entry.requestId.Substring(0, [Math]::Min(8, $Entry.requestId.Length)))" } else { '' }

    # 主行
    $tagColor = if ($Entry.tag -and $TagColors[$Entry.tag]) { $TagColors[$Entry.tag] } else { 'White' }
    $levelColor = if ($Entry.level -and $LevelColors[$Entry.level]) { $LevelColors[$Entry.level] } else { 'White' }

    Write-Host -NoNewline "$time "
    Write-Host -NoNewline $tag -ForegroundColor $tagColor
    Write-Host -NoNewline " $($Entry.message)$iterStr$reqStr" -ForegroundColor $levelColor
    if ($agent) {
        Write-Host -NoNewline " ($agent)" -ForegroundColor DarkGray
    }
    Write-Host ''

    # 详情行
    $data = $Entry.data
    if ($data) {
        switch ($Entry.tag) {
            'AGENT-START' {
                Write-Host "    action=$($data.action) intentHint=$($data.intentHint) model=$($data.model)" -ForegroundColor DarkGray
            }
            'AGENT-END' {
                Write-Host "    iterations=$($data.iterations) tokens=$($data.totalTokens) elapsed=$($data.elapsed)ms success=$($data.success)" -ForegroundColor DarkGray
            }
            'LLM-INPUT' {
                $msgCount = if ($data.cumulativeMessages) { $data.cumulativeMessages } else { '(?)' }
                $delta = if ($data.deltaMessages) { " +$($data.deltaMessages.Count) delta" } else { '' }
                Write-Host "    messages=$msgCount tools=$($data.toolsCount)$delta model=$($data.model)" -ForegroundColor DarkGray
            }
            'LLM-OUTPUT' {
                $tokens = if ($data.usage.totalTokens) { $data.usage.totalTokens } else { '?' }
                Write-Host "    tokens=$tokens elapsed=$($data.elapsed)ms finishReason=$($data.finishReason)" -ForegroundColor DarkGray
                if ($data.toolCalls -and $data.toolCalls.Count -gt 0) {
                    $names = ($data.toolCalls | ForEach-Object { $_.name }) -join ', '
                    Write-Host "    tool_calls: $names" -ForegroundColor DarkGray
                }
            }
            'LLM-REQUEST' {
                Write-Host "    provider=$($data.provider)/$($data.model) messages=$($data.messageCount)" -ForegroundColor DarkGray
            }
            'LLM-RESPONSE' {
                Write-Host "    provider=$($data.provider)/$($data.model) finishReason=$($data.finishReason)" -ForegroundColor DarkGray
            }
            'TOOL-CALL' {
                $argsStr = if ($data.args) { ($data.args.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' ' } else { '' }
                Write-Host "    $($data.toolType).$($data.method) $argsStr" -ForegroundColor DarkGray
            }
            'TOOL-RESULT' {
                $sizeStr = if ($data.originalSize -and $data.compressedSize) { " ($($data.originalSize)->$($data.compressedSize) bytes)" } else { '' }
                $preStr = if ($data.isPreExecuted) { ' [PRE-EXEC]' } else { '' }
                Write-Host "    $($data.toolType).$($data.method) -> $($data.success)$sizeStr$preStr" -ForegroundColor DarkGray
            }
            'CONTEXT-INJECT' {
                Write-Host "    $($data.injectedRules.Count) rules injected, $($data.totalTokens)/$($data.maxTokens) tokens" -ForegroundColor DarkGray
                if ($data.injectedRules) {
                    foreach ($rule in $data.injectedRules) {
                        Write-Host "    -> $($rule.ruleId) ($($rule.source), $($rule.recordCount) records, $($rule.estimatedTokens) tokens)" -ForegroundColor DarkGray
                    }
                }
            }
            'CONTEXT-DELTA' {
                $added = if ($data.addedRules) { "+$($data.addedRules.Count)" } else { '+0' }
                $removed = if ($data.removedRules) { "-$($data.removedRules.Count)" } else { '-0' }
                Write-Host "    delta: $added added, $removed removed, total=$($data.totalInjectedRules) rules" -ForegroundColor DarkGray
            }
            'REACT-ITER' {
                Write-Host "    iteration $($data.currentIteration)/$($data.maxIterations) messages=$($data.cumulativeMessages)" -ForegroundColor DarkGray
            }
            'REACT-DELTA' {
                if ($data.deltaMessages) {
                    foreach ($dm in $data.deltaMessages) {
                        $flags = @()
                        if ($dm.isPreExecuted) { $flags += 'PRE-EXEC' }
                        $flagStr = if ($flags) { " [$($flags -join ',')]" } else { '' }
                        $contentPreview = if ($dm.content) { $dm.content.Substring(0, [Math]::Min(80, $dm.content.Length)) } else { '(no content)' }
                        Write-Host "    $($dm.role)$flagStr`: $contentPreview..." -ForegroundColor DarkGray
                    }
                }
            }
        }
    }
}

# ─── 主逻辑 ────────────────────────────────────────────────────────
$files = Get-LogFiles
if ($files.Count -eq 0) {
    Write-Host "未找到日志文件 (sources: $($Sources -join ', '))" -ForegroundColor Yellow
    exit 0
}

$count = 0

if ($Tail) {
    # 实时跟踪模式
    $latestFile = $files | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1
    Write-Host "实时跟踪: $latestFile" -ForegroundColor Cyan
    Write-Host "按 Ctrl+C 退出" -ForegroundColor DarkGray
    Write-Host ''

    Get-Content -Path $latestFile -Wait -Tail 50 | ForEach-Object {
        $entry = Parse-LogLine $_
        if ($entry -and (Test-LogFilter $entry)) {
            if ($Format -eq 'json') {
                $_
            } else {
                Write-HumanEntry $entry
            }
        }
    }
} else {
    # 批量读取模式
    foreach ($file in $files) {
        Get-Content -Path $file -ErrorAction SilentlyContinue | ForEach-Object {
            if ($count -ge $Limit) { return }

            $entry = Parse-LogLine $_
            if ($entry -and (Test-LogFilter $entry)) {
                $count++
                if ($Format -eq 'json') {
                    $_
                } else {
                    Write-HumanEntry $entry
                }
            }
        }
    }

    if ($count -eq 0) {
        Write-Host "未找到匹配的日志条目" -ForegroundColor Yellow
    } elseif ($Format -eq 'human') {
        Write-Host ""
        Write-Host "共 $count 条匹配" -ForegroundColor DarkGray
    }
}
