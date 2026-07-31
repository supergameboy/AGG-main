#Requires -Version 7.0
# 搜索日志中与模板ID问题相关的关键词
param(
    [string]$LogDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs",
    [string]$OutputFile = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\template-id-search-result.txt"
)

$keywords = @('克苏鲁', 'cthulhu', 'lovecraft', 'template_id', 'templateId', 'prefixId', 'raw_id', 'medieval-fantasy__')

$result = @()
$result += "=== 模板ID问题日志搜索 ==="
$result += "搜索时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$result += "搜索关键词: $($keywords -join ', ')"
$result += ""

$logFiles = Get-ChildItem $LogDir -File | Where-Object {
    $_.Name -match '\.(log|txt)$' -and $_.Length -gt 0
}

foreach ($file in $logFiles) {
    $fileResult = @()
    $fileResult += "--- 文件: $($file.Name) (大小: $([math]::Round($file.Length / 1MB, 2)) MB) ---"

    foreach ($keyword in $keywords) {
        $matches = Select-String -Path $file.FullName -Pattern $keyword -SimpleMatch -Encoding utf8 |
            Select-Object -First 30

        if ($matches) {
            $fileResult += ""
            $fileResult += "  关键词: '$keyword' (找到 $($matches.Count) 条，最多显示30条)"
            foreach ($m in $matches) {
                $lineContent = $m.Line.Trim()
                if ($lineContent.Length -gt 300) {
                    $lineContent = $lineContent.Substring(0, 300) + "..."
                }
                $fileResult += "  L$($m.LineNumber): $lineContent"
            }
        }
    }

    # 只输出有结果的文件
    $contentLines = $fileResult | Where-Object { $_ -notmatch '^--- 文件:' -and $_ -ne '' }
    if ($contentLines.Count -gt 0) {
        $result += $fileResult
        $result += ""
    }
}

# 额外搜索：查找 LLM 工具调用中的 skill/item 查询
$result += ""
$result += "=== 额外搜索：LLM工具调用中的 skill/item 查询 ==="

$toolPatterns = @(
    @('get_skills|list_skills|get_skill', 'skill查询'),
    @('get_items|list_items|get_item|add_item', 'item查询'),
    @('get_template|template_data', '模板数据查询'),
    @('learn_skill', '技能学习'),
    @('get_npcs|list_npcs|get_npc', 'NPC查询'),
    @('get_quests|list_quests|get_quest', '任务查询')
)

foreach ($file in $logFiles) {
    if ($file.Length -gt 50MB) { continue }  # 跳过超大文件

    foreach ($patternInfo in $toolPatterns) {
        $pattern = $patternInfo[0]
        $label = $patternInfo[1]

        $matches = Select-String -Path $file.FullName -Pattern $pattern -SimpleMatch -Encoding utf8 |
            Select-Object -First 15

        if ($matches) {
            $result += ""
            $result += "  [$label] 文件: $($file.Name) (最多15条)"
            foreach ($m in $matches) {
                $lineContent = $m.Line.Trim()
                if ($lineContent.Length -gt 300) {
                    $lineContent = $lineContent.Substring(0, 300) + "..."
                }
                $result += "  L$($m.LineNumber): $lineContent"
            }
        }
    }
}

# 输出结果
$outputText = $result -join "`n"
$outputText | Out-File -FilePath $OutputFile -Encoding utf8 -Force

Write-Host "搜索完成，结果已保存到: $OutputFile"
Write-Host "总行数: $($result.Count)"
