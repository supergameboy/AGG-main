---
tool: challenge_service
method: get_combat_state
description: "获取当前战斗状态"
summary: "获取当前战斗状态"
since: "1.0"
---

# combat_service.get_combat_state

## 功能
获取当前战斗的完整状态信息。优先从内存缓存读取，缓存未命中时从数据库加载。无活跃战斗时返回提示信息。适用于每次行动前了解战场局势，或在战斗中任何时刻查询当前状态。

## 参数详解

无参数。方法自动根据当前存档ID读取活跃战斗状态。

## 返回值

**有活跃战斗时**：返回完整 CombatState 及 hint 字段
```typescript
{
  // ...CombatState 所有字段
  hint?: string;  // 可选提示信息
}

interface CombatState {
  combatId: string;
  saveId: string;
  active: boolean;            // 战斗是否进行中
  turn: number;               // 当前回合号
  round: number;              // 当前轮次号
  currentActorIndex: number;  // 当前行动者索引
  participants: CombatParticipant[];  // 所有参与者状态
  log: CombatLogEntry[];      // 战斗日志
  startedAt: number;          // 开始时间戳
  lastActionAt: number;       // 最后行动时间戳
  combatType: string;         // 战斗类型
}
```

**无活跃战斗时**：
```typescript
{
  active: false;
  message: "No active combat";
  hint: "当前无进行中的战斗. 建议：使用 start_combat 开始新战斗";
}
```

## 注意事项
- 此方法为只读操作，不修改任何战斗状态
- 优先从内存缓存读取，缓存未命中时查询数据库并回填缓存
- 无活跃战斗时返回 hint 提示建议下一步操作

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回 active: false | 战斗尚未开始或已结束 | 先调用 start_combat 开始新战斗 |
