---
name: item-acquisition
description: 处理物品获取，优先从物品池取用，物品池无匹配时创建新物品，处理堆叠和扣款
targetAgent: ["inventory"]
trigger: [buy_item]
whenToUse: 战斗获得战利品、任务奖励物品、NPC赠礼、购买物品时
recommendedTools: [inventory_service, character_service]
relatedRules: [inventory-core]
completionCriteria: 物品已添加到背包、同类物品已堆叠、购买时货币已扣除、物品实例ID已返回
version: "3.0"
enabled: true
---

# 物品获取

## 任务是什么
将物品添加到角色背包，优先从物品池取用，物品池无匹配时创建新物品，处理同类物品堆叠逻辑，购买场景下扣除对应货币。

## 为什么有这个任务
物品获取是游戏核心循环的基础操作，需要确保物品正确入包、数量准确堆叠、购买时货币同步扣除。物品池机制让已有物品可被复用，避免重复创建。

## 完成的标准是什么
1. 物品已成功添加到背包，返回物品实例ID
2. 同类物品已正确堆叠（数量累加而非新增条目）
3. 购买场景下货币已扣除且余额非负
4. 返回添加后的物品信息和背包状态

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `inventory_service.list_inventory` — 查询当前背包，确认同类物品是否已存在
2. 调用 `inventory_service.add_item_from_pool` — 从物品池取用物品到背包（优先路径）
3. 调用 `inventory_service.add_item` — 物品池无匹配时创建新物品到背包（设 fromPool=true），备选路径
4. 调用 `character_service.modify_currency` — 购买场景下扣除货币
5. 调用 `inventory_service.check_item_quantity` — 验证物品添加结果

### 注意事项
- 优先调用 add_item_from_pool 从物品池取用，物品池无匹配时再使用 add_item 创建
- 使用 add_item 创建物品时设 fromPool=true，标记该物品来源于物品池外创建
- 添加物品前先查询背包，确认同类物品是否已存在以决定堆叠策略
- 购买场景必须先检查货币余额是否充足，不足时不应执行添加操作
- 任务奖励和NPC赠礼不需要扣除货币，跳过 modify_currency 步骤

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "物品获取完成",
  "data": {
    "items": [
      { "inventoryId": "string", "name": "string", "quantity": "number" }
    ],
    "fromPool": true,
    "currencyPaid": "number|null",
    "currencyRemaining": "number|null"
  }
}
```
