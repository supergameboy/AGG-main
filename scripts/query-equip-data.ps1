#Requires -Version 7.0
<#
.SYNOPSIS
查询数据库中装备数据不一致的记录
#>

$dbPath = Join-Path $PSScriptRoot '..\game_data\game.db'

if (-not (Test-Path $dbPath)) {
    Write-Host "数据库文件不存在: $dbPath"
    exit 1
}

# 使用 Node.js 的 better-sqlite3 查询（因为 PowerShell 没有原生 SQLite 支持）
$script = @"
const Database = require('better-sqlite3');
const db = new Database('$($dbPath.Replace('\','\\'))', { readonly: true });

// 1. 查询所有 equipped=1 的物品
console.log('=== 1. 所有已装备物品 (equipped=1) ===');
const equipped = db.prepare('SELECT id, name, category, equipped, equipped_slot, owner_type, owner_id FROM inventory WHERE equipped = 1').all();
console.log(JSON.stringify(equipped, null, 2));
console.log("已装备物品总数: " + equipped.length);

// 2. 查找 equipped=1 但 equipped_slot 为 null 的异常记录
console.log('\n=== 2. 异常记录: equipped=1 但 equipped_slot=NULL ===');
const anomalous = db.prepare('SELECT id, name, category, equipped, equipped_slot FROM inventory WHERE equipped = 1 AND equipped_slot IS NULL').all();
console.log(JSON.stringify(anomalous, null, 2));
console.log("异常记录数: " + anomalous.length);

// 3. 按槽位统计
console.log('\n=== 3. 按槽位统计已装备物品 ===');
const bySlot = db.prepare('SELECT equipped_slot, COUNT(*) as cnt, GROUP_CONCAT(name) as items FROM inventory WHERE equipped = 1 GROUP BY equipped_slot').all();
console.log(JSON.stringify(bySlot, null, 2));

// 4. 查找同一槽位多件装备
console.log('\n=== 4. 同一槽位多件装备 ===');
const multiEquip = db.prepare('SELECT equipped_slot, COUNT(*) as cnt FROM inventory WHERE equipped = 1 AND equipped_slot IS NOT NULL GROUP BY equipped_slot HAVING cnt > 1').all();
console.log(JSON.stringify(multiEquip, null, 2));

db.close();
"@

$scriptFile = Join-Path $PSScriptRoot '_temp_query_equip.cjs'
$script | Out-File -FilePath $scriptFile -Encoding utf8

Push-Location (Join-Path $PSScriptRoot '..\packages\backend')
node $scriptFile
Pop-Location

Remove-Item $scriptFile -Force
