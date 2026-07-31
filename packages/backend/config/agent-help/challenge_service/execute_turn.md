---
tool: challenge_service
method: execute_turn
description: "执行一个回合(玩家行动+敌人AI反击)"
summary: "执行一个战斗回合"
paramTypes:
  action: "object{type:string,targetId:string,skillName:string,skillId:string,itemId:string} (required) - 玩家行动"
since: "1.0"
---

# combat_service.execute_turn

## 功能
执行一个战斗回合，包含玩家行动和敌人AI自动反击。系统根据行动类型执行相应逻辑（攻击/技能/防御），然后所有存活敌人按AI策略反击。每回合结束后自动推进回合/轮次、tick状态效果、重置防御姿态，并检查战斗是否结束。

## 参数详解

### action (required)
玩家行动对象，描述本回合玩家的行为。

**action.type** (required)：行动类型
- `attack`：普通攻击
- `skill`：使用技能（需配合 skillName）
- `defend`：防御姿态

注意：`item` 和 `flee` 类型在此方法中未实现，会抛出 "Unsupported player action type" 异常。请分别使用 `use_item_in_combat` 和 `flee_attempt` 方法。

**action.targetId** (optional)：目标ID
- 多敌人时指定攻击目标
- 不传则自动选择第一个存活的敌人

**action.skillName** (optional)：技能名称
- 当 type 为 `skill` 时必填
- 使用技能消耗资源（由技能 cost 数组定义，如 [{type:"mp",amount:10}]），资源不足时抛出错误

**action.itemId** (optional)：物品ID
- 当 type 为 `item` 时使用

示例：
```json
{"type": "attack", "targetId": "enemy-0"}
{"type": "skill", "skillName": "火球术", "targetId": "enemy-1"}
{"type": "defend"}
```

**兼容性说明**：action 也支持字符串格式（如 `"attack"`）和 `actionType` 字段（自动转换为 `type`）。

## 返回值
```typescript
{
  turnResults: TurnResult[];      // 本回合所有行动结果（玩家+敌人）
  combatState: (CombatState & { hint?: string }) | null;  // 战斗结束后的最新状态
  combatEnded: boolean;            // 战斗是否已结束
}

interface TurnResult {
  actorName: string;       // 行动者名称
  actionType: string;      // 行动类型(attack/skill/defend/item)
  targetName?: string;     // 目标名称
  damage?: number;         // 造成伤害
  healed?: number;         // 治疗量
  effect?: string;         // 效果描述(如技能名/defense_boosted)
  isCritical?: boolean;    // 是否暴击
  killed?: boolean;        // 是否击杀目标
  logMessage: string;      // 可读的行动描述
}
```

## 注意事项
- 玩家行动后先检查战斗是否结束，若已结束则跳过敌人反击
- 使用技能需消耗资源（由技能 cost 数组定义），资源不足时抛出错误
- 技能伤害 = (攻击力×skill_base_damage_factor + 攻击力×attack_contribution) × skill_damage_multiplier
- 敌人AI：有技能时按 skill_use_chance(默认30%) 概率使用技能，否则普通攻击
- 每回合结束后自动 tick 所有参与者的状态效果（2次：玩家行动后1次，敌人行动后1次）
- 每回合结束后重置所有参与者的 isDefending 为 false
- 战斗自动结束时（全灭）会调用 finalizeCombat 更新角色HP/MP/体力等资源并清理战斗记录

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| action.type 必填 | action 缺少 type 字段 | 传入 {type: "attack/skill/defend/item/flee"} |
| skillName is required | type 为 skill 但未传 skillName | 补充 skillName 字段 |
| Not enough resource | 角色资源不足（MP/HP/体力等） | 先检查角色资源，或使用其他行动 |
| No valid targets | 所有敌人已死亡 | 战斗应已结束，检查战斗状态 |
| Combat is not active | 战斗已结束 | 不应再调用 execute_turn |
