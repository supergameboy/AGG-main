---
name: execute-turn
description: 执行战斗中的一个回合
targetAgent: ["combat"]
trigger: [combat_turn]
whenToUse: 战斗中需要执行玩家行动和敌人反击时
recommendedTools: [combat_service, skill_service, inventory_service]
relatedRules: [combat-core]
completionCriteria: 回合行动已执行、伤害已计算、战斗状态已更新、回合结果已返回
version: "2.0"
enabled: true
---

# 执行战斗回合

## 任务是什么
在战斗中执行一个完整回合，包括解析玩家行动、执行行动、检查战斗状态、返回回合结果。

## 为什么有这个任务
战斗系统需要逐回合推进，每个回合涉及行动解析、技能冷却检查、物品使用、伤害计算和战斗结束判定，需要按固定流程调用多个服务完成。

## 完成的标准是什么
1. 玩家行动已通过 `combat_service.execute_turn` 执行
2. 若使用技能，已通过 `skill_service.check_cooldown` 检查冷却
3. 若使用物品，已通过 `combat_service.use_item_in_combat` 处理
4. 已通过 `combat_service.check_combat_end` 检查战斗是否结束
5. 回合结果包含：造成的伤害、受到的伤害、状态效果变化、战斗是否结束

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `combat_service.get_combat_state` — 获取当前战斗状态，确认战斗进行中
2. 调用 `skill_service.check_cooldown` — 检查技能是否可用（仅当行动类型为 skill 时）
3. 调用 `combat_service.execute_turn` — 执行回合行动
4. 调用 `combat_service.use_item_in_combat` — 战斗中使用消耗品（仅当行动类型为 item 时）
5. 调用 `combat_service.check_combat_end` — 检查战斗是否结束
6. 调用 `combat_service.get_combat_state` — 获取更新后的战斗状态

### 注意事项
- 行动类型为 `skill` 时，必须先调用 `skill_service.check_cooldown` 确认技能可用，冷却中则不可执行
- 行动类型为 `item` 时，通过 `combat_service.use_item_in_combat` 而非 `inventory_service.use_item` 使用物品
- 行动类型为 `flee` 时，`execute_turn` 内部会调用 `flee_attempt` 逻辑，无需单独调用
- 行动类型为 `defend` 时，`execute_turn` 内部会调用 `defend` 逻辑
- 每回合执行后必须调用 `check_combat_end`，若战斗已结束则不再继续下一回合

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "回合执行完成",
  "data": {
    "actionType": "attack|skill|defend|item|flee",
    "playerDamage": 0,
    "enemyDamage": 0,
    "statusEffects": [],
    "combatEnded": false,
    "combatEndReason": null
  }
}
```
