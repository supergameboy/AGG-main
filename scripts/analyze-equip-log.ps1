#Requires -Version 7.0
<#
.SYNOPSIS
    分析 session.log 中装备相关的问题

.DESCRIPTION
    从 session.log 中提取装备操作记录，统计装备操作，
    提取已装备物品列表，找出可能导致装备数量不一致的记录。

.EXAMPLE
    pwsh -File scripts/analyze-equip-log.ps1
    pwsh -File scripts/analyze-equip-log.ps1 -LogPath "game_data\logs-backup\session.log"
#>

param(
    [string]$LogPath = "game_data\logs-backup\session.log"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $LogPath)) {
    Write-Host "日志文件不存在: $LogPath" -ForegroundColor Red
    exit 1
}

$fileSize = (Get-Item $LogPath).Length / 1MB
Write-Host "`n=== 装备日志分析 ===" -ForegroundColor Cyan
Write-Host "日志文件: $LogPath ($($fileSize.ToString('F2')) MB)"
Write-Host ""

# 逐行读取，过滤装备相关行（避免一次性加载大文件）
$equipLines = [System.Collections.Generic.List[string]]::new()
$inventoryLines = [System.Collections.Generic.List[string]]::new()

$reader = [System.IO.StreamReader]::new($LogPath)
try {
    while ($null -ne ($line = $reader.ReadLine())) {
        if ($line -match 'equip|unequip|装备') {
            $equipLines.Add($line)
        }
        elseif ($line -match 'inventory_service') {
            $inventoryLines.Add($line)
        }
    }
}
finally {
    $reader.Dispose()
}

Write-Host "--- 1. 装备操作统计 ---" -ForegroundColor Yellow

$equipOps = @{
    equip_item   = 0
    unequip_item = 0
    get_equipment = 0
    add_item     = 0
    update_item  = 0
    remove_item  = 0
    list_inventory = 0
}

$allRelevantLines = $equipLines + $inventoryLines

foreach ($line in $allRelevantLines) {
    foreach ($op in @($equipOps.Keys)) {
        if ($line -match "Executing method: $op\b") {
            $equipOps[$op]++
        }
    }
}

foreach ($op in $equipOps.Keys | Sort-Object) {
    $count = $equipOps[$op]
    if ($count -gt 0) {
        Write-Host "  $op : $count"
    }
}

Write-Host ""

# 提取装备成功/失败记录
Write-Host "--- 2. 装备操作详情 ---" -ForegroundColor Yellow

$equipSuccess = [System.Collections.Generic.List[hashtable]]::new()
$equipFail = [System.Collections.Generic.List[hashtable]]::new()
$unequipRecords = [System.Collections.Generic.List[hashtable]]::new()

for ($i = 0; $i -lt $equipLines.Count; $i++) {
    $line = $equipLines[$i]

    # 匹配装备成功: (service:inventory) Item equipped
    if ($line -match '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*Item equipped.*"inventoryId":"([^"]+)".*"slot":"([^"]+)"') {
        $equipSuccess.Add(@{
            Time   = $Matches[1]
            ItemId = $Matches[2]
            Slot   = $Matches[3]
        })
    }
    # 匹配装备失败: (service:inventory) equipItem: category not allowed
    elseif ($line -match '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*equipItem.*category not allowed.*"slot":"([^"]+)".*"category":"([^"]+)".*"allowedCategories":\[([^\]]+)\]') {
        $equipFail.Add(@{
            Time             = $Matches[1]
            Slot             = $Matches[2]
            Category         = $Matches[3]
            AllowedCategories = $Matches[4]
        })
    }
    # 匹配卸装记录
    elseif ($line -match '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*Item unequipped.*"inventoryId":"([^"]+)"') {
        $unequipRecords.Add(@{
            Time   = $Matches[1]
            ItemId = $Matches[2]
        })
    }
}

Write-Host "  装备成功: $($equipSuccess.Count) 次"
Write-Host "  装备失败: $($equipFail.Count) 次"
Write-Host "  卸装记录: $($unequipRecords.Count) 次"

if ($equipFail.Count -gt 0) {
    Write-Host ""
    Write-Host "  装备失败详情:" -ForegroundColor Red
    foreach ($fail in $equipFail) {
        Write-Host "    [$($fail.Time)] 槽位=$($fail.Slot), 物品类别=$($fail.Category), 允许类别=[$($fail.AllowedCategories)]" -ForegroundColor Red
    }
}

Write-Host ""

# 提取已装备物品列表
Write-Host "--- 3. 已装备物品列表 ---" -ForegroundColor Yellow

$equippedItems = [System.Collections.Generic.List[hashtable]]::new()

for ($i = 0; $i -lt $equipLines.Count; $i++) {
    $line = $equipLines[$i]

    # 从 tool call parsed 行提取装备参数
    if ($line -match '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*Tool call parsed: inventory_service\.equip_item.*"inventoryId":"([^"]+)".*"targetSlot":"([^"]+)"') {
        $equippedItems.Add(@{
            Time   = $Matches[1]
            ItemId = $Matches[2]
            Slot   = $Matches[3]
        })
    }
}

if ($equippedItems.Count -gt 0) {
    # 按槽位分组
    $slotGroups = $equippedItems | Group-Object -Property Slot | Sort-Object Name
    foreach ($group in $slotGroups) {
        Write-Host "  槽位 [$($group.Name)] - 装备次数: $($group.Count)"
        foreach ($item in $group.Group) {
            Write-Host "    [$($item.Time)] $($item.ItemId)"
        }
    }
}
else {
    Write-Host "  无装备操作记录"
}

Write-Host ""

# 找出可能导致装备数量不一致的记录
Write-Host "--- 4. 装备数量不一致风险 ---" -ForegroundColor Yellow

$inconsistencies = [System.Collections.Generic.List[string]]::new()

# 检查1: 同一槽位多次装备（可能覆盖前一个装备）
$slotEquipCounts = @{}
foreach ($item in $equippedItems) {
    if (-not $slotEquipCounts.ContainsKey($item.Slot)) {
        $slotEquipCounts[$item.Slot] = [System.Collections.Generic.List[hashtable]]::new()
    }
    $slotEquipCounts[$item.Slot].Add($item)
}

foreach ($slot in $slotEquipCounts.Keys | Sort-Object) {
    $items = $slotEquipCounts[$slot]
    if ($items.Count -gt 1) {
        $inconsistencies.Add("槽位 [$slot] 被装备了 $($items.Count) 次，可能存在覆盖:")
        foreach ($item in $items) {
            $inconsistencies.Add("  [$($item.Time)] $($item.ItemId)")
        }
    }
}

# 检查2: 装备成功但 method execution completed: success=false
$equipMethodCalls = @{}
for ($i = 0; $i -lt $inventoryLines.Count; $i++) {
    $line = $inventoryLines[$i]
    if ($line -match '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*Executing method: equip_item on tool: inventory_service.*"saveId":"([^"]+)"') {
        $saveId = $Matches[2]
        $time = $Matches[1]
        # 检查后续行是否有 success:false
        for ($j = $i + 1; $j -lt [Math]::Min($i + 5, $inventoryLines.Count); $j++) {
            if ($inventoryLines[$j] -match 'Method execution completed: equip_item.*"success":false') {
                $inconsistencies.Add("[$time] equip_item 执行失败 (saveId=$saveId)")
                break
            }
            if ($inventoryLines[$j] -match 'Method execution completed: equip_item.*"success":true') {
                break
            }
        }
    }
}

# 检查3: 装备成功但 equipmentBonuses 为空
for ($i = 0; $i -lt $equipLines.Count; $i++) {
    $line = $equipLines[$i]
    if ($line -match '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*Derived attributes recalculated.*"equipmentBonuses":\{\}') {
        $inconsistencies.Add("[$($Matches[1])] 装备后属性加成为空 (equipmentBonuses={})")
    }
}

# 检查4: 同一物品装备到不同槽位
$itemSlotMap = @{}
foreach ($item in $equippedItems) {
    if (-not $itemSlotMap.ContainsKey($item.ItemId)) {
        $itemSlotMap[$item.ItemId] = [System.Collections.Generic.List[string]]::new()
    }
    if ($itemSlotMap[$item.ItemId] -notcontains $item.Slot) {
        $itemSlotMap[$item.ItemId].Add($item.Slot)
    }
}

foreach ($itemId in $itemSlotMap.Keys) {
    if ($itemSlotMap[$itemId].Count -gt 1) {
        $inconsistencies.Add("物品 [$itemId] 被装备到多个不同槽位: $($itemSlotMap[$itemId] -join ', ')")
    }
}

if ($inconsistencies.Count -gt 0) {
    Write-Host "  发现 $($inconsistencies.Count) 条风险记录:" -ForegroundColor Red
    foreach ($issue in $inconsistencies) {
        Write-Host "    $issue" -ForegroundColor Red
    }
}
else {
    Write-Host "  未发现装备数量不一致风险" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 分析完成 ===" -ForegroundColor Cyan
