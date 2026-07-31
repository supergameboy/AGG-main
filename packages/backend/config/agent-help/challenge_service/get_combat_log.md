---
tool: challenge_service
method: get_combat_log
description: "获取战斗日志"
summary: "获取战斗日志"
paramTypes:
  limit: "number (optional) - 返回条数上限(默认50)"
since: "1.0"
---

# combat_service.get_combat_log

## 功能
获取当前战斗的日志记录，包含所有已发生的战斗事件。用于回顾战斗过程、分析战斗数据或向玩家展示战斗详情。返回日志按时间正序排列，取最后 limit 条。

## 参数详解

### limit (optional)
返回条数上限，默认50。传入较小值可只获取最近的日志条目。

示例：
- 获取最近10条：`10`
- 获取全部（默认）：不传或传50

## 返回值
```typescript
{
  log: CombatLogEntry[];   // 日志条目列表（按时间正序，取最后limit条）
  totalEntries: number;    // 实际返回的日志条数（= log.length）
  hint?: string;           // 可选提示（无战斗时）
}

interface CombatLogEntry {
  turn: number;                    // 回合号
  round: number;                   // 轮次号
  actor: string;                   // 行动者（玩家名/敌人名/system/player）
  action: string;                  // 行动类型（combat_started/combat_ended/attack/skill/defend/item/flee）
  target?: string;                 // 目标名称
  result: Record<string, unknown>; // 行动结果详情
  timestamp: number;               // 时间戳
}
```

## 注意事项
- 日志按时间正序排列（最早的在前），使用 `slice(-limit)` 取最后 limit 条
- 无活跃战斗时返回空日志和 hint 提示
- totalEntries 是实际返回的条数（即 log.length），不是战斗总日志数
- 战斗结束后日志仍可查询，直到战斗记录被归档清理

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 战斗尚未开始 | 先调用 start_combat 开始战斗 |
