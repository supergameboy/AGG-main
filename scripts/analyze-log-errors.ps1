#Requires -Version 7.0
<#
.SYNOPSIS
  从日志文件中提取 warn 和 error 条目，分类汇总输出
.DESCRIPTION
  处理 AGG 项目的多种日志格式（JSON 和文本），提取所有 warn/error 级别条目，
  去重、分类、统计，输出结构化分析报告。
#>

param(
    [string]$LogDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs-backup",
    [string]$OutputDir = "c:\Users\super\Documents\trae_projects\AGG-main\docs\debug"
)

$logFiles = Get-ChildItem -Path $LogDir -Filter "*.log" | Sort-Object Name

$allErrors = @()
$allWarns = @()

foreach ($file in $logFiles) {
    Write-Host "Processing: $($file.Name) ($([math]::Round($file.Length / 1MB, 2)) MB)"

    $lines = Get-Content -Path $file.FullName -Encoding UTF8

    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        $isError = $false
        $isWarn = $false
        $entry = @{
            source    = $file.Name
            timestamp = ""
            level     = ""
            message   = ""
            error     = ""
            rawSource = ""
            toolType  = ""
            saveId    = ""
        }

        # 尝试 JSON 格式解析
        try {
            $json = $line | ConvertFrom-Json -ErrorAction Stop

            $lvl = if ($json.level) { $json.level.ToLower() } else { "" }
            if ($lvl -eq "error") { $isError = $true }
            elseif ($lvl -eq "warn" -or $lvl -eq "warning") { $isWarn = $true }
            else { continue }

            $entry.level = $lvl
            $entry.timestamp = $json.timestamp ?? ""
            $entry.message = $json.message ?? ""
            $entry.error = $json.error ?? ""
            $entry.rawSource = $json.source ?? ""
            $entry.toolType = $json.toolType ?? ""
            $entry.saveId = $json.saveId ?? ""
        }
        catch {
            # 文本格式: 2026-06-10 10:28:40 [error] (source) message
            if ($line -match '\[(error|warn|warning)\]') {
                $lvl = $Matches[1].ToLower()
                if ($lvl -eq "error") { $isError = $true }
                elseif ($lvl -eq "warn" -or $lvl -eq "warning") { $isWarn = $true }
                else { continue }

                $entry.level = $lvl
                if ($line -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') {
                    $entry.timestamp = $Matches[1]
                }
                if ($line -match '\(([^)]+)\)') {
                    $entry.rawSource = $Matches[1]
                }
                # 提取消息部分 - 去掉时间戳和级别标记
                $msgPart = $line -replace '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*\[(error|warn|warning)\]\s*', ''
                $msgPart = $msgPart -replace '^\([^)]+\)\s*', ''
                $entry.message = $msgPart.Trim()
            }
            else {
                continue
            }
        }

        if ($isError) {
            $allErrors += $entry
        }
        elseif ($isWarn) {
            $allWarns += $entry
        }
    }
}

Write-Host "`n=== 统计 ==="
Write-Host "Error 条目总数: $($allErrors.Count)"
Write-Host "Warn 条目总数: $($allWarns.Count)"

# 按 error 消息去重分类
$errorGroups = $allErrors | Group-Object { $_.error ?? $_.message } | Sort-Object Count -Descending

Write-Host "`n=== Error 分类 (按错误消息去重) ==="

$report = @()
$report += "# 日志错误分析报告"
$report += ""
$report += "> 生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$report += "> 日志目录: $LogDir"
$report += "> Error 总数: $($allErrors.Count) | Warn 总数: $($allWarns.Count)"
$report += ""

# Error 分类
$report += "## 一、Error 分类汇总"
$report += ""
$report += "| # | 错误消息 | 出现次数 | 来源文件 | 来源模块 | 关联工具 |"
$report += "|---|---------|---------|---------|---------|---------|"

$idx = 1
foreach ($group in $errorGroups) {
    $errorMsg = $group.Name
    if ([string]::IsNullOrWhiteSpace($errorMsg)) { $errorMsg = "(空)" }
    # 截断过长的错误消息
    $displayMsg = if ($errorMsg.Length -gt 120) { $errorMsg.Substring(0, 120) + "..." } else { $errorMsg }
    $displayMsg = $displayMsg -replace '\|', '\|'

    $sources = ($group.Group | Select-Object -ExpandProperty source -Unique) -join ", "
    $rawSources = ($group.Group | Select-Object -ExpandProperty rawSource -Unique | Where-Object { $_ }) -join ", "
    $toolTypes = ($group.Group | Select-Object -ExpandProperty toolType -Unique | Where-Object { $_ }) -join ", "

    $report += "| $idx | $displayMsg | $($group.Count) | $sources | $rawSources | $toolTypes |"
    $idx++
}

$report += ""

# 详细错误分析
$report += "## 二、Error 详细分析"
$report += ""

$idx = 1
foreach ($group in $errorGroups) {
    $errorMsg = $group.Name
    if ([string]::IsNullOrWhiteSpace($errorMsg)) { $errorMsg = "(空)" }

    $report += "### E$idx - $($errorMsg.Substring(0, [Math]::Min(80, $errorMsg.Length)))"
    $report += ""
    $report += "- **出现次数**: $($group.Count)"
    $report += "- **错误消息**: ``$errorMsg``"

    $messages = ($group.Group | Select-Object -ExpandProperty message -Unique | Where-Object { $_ }) -join " / "
    $report += "- **消息类型**: $messages"

    $rawSources = ($group.Group | Select-Object -ExpandProperty rawSource -Unique | Where-Object { $_ }) -join ", "
    $report += "- **来源模块**: $rawSources"

    $toolTypes = ($group.Group | Select-Object -ExpandProperty toolType -Unique | Where-Object { $_ }) -join ", "
    if ($toolTypes) { $report += "- **关联工具**: $toolTypes" }

    $saveIds = ($group.Group | Select-Object -ExpandProperty saveId -Unique | Where-Object { $_ }) -join ", "
    if ($saveIds) { $report += "- **关联存档**: $saveIds" }

    $timestamps = $group.Group | Select-Object -ExpandProperty timestamp -Unique | Where-Object { $_ } | Sort-Object
    if ($timestamps.Count -gt 0) {
        $report += "- **时间范围**: $($timestamps[0]) ~ $($timestamps[-1])"
    }

    $report += ""
    $idx++
}

# Warn 分类
if ($allWarns.Count -gt 0) {
    $warnGroups = $allWarns | Group-Object { $_.error ?? $_.message } | Sort-Object Count -Descending

    $report += "## 三、Warn 分类汇总"
    $report += ""
    $report += "| # | 警告消息 | 出现次数 | 来源文件 | 来源模块 |"
    $report += "|---|---------|---------|---------|---------|"

    $idx = 1
    foreach ($group in $warnGroups) {
        $warnMsg = $group.Name
        if ([string]::IsNullOrWhiteSpace($warnMsg)) { $warnMsg = "(空)" }
        $displayMsg = if ($warnMsg.Length -gt 120) { $warnMsg.Substring(0, 120) + "..." } else { $warnMsg }
        $displayMsg = $displayMsg -replace '\|', '\|'

        $sources = ($group.Group | Select-Object -ExpandProperty source -Unique) -join ", "
        $rawSources = ($group.Group | Select-Object -ExpandProperty rawSource -Unique | Where-Object { $_ }) -join ", "

        $report += "| $idx | $displayMsg | $($group.Count) | $sources | $rawSources |"
        $idx++
    }
    $report += ""
}

# 时间线分析
$report += "## 四、Error 时间线"
$report += ""

$timeGroups = $allErrors | Where-Object { $_.timestamp } | Group-Object { ($_.timestamp -split ' ')[1]?.Split(':')[0..1] -join ':' } | Sort-Object Name
foreach ($tg in $timeGroups) {
    $report += "- **$($tg.Name)**: $($tg.Count) 个错误"
    $uniqueErrors = ($tg.Group | Select-Object -ExpandProperty message -Unique) -join ", "
    $report += "  - 类型: $uniqueErrors"
}

$report += ""

# 输出
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$outputFile = Join-Path $OutputDir "log-error-analysis-20260610.md"
$report -join "`n" | Out-File -FilePath $outputFile -Encoding UTF8

Write-Host "`n报告已输出到: $outputFile"
