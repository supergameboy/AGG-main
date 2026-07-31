---
tool: challenge_service
method: check_combat_end
description: "检查战斗是否结束"
summary: "检查战斗是否结束"
since: "1.0"
---

# combat_service.check_combat_end

## 功能
检查当前战斗是否已经结束，以及结束原因和结算数据。战斗结束条件：所有敌人被击败（胜利）或角色HP降为0（失败）。用于在回合执行后判断是否需要调用 end_combat。

## 参数详解

无参数。系统自动检查当前战斗状态。

## 返回值
```typescript
{
  ended: boolean;       // 战斗是否已结束
  result?: CombatResult; // 结束时的结算数据（仅 ended=true 时存在）
}

interface CombatResult {
  victory: boolean;           // 是否胜利
  fled: boolean;              // 是否逃跑
  defeat: boolean;            // 是否失败
  permadeath?: boolean;       // 是否触发永久死亡（仅 defeat 时可能有）
  experience: number;         // 获得经验值（胜利时为敌人 expReward 总和）
  currency: Record<string, number>;  // 获得货币（胜利时为敌人 goldReward 总和）
  drops: Array<{ item: string; quantity: number }>;  // 掉落物品（当前始终为空数组）
  turnsElapsed: number;       // 战斗持续回合数 = turn + (round-1) × participants.length
  participantResults: ParticipantResult[];  // 参与者结算数据
}

interface ParticipantResult {
  id: string;
  name: string;
  isPlayer: boolean;
  finalHP: number;
  finalMP: number;
  survived: boolean;       // currentHP > 0
  damageDealt: number;     // 当前始终为0（未追踪）
  damageTaken: number;     // 当前始终为0（未追踪）
}
```

战斗未结束时：
```typescript
{
  ended: false;
}
```

## 注意事项
- 此方法为只读操作，不修改任何状态
- 胜利条件：所有敌人 currentHP ≤ 0
- 失败条件：所有玩家 currentHP ≤ 0
- 胜利时经验值 = 所有敌人的 expReward 总和，金币 = 所有敌人的 goldReward 总和
- 失败且模板配置 permadeath 为 true 时，CombatResult 包含 permadeath: true
- participantResults 中 damageDealt/damageTaken 当前始终为0（未实现追踪）
- 无活跃战斗时返回 `{ ended: false }`

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回 ended: false 但战斗已结束 | 战斗记录已被归档 | 检查 combat_states 表是否有记录 |
