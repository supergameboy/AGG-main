---
tool: inventory_service
method: update_item
description: "更新物品属性(名称、描述、稀有度、类型、自定义数据)。enrich_data模式下用于丰富物品的中文描述和显示数据。quantity设为0时自动删除该物品"
summary: "更新物品属性"
paramTypes:
  updates: "array<object{inventoryId:string,name:string,description:string,quality:string,category:string,customData:object,quantity:number,visible:boolean,stats:object,effects:array,value:object,tags:array,ownerType:string,ownerId:string}> (required) - 要更新的物品列表"
since: "1.0"
---

# inventory_service.update_item

## 功能
更新背包中物品的属性，包括名称、描述、品质、分类和自定义数据。在 enrich_data 模式下常用于丰富物品的中文描述和显示数据。支持批量更新多个物品。当 quantity 设为 0 时，系统会自动删除该物品。

## 参数详解

### updates（必填）
- **类型**: array
- **说明**: 要更新的物品列表，支持批量更新
- **结构**: 数组中每个元素为对象，包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| inventoryId | string | 是 | 背包物品ID。可使用预加载上下文中的id（如 `item_生锈的铁剑_xxx`）或itemId或物品名称 |
| name | string | 否 | 物品名称（用户语言） |
| description | string | 否 | 物品描述（用户语言，100-200字） |
| rarity | string | 否 | 稀有度（common/uncommon/rare/epic/legendary） |
| type | string | 否 | 物品类型（weapon/armor/consumable/material/misc） |
| category | string | 否 | 物品分类（同type） |
| customData | object | 否 | 物品展示与机制数据 |
| quantity | number | 否 | 更新数量（设为0时自动删除该物品） |
| visible | boolean | 否 | 是否对玩家可见，设为true让玩家可见该物品 |
| stats | object | 否 | 更新物品属性加成（如 `{"attack":5,"defense":3}`） |
| effects | array | 否 | 更新物品效果（如 `["恢复50点HP"]`） |
| value | object | 否 | 更新物品价值（如 `{"buy":20,"sell":10,"currency":"gold"}`） |
| tags | array | 否 | 更新物品标签（如 `["可交易","可装备"]`） |
| ownerType | string | 否 | 拥有者类型：不传=默认角色(character)，"npc"=NPC的物品 |
| ownerId | string | 否 | 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID) |

**customData 推荐字段**:
- `displayType`: 展示类型（如"武器"/"防具"/"消耗品"）
- `displayRarity`: 展示稀有度（如"普通"/"优秀"/"精良"/"史诗"/"传说"）
- `displayStats`: 属性数组（如 `[{"key":"attack","label":"攻击力","value":"+15"}]`）
- `displayEffects`: 效果描述数组（如 `["攻击力+15","防御力+2"]`）
- `displayDescription`: 物品描述文本
- `displayValue`: 价值（如 `{"buy":120,"sell":60,"currency":"gold"}`）
- `tags`: 标签数组（如 `["可交易","可装备"]`）

**示例**:
```json
[
  {
    "inventoryId": "item_长剑_1779730545205",
    "name": "烈焰之剑",
    "description": "一把燃烧着永恒火焰的魔法长剑，剑身散发着灼热的光芒。",
    "stats": {"attack": 25, "fire_damage": 10},
    "tags": ["可装备", "火属性"],
    "customData": {
      "displayType": "魔法武器",
      "displayRarity": "稀有",
      "displayStats": [{"key":"attack","label":"攻击力","value":"+25"},{"key":"fire","label":"火焰伤害","value":"+10"}],
      "locale": "zh-CN"
    }
  }
]
```

## 返回值
```typescript
InventoryItem | null
```

- **正常更新**: 返回更新后的 `InventoryItem`
- **quantity=0 删除**: 返回 `null`

## 注意事项
- 只需传入需要修改的字段，未传入的字段保持不变
- `quantity: 0` 是删除物品的快捷方式，等同于 `remove_item` 全部删除
- `customData` 中的 `displayType`、`displayRarity`、`displayStats`、`displayEffects` 用于前端展示
- `visible: true` 可将不可见物品变为可见，常用于剧情道具揭示
- `inventoryId` 参数支持背包实例ID、物品模板ID（itemId）或物品名称，系统自动解析

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 物品不存在 | inventoryId 无效 | 先用 `list_inventory` 获取有效的物品ID |
| 物品被意外删除 | quantity 设为0 | 如非删除意图，不要设置 quantity 为0 |
| 物品不属于指定拥有者 | ownerType/ownerId 与物品实际拥有者不匹配 | 确认物品归属或省略 ownerType/ownerId |
