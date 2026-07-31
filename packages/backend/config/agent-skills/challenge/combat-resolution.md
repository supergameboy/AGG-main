---
name: combat-resolution
description: 处理战斗结束后的结算
targetAgent: ["combat"]
trigger: [combat_end]
whenToUse: 战斗结束（胜利、失败或逃跑）需要结算时
recommendedTools: [combat_service, numerical_service, inventory_service, character_service]
relatedRules: [combat-core, damage-calculation]
completionCriteria: 战斗已关闭、角色状态已同步、经验已计算、战利品已生成
version: "2.0"
enabled: true
---

# 战斗结算

## 任务是什么
战斗结束后进行完整结算，包括关闭战斗、同步角色状态、计算经验奖励、生成战利品并发放。

## 为什么有这个任务
战斗结束后需要将临时战斗状态持久化到角色数据，计算并发放经验与战利品奖励。这些操作涉及多个服务的协调调用，需要按固定顺序执行以确保数据一致性。

## 完成的标准是什么
1. 已通过 `combat_service.end_combat` 关闭战斗
2. 已通过 `combat_service.get_combat_log` 获取战斗日志
3. 若胜利，已通过 `numerical_service.calculate_experience` 计算经验奖励
4. 若胜利，已通过 `numerical_service.add_experience` 增加角色经验
5. 若胜利，已通过 `numerical_service.calculate_loot` 计算战利品
6. 若胜利，已通过 `inventory_service.add_item` 将战利品加入背包
7. 已通过 `character_service.modify_health` 同步角色HP/MP变化

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `combat_service.end_combat` — 关闭战斗，传入战斗结果
2. 调用 `combat_service.get_combat_log` — 获取完整战斗日志用于结算参考
3. 调用 `numerical_service.calculate_experience` — 计算经验奖励（仅胜利时）
4. 调用 `numerical_service.add_experience` — 增加角色经验值（仅胜利时）
5. 调用 `numerical_service.calculate_loot` — 计算战利品（仅胜利时）
6. 调用 `inventory_service.add_item` — 将战利品加入背包（仅胜利时）
7. 调用 `character_service.modify_health` — 同步角色HP变化
8. 调用 `character_service.modify_mana` — 同步角色MP变化

### 注意事项
- 必须先调用 `end_combat` 关闭战斗，再进行后续结算操作
- 失败或逃跑时不计算经验和战利品，但仍需同步角色HP/MP
- `calculate_loot` 的 `dropTable` 参数需要从敌人配置中获取，不是硬编码
- 战利品可能为空（掉落概率未命中），此时不需要调用 `add_item`
- 经验加成倍率需考虑队伍人数分摊等因素

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "战斗结算完成",
  "data": {
    "outcome": "victory|defeat|flee",
    "experienceGained": 0,
    "leveledUp": false,
    "loot": [],
    "healthAfter": { "hp": 0, "mp": 0 }
  }
}
```
