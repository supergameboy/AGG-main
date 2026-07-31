#Requires -Version 7.0
<#
.SYNOPSIS
  深度分析 LLM 输入日志，检查是否向 medieval-fantasy 游戏注入了 cthulhu-investigation 模板数据

.DESCRIPTION
  此脚本：
  1. 搜索 ai-*.log 和 session.log 中的 LLM-INPUT 行
  2. 提取每条 LLM 输入中包含的 skill/item/npc ID 列表
  3. 检查是否有 cthulhu-investigation 前缀的 ID 出现在 medieval-fantasy 游戏的上下文中
  4. 同时搜索 ContextInjector 注入的预加载数据

.PARAMETER LogDir
  日志目录路径

.PARAMETER OutputFile
  输出报告文件路径
#>
param(
    [string]$LogDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs",
    [string]$OutputFile = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\llm-context-leak-report.txt"
)

$ErrorActionPreference = 'Continue'

$result = @()
$result += "=== LLM 上下文跨模板泄漏深度分析 ==="
$result += "搜索时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$result += ""

# 模板前缀列表
$templatePrefixes = @('cthulhu-investigation', 'cyberpunk-mercenary', 'medieval-fantasy', 'modern-romance', 'xianxia')

# 搜索所有日志文件
$logFiles = Get-ChildItem $LogDir -File | Where-Object {
    $_.Name -match '\.(log|txt)$' -and $_.Length -gt 0 -and $_.Name -notmatch 'search-result|report|test-output'
}

$totalLLMInputs = 0
$leakCases = @()

foreach ($file in $logFiles) {
    Write-Host "  分析 $($file.Name) ..."
    $lines = [System.IO.File]::ReadAllLines($file.FullName, [System.Text.Encoding]::UTF8)

    foreach ($line in $lines) {
        # 搜索 LLM-INPUT 行
        if ($line -match 'LLM-INPUT') {
            $totalLLMInputs++

            # 提取 agent 类型
            $agentMatch = [regex]::Match($line, 'agent=(\w+)')
            $agent = if ($agentMatch.Success) { $agentMatch.Groups[1].Value } else { "unknown" }

            # 检查行中是否包含 cthulhu-investigation 前缀的 ID
            # 格式: cthulhu-investigation__xxx
            $cthulhuIds = [regex]::Matches($line, 'cthulhu-investigation__\w+')
            if ($cthulhuIds.Count -gt 0) {
                # 检查是否在 medieval-fantasy 上下文中
                $isMedieval = $line -match 'medieval-fantasy'

                # 提取 saveId
                $saveIdMatch = [regex]::Match($line, 'save[_]?[Ii]d["\s:=]+([^\s",\}]+)')
                $saveId = if ($saveIdMatch.Success) { $saveIdMatch.Groups[1].Value } else { "N/A" }

                $ids = $cthulhuIds | ForEach-Object { $_.Value } | Select-Object -Unique

                $leakCases += @{
                    File     = $file.Name
                    Agent    = $agent
                    SaveId   = $saveId
                    IsMedieval = $isMedieval
                    CthulhuIds = $ids -join ', '
                    IdCount  = $ids.Count
                }
            }

            # 也检查 cyberpunk 前缀
            $cyberpunkIds = [regex]::Matches($line, 'cyberpunk-mercenary__\w+')
            if ($cyberpunkIds.Count -gt 0) {
                $isMedieval = $line -match 'medieval-fantasy'
                $saveIdMatch = [regex]::Match($line, 'save[_]?[Ii]d["\s:=]+([^\s",\}]+)')
                $saveId = if ($saveIdMatch.Success) { $saveIdMatch.Groups[1].Value } else { "N/A" }
                $ids = $cyberpunkIds | ForEach-Object { $_.Value } | Select-Object -Unique

                $leakCases += @{
                    File     = $file.Name
                    Agent    = $agent
                    SaveId   = $saveId
                    IsMedieval = $isMedieval
                    CthulhuIds = "[cyberpunk] " + ($ids -join ', ')
                    IdCount  = $ids.Count
                }
            }
        }

        # 搜索 ContextInjector 注入的数据
        if ($line -match 'ContextInjector|context-injector|injectContext|fetchRule') {
            # 检查是否包含跨模板数据
            foreach ($prefix in @('cthulhu-investigation__', 'cyberpunk-mercenary__')) {
                $crossIds = [regex]::Matches($line, "$prefix\w+")
                if ($crossIds.Count -gt 0) {
                    $ids = $crossIds | ForEach-Object { $_.Value } | Select-Object -Unique
                    $leakCases += @{
                        File     = $file.Name
                        Agent    = "context-injector"
                        SaveId   = "N/A"
                        IsMedieval = $line -match 'medieval-fantasy'
                        CthulhuIds = "[injector] " + ($ids -join ', ')
                        IdCount  = $ids.Count
                    }
                }
            }
        }

        # 搜索工具调用返回结果中的跨模板数据
        if ($line -match 'tool_result|ToolResult|tool_return') {
            foreach ($prefix in @('cthulhu-investigation__', 'cyberpunk-mercenary__')) {
                $crossIds = [regex]::Matches($line, "$prefix\w+")
                if ($crossIds.Count -gt 0) {
                    $ids = $crossIds | ForEach-Object { $_.Value } | Select-Object -Unique
                    $leakCases += @{
                        File     = $file.Name
                        Agent    = "tool-result"
                        SaveId   = "N/A"
                        IsMedieval = $line -match 'medieval-fantasy'
                        CthulhuIds = "[tool-result] " + ($ids -join ', ')
                        IdCount  = $ids.Count
                    }
                }
            }
        }
    }
}

# 输出结果
$result += "=== 分析概览 ==="
$result += "扫描 LLM-INPUT 行数: $totalLLMInputs"
$result += "发现跨模板泄漏案例: $($leakCases.Count)"
$result += ""

if ($leakCases.Count -eq 0) {
    $result += "未发现跨模板泄漏。"
    $result += ""
    $result += "可能原因："
    $result += "  1. 当前日志是修复后的测试日志，不包含实际游戏运行数据"
    $result += "  2. 需要重启后端并实际创建 medieval-fantasy 游戏进行测试"
    $result += "  3. 泄漏可能发生在 LLM 上下文构建阶段（ContextInjector），但日志截断无法看到完整内容"
} else {
    $result += "=== 泄漏详情 ==="
    $result += ""

    # 按 medieval-fantasy 上下文分组
    $medievalLeaks = $leakCases | Where-Object { $_.IsMedieval }
    $otherLeaks = $leakCases | Where-Object { -not $_.IsMedieval }

    if ($medievalLeaks.Count -gt 0) {
        $result += "--- 确认泄漏（medieval-fantasy 上下文中出现其他模板数据）---"
        $idx = 0
        foreach ($case in $medievalLeaks) {
            $idx++
            $result += "  泄漏 #$idx :"
            $result += "    文件: $($case.File)"
            $result += "    Agent: $($case.Agent)"
            $result += "    saveId: $($case.SaveId)"
            $result += "    跨模板ID数量: $($case.IdCount)"
            $result += "    跨模板ID: $($case.CthulhuIds)"
            $result += ""
        }
    }

    if ($otherLeaks.Count -gt 0) {
        $result += "--- 其他跨模板引用（非 medieval-fantasy 上下文）---"
        $idx = 0
        foreach ($case in $otherLeaks) {
            $idx++
            $result += "  引用 #$idx :"
            $result += "    文件: $($case.File)"
            $result += "    Agent: $($case.Agent)"
            $result += "    saveId: $($case.SaveId)"
            $result += "    跨模板ID数量: $($case.IdCount)"
            $result += "    跨模板ID: $($case.CthulhuIds)"
            $result += ""
        }
    }
}

# 额外：搜索所有模板前缀ID的出现频率
$result += ""
$result += "=== 各模板前缀ID出现频率 ==="

foreach ($prefix in $templatePrefixes) {
    $pattern = "${prefix}__\w+"
    $count = 0
    foreach ($file in $logFiles) {
        $lines = [System.IO.File]::ReadAllLines($file.FullName, [System.Text.Encoding]::UTF8)
        foreach ($line in $lines) {
            $matches = [regex]::Matches($line, $pattern)
            $count += $matches.Count
        }
    }
    $result += "  ${prefix}: $count 次"
}

# 输出
$outputText = $result -join "`n"
$outputText | Out-File -FilePath $OutputFile -Encoding utf8NoBOM -Force

Write-Host ""
Write-Host "分析完成，结果已保存到: $OutputFile"
Write-Host "LLM-INPUT 行数: $totalLLMInputs"
Write-Host "泄漏案例数: $($leakCases.Count)"
