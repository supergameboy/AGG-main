---
name: trading
description: 处理玩家与NPC之间的买卖交易
targetAgent: [gamemaster]
trigger: [buy_item, sell_item]
whenToUse: 玩家想购买或出售物品、与商人NPC交易时
recommendedTools: [inventory_service, character_service, npc_service, entity_graph_service]
relatedRules: [trade-rules]
completionCriteria: 交易物品已交换、金币已结算、交易叙事已生成
version: "2.1"
enabled: true
---

# 交易处理

## 任务是什么
处理玩家与NPC之间的物品买卖交易，验证交易合法性，执行物品和金币的交换，维护NPC对玩家的感知关系，生成交易叙事。

> **模块2 简化**：NPC 关系数据已迁移到 `entity_graph_service.set_relationship`（PERCEIVES 边，-10~+10 语义化）。`npc_service.update_relation` 已删除，禁止调用。

## 为什么有这个任务
交易是玩家获取装备和消耗品的主要途径。交易涉及物品所有权的双向转移和金币结算，必须确保物品和金币的数量一致，防止出现物品消失或金币错误。没有交易管理，玩家无法通过商人NPC补充物资。

## 完成的标准是什么
1. `inventory_service.trade_items` 已被调用，sellItems 和 buyItems 参数与交易内容一致
2. `inventory_service.trade_items` 的 goldDelta 参数已正确计算（卖出收入 - 买入支出）
3. 交易后 `inventory_service.list_inventory` 中包含买入的物品，不包含卖出的物品
4. 若交易影响 NPC 对玩家的态度，`entity_graph_service.set_relationship` 已被调用更新感知关系
5. 交易叙事文本已通过 output Agent 生成并返回给玩家

## 怎么完成任务

### 调用什么子Agent派发什么任务
- 子Agent类型：output
- 派发任务描述：根据交易内容生成交易叙事
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "output",
    "task": "生成交易叙事",
    "action": "generate_narrative",
    "context": {
      "npcInfo": "<从npc_service.get_npc获取的商人NPC信息>",
      "buyItems": "<买入物品列表>",
      "sellItems": "<卖出物品列表>",
      "goldDelta": "<金币变化>",
      "currentLocation": "<当前位置信息>"
    }
  }
  ```

### 注入哪些条目的信息
1. 从 `npc_service.get_npc` 获取交易NPC的详情，确认NPC是否为商人类型，注入给 output Agent 用于交易场景描述
2. 从 `inventory_service.list_inventory` 获取玩家当前背包列表，用于验证卖出物品是否存在和计算可卖物品
3. 从 `character_service.get_full_status` 获取角色当前金币数量，用于验证买入支付能力

### 注意事项
1. 交易前必须确认交易对象是商人类型NPC，通过 `npc_service.get_npc` 获取NPC信息验证
2. 买入验证：玩家金币数量（从 `character_service.get_full_status` 获取）必须 >= 买入总金额
3. 卖出验证：卖出物品必须在玩家背包中（通过 `inventory_service.list_inventory` 验证 inventoryId 存在）
4. `inventory_service.trade_items` 一次调用完成买卖和金币结算：
   - sellItems：玩家卖出的物品数组（包含 inventoryId 和数量）
   - buyItems：玩家买入的物品数组（包含物品模板ID 和数量）
   - goldDelta：净金币变化（正数表示玩家获得金币，负数表示玩家支出金币）
5. 金币计算：goldDelta = 卖出物品总价 - 买入物品总价
6. 交易完成后如需更新 NPC 对玩家的态度，调用 `entity_graph_service.set_relationship`（observerType=npc, observerId=npcId, targetType=character, targetId=玩家ID, relationshipScore: +1~+2 友好交易）
7. 如果玩家金币不足以支付买入金额，向玩家说明余额不足并提示可卖物品

### 收到子Agent返回的结果之后执行什么操作
1. **判断交易是否成功**：检查 `inventory_service.trade_items` 返回结果是否成功，无错误标识
2. **交易成功后**：
   - 如需更新感知关系，调用 `entity_graph_service.set_relationship`（NPC→玩家方向，relationshipScore 在 +1~+2 范围内体现友好交易）
   - 派发 output Agent 生成交易叙事
3. **交易失败后**：
   - 如果金币不足，向玩家说明当前金币数量和所需金额，提示可卖物品
   - 如果物品不存在，向玩家说明背包中没有该物品
   - 如果NPC不是商人，向玩家说明该NPC不进行交易
4. **最终向玩家输出**：交易叙事文本，包含买卖物品明细、金币变化、NPC态度
