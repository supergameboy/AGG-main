#Requires -Version 7.0
<#
.SYNOPSIS
  批量将 docs/help/ 下文档的 Markdown 引用块头转换为 YAML frontmatter 格式。

.DESCRIPTION
  1. 解析 .trae/rules/help-docs-standards.md 的读取触发矩阵，建立 文档名 → trigger 关键词列表 映射
  2. 遍历 docs/help/ 下所有 .md 文件（跳过 README.md）
  3. 提取 title / version / date / description，从矩阵获取 trigger
  4. 生成 YAML frontmatter，删除原 Markdown 引用块，将 YAML frontmatter 插到 # 标题 之前
  5. 保留 # 标题 与正文不动

.PARAMETER DocsPath
  docs/help 目录路径，默认 "docs/help"

.PARAMETER StandardsPath
  help-docs-standards.md 路径，默认 ".trae/rules/help-docs-standards.md"

.PARAMETER DryRun
  试运行模式：仅打印转换结果，不写回文件

.EXAMPLE
  pwsh scripts/convert-help-docs-frontmatter.ps1
  pwsh scripts/convert-help-docs-frontmatter.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string]$DocsPath = "docs/help",
    [string]$StandardsPath = ".trae/rules/help-docs-standards.md",
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ============================================================================
# 1. 解析 help-docs-standards.md 读取触发矩阵
#    矩阵格式: | 任务类型 | 触发关键词 | 必读文档 |
#    关键词用 、 分隔；文档用 + 连接，每段可能含 .md
# ============================================================================
function Parse-TriggerMap {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        Write-Warning "Standards file not found: $Path"
        return @{}
    }

    $lines = Get-Content $Path -Encoding UTF8
    $triggerMap = @{}
    $inMatrix = $false

    foreach ($line in $lines) {
        # 矩阵起始标志
        if ($line -match '^\|\s*任务类型\s*\|') { $inMatrix = $true; continue }
        # 矩阵结束（空行或非表格行）
        if ($inMatrix -and $line -notmatch '^\|') { break }
        if (-not $inMatrix) { continue }

        # 跳过分隔行 |---|---|---|
        if ($line -match '^\|[\s-]+\|') { continue }

        # 解析三列
        $cols = $line -split '\|' | Select-Object -Skip 1 | ForEach-Object { $_.Trim() }
        if ($cols.Count -lt 3) { continue }

        $keywordsRaw = $cols[1]
        $docsRaw = $cols[2]

        # 解析关键词（用 、 分隔）
        $keywords = $keywordsRaw -split '、' | ForEach-Object {
            $_.Trim() -replace '^\s*', '' -replace '\s*$', ''
        } | Where-Object { $_ -and $_ -ne '—' }

        # 解析文档名（可能含 §章节号、+ 连接、路径前缀）
        # 仅提取 xxx.md 部分
        $docNames = [regex]::Matches($docsRaw, '([a-zA-Z0-9_-]+\.md)') |
            ForEach-Object { $_.Groups[1].Value } |
            Sort-Object -Unique

        foreach ($docName in $docNames) {
            if ($triggerMap.ContainsKey($docName)) {
                $triggerMap[$docName] = @($triggerMap[$docName] + $keywords | Sort-Object -Unique)
            } else {
                $triggerMap[$docName] = @($keywords)
            }
        }
    }

    return $triggerMap
}

# ============================================================================
# 2. 转换单个文档
# ============================================================================
function Convert-Document {
    param(
        [string]$FilePath,
        [hashtable]$TriggerMap,
        [switch]$DryRun
    )

    $content = [System.IO.File]::ReadAllText($FilePath, [System.Text.UTF8Encoding]::new($false))
    $fileName = Split-Path $FilePath -Leaf

    # --- 提取 title ---
    $titleMatch = [regex]::Match($content, '^# (.+)$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $titleMatch.Success) {
        Write-Warning "  [SKIP] No H1 title found: $fileName"
        return $false
    }
    $title = $titleMatch.Groups[1].Value.Trim()

    # --- 提取 version ---
    $versionMatch = [regex]::Match($content, '>\s*\*\*版本\*\*:\s*v?([\d.]+)')
    $version = if ($versionMatch.Success) { $versionMatch.Groups[1].Value } else { "1.0" }

    # --- 提取 date ---
    $dateMatch = [regex]::Match($content, '>\s*\*\*最后更新\*\*:\s*(\d{4}-\d{2}-\d{2})')
    $date = if ($dateMatch.Success) { $dateMatch.Groups[1].Value } else { (Get-Date -Format "yyyy-MM-dd") }

    # --- 提取 description (适用范围) ---
    $descMatch = [regex]::Match($content, '>\s*\*\*适用范围\*\*:\s*(.+)')
    $description = if ($descMatch.Success) {
        $descMatch.Groups[1].Value.Trim()
    } else { "" }

    # 转义 YAML 字符串中的双引号和反斜杠
    $titleEsc = $title -replace '"', '\"' -replace '\\', '\\'
    $descEsc = $description -replace '"', '\"' -replace '\\', '\\'

    # --- 获取 trigger ---
    $trigger = $TriggerMap[$fileName]
    if (-not $trigger -or $trigger.Count -eq 0) {
        # 没有匹配的 trigger，使用 title 关键词作为默认
        $trigger = @($title)
        Write-Warning "  [WARN] No trigger found in matrix for $fileName, using title as default"
    }

    # --- 生成 YAML frontmatter ---
    $triggerYaml = ($trigger | ForEach-Object { "  - ""$($_ -replace '"', '\"')""" }) -join "`n"

    $yaml = @"
---
status: active
version: $version
date: $date
title: "$titleEsc"
description: "$descEsc"
trigger:
$triggerYaml
---

"@

    # --- 删除 Markdown 引用块 ---
    # 策略：逐行处理，找到 # 标题行后，删除所有连续的 > 开头行和它们之间的空行
    # 直到遇到 --- 分隔线、## 章节标题、或非空非 > 行

    $lines = $content -split "`r?`n"
    $newLines = [System.Collections.Generic.List[string]]::new()
    $titleFound = $false
    $inQuoteBlock = $false
    $quoteDeleted = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]

        if (-not $titleFound -and $line -match '^# .+') {
            $titleFound = $true
            $newLines.Add($line)
            # 标题后的空行也加入
            while ($i + 1 -lt $lines.Count -and $lines[$i + 1] -eq '') {
                $i++
                # 只保留一个空行
            }
            $newLines.Add('')
            $inQuoteBlock = $true
            continue
        }

        if ($inQuoteBlock -and -not $quoteDeleted) {
            # 跳过 > 开头的行（引用块）
            if ($line -match '^>') { continue }
            # 跳过空行（引用块内的空行）
            if ($line -eq '') { continue }
            # 遇到 --- 分隔线，跳过它（因为 YAML frontmatter 已有 ---）
            if ($line -match '^---\s*$') {
                $quoteDeleted = $true
                continue
            }
            # 遇到 ## 章节标题或其他内容，停止删除引用块
            $quoteDeleted = $true
            $inQuoteBlock = $false
            $newLines.Add($line)
            continue
        }

        $newLines.Add($line)
    }

    $newContent = $newLines -join "`n"

    # --- 在 # 标题前插入 YAML frontmatter ---
    $newContent = $yaml + $newContent

    if ($DryRun) {
        Write-Host "  [DRY-RUN] Would write $fileName" -ForegroundColor Cyan
        Write-Host "  --- YAML frontmatter preview ---" -ForegroundColor Cyan
        Write-Host $yaml -ForegroundColor Cyan
        return $true
    }

    [System.IO.File]::WriteAllText($FilePath, $newContent, [System.Text.UTF8Encoding]::new($false))
    return $true
}

# ============================================================================
# 3. 主逻辑
# ============================================================================
Write-Host "=== Help Docs Frontmatter Converter ===" -ForegroundColor Green
Write-Host "DocsPath: $DocsPath"
Write-Host "StandardsPath: $StandardsPath"
Write-Host "DryRun: $DryRun"
Write-Host ""

# 解析触发矩阵
Write-Host "Parsing trigger matrix from $StandardsPath ..." -ForegroundColor Yellow
$triggerMap = Parse-TriggerMap -Path $StandardsPath
Write-Host "Found $($triggerMap.Count) document entries in trigger matrix."
Write-Host ""

# 遍历所有 .md 文件
$docs = Get-ChildItem -Path $DocsPath -Recurse -Filter "*.md" -File | Where-Object { $_.Name -ne "README.md" }
Write-Host "Found $($docs.Count) .md files to convert (excluding README.md)."
Write-Host ""

$success = 0
$skipped = 0
$failed = 0

foreach ($doc in $docs) {
    $relPath = $doc.FullName.Replace((Get-Location).Path + "\", "")
    Write-Host "Converting: $relPath" -ForegroundColor Yellow

    try {
        $result = Convert-Document -FilePath $doc.FullName -TriggerMap $triggerMap -DryRun:$DryRun
        if ($result) {
            $success++
        } else {
            $skipped++
        }
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Green
Write-Host "Success: $success"
Write-Host "Skipped: $skipped"
Write-Host "Failed:  $failed"
