#Requires -Version 7.0
<#
.SYNOPSIS
  精确搜索日志中"克苏鲁"关键词出现的完整上下文，分析跨模板数据泄漏

.DESCRIPTION
  日志很大，此脚本：
  1. 搜索"克苏鲁"/"cthulhu"/"lovecraft"关键词
  2. 对每条匹配行，提取前后上下文（可配置行数）
  3. 分析匹配行所属的 saveId/templateId，判断是否跨模板泄漏
  4. 输出结构化报告到文件

.PARAMETER LogDir
  日志目录路径

.PARAMETER OutputFile
  输出报告文件路径

.PARAMETER ContextLines
  每条匹配行的上下文行数（前后各N行）

.EXAMPLE
  pwsh -File scripts/search-crosstemplate-leak.ps1
  pwsh -File scripts/search-crosstemplate-leak.ps1 -ContextLines 5
#>
param(
    [string]$LogDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs",
    [string]$OutputFile = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\crosstemplate-leak-report.txt",
    [int]$ContextLines = 3
)

$ErrorActionPreference = 'Continue'

# 搜索关键词
$keywords = @('克苏鲁', 'cthulhu', 'lovecraft', '克苏鲁神话', '旧日支配者', '不可名状')

# 只搜索这些日志文件（排除之前的搜索结果和测试输出）
$targetFiles = @('session.log', 'ai-2026-06-05.log', 'agent-2026-06-05.log', 'system-2026-06-05.log', 'frontend-2026-06-05.log', 'error-2026-06-05.log')

$result = @()
$result += "=== 跨模板数据泄漏分析报告 ==="
$result += "搜索时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$result += "搜索关键词: $($keywords -join ', ')"
$result += ""

$totalMatches = 0
$leakEvidence = @()

foreach ($fileName in $targetFiles) {
    $filePath = Join-Path $LogDir $fileName
    if (-not (Test-Path $filePath)) {
        continue
    }

    $file = Get-Item $filePath
    $result += "--- 文件: $fileName (大小: $([math]::Round($file.Length / 1MB, 2)) MB) ---"

    # 读取全部行（大文件按流读取）
    Write-Host "  读取 $fileName ..."
    $lines = [System.IO.File]::ReadAllLines($filePath, [System.Text.Encoding]::UTF8)
    $lineCount = $lines.Count
    Write-Host "  共 $lineCount 行"

    $fileMatches = @()

    foreach ($keyword in $keywords) {
        for ($i = 0; $i -lt $lineCount; $i++) {
            if ($lines[$i] -match [regex]::Escape($keyword)) {
                $totalMatches++
                $fileMatches += @{
                    LineNum   = $i + 1
                    Keyword   = $keyword
                    Line      = $lines[$i]
                    Context   = @()
                }

                # 提取上下文
                $startLine = [Math]::Max(0, $i - $ContextLines)
                $endLine = [Math]::Min($lineCount - 1, $i + $ContextLines)
                $ctx = @()
                for ($j = $startLine; $j -le $endLine; $j++) {
                    $prefix = if ($j -eq $i) { ">>>" } else { "   " }
                    $ctxLine = $lines[$j]
                    if ($ctxLine.Length -gt 500) {
                        $ctxLine = $ctxLine.Substring(0, 500) + "..."
                    }
                    $ctx += "$prefix L$($j+1): $ctxLine"
                }
                $fileMatches[-1].Context = $ctx

                # 尝试提取 saveId 和 templateId
                $matchLine = $lines[$i]
                $saveIdMatch = [regex]::Match($matchLine, 'saveId["\s:=]+([^\s",\}]+)')
                $templateIdMatch = [regex]::Match($matchLine, 'templateId["\s:=]+([^\s",\}]+)')
                $saveId = if ($saveIdMatch.Success) { $saveIdMatch.Groups[1].Value } else { "N/A" }
                $templateId = if ($templateIdMatch.Success) { $templateIdMatch.Groups[1].Value } else { "N/A" }

                # 判断是否泄漏：如果 templateId 是 medieval-fantasy 但内容含 cthulhu 关键词
                $isLeak = $false
                if ($keyword -in @('克苏鲁', 'cthulhu', 'lovecraft', '克苏鲁神话', '旧日支配者', '不可名状')) {
                    if ($templateId -eq 'medieval-fantasy' -or $matchLine -match 'medieval-fantasy') {
                        $isLeak = $true
                    }
                    # 检查上下文中是否有 medieval-fantasy
                    for ($j = $startLine; $j -le $endLine; $j++) {
                        if ($lines[$j] -match 'medieval-fantasy') {
                            $isLeak = $true
                            break
                        }
                    }
                }

                if ($isLeak) {
                    $leakEvidence += @{
                        File     = $fileName
                        LineNum  = $i + 1
                        Keyword  = $keyword
                        SaveId   = $saveId
                        TemplateId = $templateId
                        Line     = $matchLine
                    }
                }
            }
        }
    }

    # 输出此文件的匹配结果
    if ($fileMatches.Count -eq 0) {
        $result += "  (无匹配)"
    } else {
        $result += "  共找到 $($fileMatches.Count) 条匹配"
        $result += ""

        foreach ($m in $fileMatches) {
            $result += "  --- 匹配 #$($totalMatches) | 关键词: '$($m.Keyword)' | 行: L$($m.LineNum) ---"
            foreach ($ctxLine in $m.Context) {
                $result += "  $ctxLine"
            }
            $result += ""
        }
    }

    $result += ""
}

# 泄漏分析汇总
$result += ""
$result += "=========================================="
$result += "=== 跨模板泄漏证据汇总 ==="
$result += "=========================================="
$result += ""

if ($leakEvidence.Count -eq 0) {
    $result += "未发现明确的跨模板泄漏证据（medieval-fantasy 游戏中出现 cthulhu 内容）"
    $result += ""
    $result += "注意：cthulhu 关键词出现在以下场景不算泄漏："
    $result += "  1. 模板种子阶段（Seeded template from YAML: cthulhu-investigation）"
    $result += "  2. cthulhu-investigation 模板自身的 save"
    $result += "  3. LLM 输入中包含所有模板数据（这是需要修复的问题，但需要检查具体 saveId）"
} else {
    $result += "发现 $($leakEvidence.Count) 条跨模板泄漏证据："
    $result += ""
    $idx = 0
    foreach ($evidence in $leakEvidence) {
        $idx++
        $result += "  泄漏 #$idx :"
        $result += "    文件: $($evidence.File)"
        $result += "    行号: L$($evidence.LineNum)"
        $result += "    关键词: '$($evidence.Keyword)'"
        $result += "    saveId: $($evidence.SaveId)"
        $result += "    templateId: $($evidence.TemplateId)"
        $linePreview = $evidence.Line
        if ($linePreview.Length -gt 300) {
            $linePreview = $linePreview.Substring(0, 300) + "..."
        }
        $result += "    内容: $linePreview"
        $result += ""
    }
}

# 统计
$result += ""
$result += "=== 统计 ==="
$result += "总匹配数: $totalMatches"
$result += "泄漏证据数: $($leakEvidence.Count)"

# 输出
$outputText = $result -join "`n"
$outputText | Out-File -FilePath $OutputFile -Encoding utf8NoBOM -Force

Write-Host ""
Write-Host "搜索完成，结果已保存到: $OutputFile"
Write-Host "总匹配数: $totalMatches"
Write-Host "泄漏证据数: $($leakEvidence.Count)"
