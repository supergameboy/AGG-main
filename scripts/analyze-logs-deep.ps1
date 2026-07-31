#Requires -Version 7.0
<#
.SYNOPSIS
  深度日志分析脚本 - 提取error/warn及LLM上下文中的问题
.DESCRIPTION
  分析备份日志目录中的所有日志文件，提取：
  1. error.log中的所有唯一错误（去重）
  2. session.log中的[warn]和[error]标记
  3. LLM上下文中的隐式error/warn（无外括号的）
  4. add_item调用详情（追踪NPC物品进入玩家背包）
  5. NPC创建/查询详情（追踪NPC重复问题）
  6. quest相关错误详情
#>

param(
    [string]$LogDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs copy",
    [string]$OutputDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs copy\analysis2"
)

if (!(Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

$ErrorLog = Join-Path $LogDir "error-2026-06-14.log"
$SessionLog = Join-Path $LogDir "session.log"
$AgentLog = Join-Path $LogDir "agent-2026-06-14.log"
$AiLog = Join-Path $LogDir "ai-2026-06-14.log"
$SystemLog = Join-Path $LogDir "system-2026-06-14.log.1"
$FrontendLog = Join-Path $LogDir "frontend-2026-06-14.log"

Write-Host "=== 深度日志分析 ===" -ForegroundColor Cyan
Write-Host "日志目录: $LogDir"
Write-Host "输出目录: $OutputDir"

# 1. error.log 去重分析
Write-Host "`n[1/6] 分析 error.log 去重..." -ForegroundColor Yellow
$errorLines = if (Test-Path $ErrorLog) { Get-Content $ErrorLog -ErrorAction SilentlyContinue } else { @() }
$errorGroups = @{}
$errorCount = 0
foreach ($line in $errorLines) {
    $errorCount++
    try {
        $obj = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($obj) {
            $key = "$($obj.message)|$($obj.source)|$(if($obj.error) { $obj.error.Substring(0, [Math]::Min(100, $obj.error.Length)) } else { 'no-error-field' })"
            if (!$errorGroups.ContainsKey($key)) { $errorGroups[$key] = @{ count = 0; first = $line; timestamps = @() } }
            $errorGroups[$key].count++
            $errorGroups[$key].timestamps += $obj.timestamp
        }
    } catch {}
}

$errorSummary = @()
foreach ($entry in $errorGroups.GetEnumerator()) {
    $obj = $entry.Value.first | ConvertFrom-Json
    $errorSummary += [PSCustomObject]@{
        Count = $entry.Value.count
        Message = $obj.message
        Source = $obj.source
        Error = if ($obj.error) { $obj.error.Substring(0, [Math]::Min(200, $obj.error.Length)) } else { "" }
        FirstTime = ($entry.Value.timestamps | Select-Object -First 1)
        LastTime = ($entry.Value.timestamps | Select-Object -Last 1)
    }
}
$errorSummary | Sort-Object Count -Descending | Format-Table -AutoSize | Out-File "$OutputDir\error-dedup.txt" -Encoding UTF8
Write-Host "  总错误行: $errorCount, 去重后: $($errorGroups.Count) 种"

# 2. session.log 中的 [warn] 和 [error]
Write-Host "`n[2/6] 分析 session.log 中的 [warn] 和 [error]..." -ForegroundColor Yellow
$sessionLines = if (Test-Path $SessionLog) { Get-Content $SessionLog -ErrorAction SilentlyContinue } else { @() }
$sessionWarns = @()
$sessionErrors = @()
$sessionImplicitErrors = @()
$lineNum = 0
foreach ($line in $sessionLines) {
    $lineNum++
    if ($line -match '\[warn\]') {
        $sessionWarns += "L${lineNum}: $($line.Substring(0, [Math]::Min(300, $line.Length)))"
    }
    if ($line -match '\[error\]') {
        $sessionErrors += "L${lineNum}: $($line.Substring(0, [Math]::Min(300, $line.Length)))"
    }
    # 隐式错误：LLM上下文中没有外括号的error/warn
    if ($line -match '(?<!\[)error(?!\])' -and $line -notmatch '\[error\]') {
        $sessionImplicitErrors += "L${lineNum}: $($line.Substring(0, [Math]::Min(300, $line.Length)))"
    }
}
$sessionWarns | Out-File "$OutputDir\session-warns.txt" -Encoding UTF8
$sessionErrors | Out-File "$OutputDir\session-errors.txt" -Encoding UTF8
$sessionImplicitErrors | Out-File "$OutputDir\session-implicit-errors.txt" -Encoding UTF8
Write-Host "  [warn]: $($sessionWarns.Count), [error]: $($sessionErrors.Count), 隐式error: $($sessionImplicitErrors.Count)"

# 3. add_item 调用追踪 - 找出NPC物品进入玩家背包的路径
Write-Host "`n[3/6] 追踪 add_item 调用（NPC物品→玩家背包）..." -ForegroundColor Yellow
$addItemPattern = 'add_item|addItem|add_item_from_pool'
$npcItemNames = @('手杖', '铁匠锤', '古朴长袍', '铁匠围裙', '炖菜锅', '印花围裙', '老花镜', '杂货铺围裙')
$addItemCalls = @()
$lineNum = 0
foreach ($line in $sessionLines) {
    $lineNum++
    if ($line -match $addItemPattern) {
        $isNpcItem = $false
        foreach ($npcItem in $npcItemNames) {
            if ($line -match $npcItem) { $isNpcItem = $true; break }
        }
        if ($isNpcItem -or $line -match 'inventory_service__add_item') {
            $addItemCalls += "L${lineNum}: $($line.Substring(0, [Math]::Min(500, $line.Length)))"
        }
    }
}
$addItemCalls | Out-File "$OutputDir\add-item-npc-items-trace.txt" -Encoding UTF8
Write-Host "  找到 $($addItemCalls.Count) 条NPC物品add_item调用"

# 4. NPC创建和查询追踪
Write-Host "`n[4/6] 追踪NPC创建和查询（重复问题）..." -ForegroundColor Yellow
$npcCreateCalls = @()
$npcGetCalls = @()
$lineNum = 0
foreach ($line in $sessionLines) {
    $lineNum++
    if ($line -match 'create_npc|npc_service__create') {
        $npcCreateCalls += "L${lineNum}: $($line.Substring(0, [Math]::Min(500, $line.Length)))"
    }
    if ($line -match 'get_npc|npc_service__get') {
        $npcGetCalls += "L${lineNum}: $($line.Substring(0, [Math]::Min(500, $line.Length)))"
    }
}
$npcCreateCalls | Out-File "$OutputDir\npc-create-calls.txt" -Encoding UTF8
$npcGetCalls | Out-File "$OutputDir\npc-get-calls.txt" -Encoding UTF8
Write-Host "  NPC创建: $($npcCreateCalls.Count), NPC查询: $($npcGetCalls.Count)"

# 5. Quest错误追踪 - quest_id undefined binding
Write-Host "`n[5/6] 追踪Quest错误（quest_id undefined）..." -ForegroundColor Yellow
$questErrors = @()
$questObjectivesQueries = @()
$lineNum = 0
foreach ($line in $sessionLines) {
    $lineNum++
    if ($line -match 'quest_objectives|quest_id') {
        $questObjectivesQueries += "L${lineNum}: $($line.Substring(0, [Math]::Min(500, $line.Length)))"
    }
    if ($line -match 'quest.*error|quest.*fail|list_quests.*fail') {
        $questErrors += "L${lineNum}: $($line.Substring(0, [Math]::Min(500, $line.Length)))"
    }
}
$questErrors | Out-File "$OutputDir\quest-errors.txt" -Encoding UTF8
$questObjectivesQueries | Out-File "$OutputDir\quest-objectives-queries.txt" -Encoding UTF8
Write-Host "  Quest错误: $($questErrors.Count), quest_objectives查询: $($questObjectivesQueries.Count)"

# 6. LLM上下文中的NPC物品注入追踪
Write-Host "`n[6/6] 追踪LLM上下文中的NPC物品注入..." -ForegroundColor Yellow
$npcItemInContext = @()
$lineNum = 0
foreach ($line in $sessionLines) {
    $lineNum++
    foreach ($npcItem in $npcItemNames) {
        if ($line -match $npcItem -and $line -match 'LLM-INPUT|LLM-OUTPUT|AGENT-INPUT|AGENT-OUTPUT|context|inject') {
            $npcItemInContext += "L${lineNum} [$npcItem]: $($line.Substring(0, [Math]::Min(300, $line.Length)))"
            break
        }
    }
}
$npcItemInContext | Out-File "$OutputDir\npc-items-in-llm-context.txt" -Encoding UTF8
Write-Host "  LLM上下文中NPC物品: $($npcItemInContext.Count)"

# 汇总
Write-Host "`n=== 分析汇总 ===" -ForegroundColor Cyan
$summary = @"
深度日志分析汇总 - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
================================================

1. error.log 去重分析:
   - 总错误行: $errorCount
   - 去重后错误种类: $($errorGroups.Count)
   - 详见: error-dedup.txt

2. session.log 标记分析:
   - [warn]: $($sessionWarns.Count)
   - [error]: $($sessionErrors.Count)
   - 隐式error（无外括号）: $($sessionImplicitErrors.Count)

3. NPC物品追踪:
   - add_item调用（NPC物品相关）: $($addItemCalls.Count)
   - LLM上下文中NPC物品: $($npcItemInContext.Count)

4. NPC追踪:
   - NPC创建调用: $($npcCreateCalls.Count)
   - NPC查询调用: $($npcGetCalls.Count)

5. Quest追踪:
   - Quest错误: $($questErrors.Count)
   - quest_objectives查询: $($questObjectivesQueries.Count)

输出目录: $OutputDir
"@

$summary | Out-File "$OutputDir\summary.txt" -Encoding UTF8
Write-Host $summary
