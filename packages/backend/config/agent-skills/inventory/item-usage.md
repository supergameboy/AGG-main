---
name: item-usage
description: 使用物品并应用效果到角色
targetAgent: ["inventory"]
trigger: [use_item]
whenToUse: 玩家意图使用背包中的物品（intentHint=use_item）时
recommendedTools: [inventory_service, character_service]
relatedRules: [inventory-core]
completionCriteria: 物品已正确使用、效果已应用到角色、消耗品数量已扣减
version: "4.0"
enabled: true
---

# 物品使用

## 任务是什么
处理玩家使用背包中物品的请求，包括消耗品使用和效果应用，确保物品效果正确反映到角色属性上。

## 为什么有这个任务
物品使用涉及两个步骤：调用服务扣减物品数量/返回效果数据，然后根据效果类型调用角色服务应用效果。这两个步骤需要协调执行，否则效果不会生效。

## 完成的标准是什么
1. 消耗品已通过 inventory_service.use_item 使用，数量已扣减
2. 物品效果已根据返回的 effects 数据应用到角色
3. 物品不存在或不可使用时已返回明确提示

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `inventory_service.get_item` — 确认物品存在和类别
2. 调用 `inventory_service.use_item` — 使用消耗品，扣减数量并返回效果数据
3. 调用 `character_service.modify_health` — 应用治疗效果（当 effects 中含 heal 类型时）
4. 调用 `character_service.modify_mana` — 应用法力恢复效果（当 effects 中含 mana 类型时）

### 注意事项
- 仅 consumable 类别的物品可通过 use_item 使用，其他类别返回 success=false
- use_item 只扣减数量并返回效果数据，不会自动应用效果到角色属性
- 必须根据返回的 effects 手动调用 character_service 方法应用效果
- 战斗中使用消耗品应使用 combat_service.use_item_in_combat，而非 inventory_service.use_item
- 物品数量为0时自动从背包移除（consumed=true）

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "物品使用完成",
  "data": {
    "inventoryId": "string",
    "itemName": "string",
    "effectsApplied": [],
    "remainingQuantity": 0,
    "consumed": false
  }
}
```
