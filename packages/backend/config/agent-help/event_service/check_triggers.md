---
tool: event_service
method: check_triggers
description: "检查满足条件的事件触发"
summary: "检查满足条件的事件触发"
paramTypes:
  eventType: "string (required) - 触发器类型(enter_location/combat_end/combat_start/quest_complete/quest_fail/time_reached/relation_change/low_health/discover_location)"
  context: "object (optional) - 上下文条件数据"
since: "1.0"
---

# event_service.check_triggers

## 功能
检查在当前上下文中哪些事件满足触发条件。根据指定的触发器类型和上下文数据，评估所有该类型的事件模板，返回每个事件的匹配状态和已有的触发器记录。适用于在特定场景（如进入地点、战斗结束）时检查是否有可触发的事件。

## 参数详解

### eventType（必填）
- **类型**: string
- **说明**: 触发器类型，指定在什么场景下检查触发条件
- **可选值**:
  - `enter_location` — 进入地点时检查
  - `combat_end` — 战斗结束时检查
  - `combat_start` — 战斗开始时检查
  - `quest_complete` — 任务完成时检查
  - `quest_fail` — 任务失败时检查
  - `time_reached` — 时间到达时检查
  - `relation_change` — 关系变化时检查
  - `low_health` — 低血量时检查
  - `discover_location` — 发现地点时检查

### context（可选）
- **类型**: object
- **说明**: 上下文条件数据，提供触发条件评估所需的额外信息
- **用途**: 与事件模板 triggerData 中的 conditions 字段进行键值匹配
- **示例**: `{ locationId: "loc-village-001" }` 或 `{ combatResult: "victory" }`
- **匹配逻辑**: context 中每个键值对必须与 triggerData.conditions 中对应键值完全一致，否则判定为不匹配

## 返回值

```typescript
{
  checks: Array<{
    eventType: string;      // 触发器类型
    matched: boolean;       // 是否匹配条件
    triggers: EventTrigger[]; // 该事件已有的非过期/非失败触发器列表
  }>;
  totalMatched: number;     // 总匹配数量
}

// EventTrigger 结构
{
  id: string;              // 触发器ID
  saveId: string;          // 存档ID
  eventId: string;         // 关联的事件ID
  triggeredAt: number;     // 触发时间戳
  resolvedAt: number | null; // 解决时间戳（未解决时为null）
  status: TriggerStatus;   // 状态: pending | resolved | expired | failed
  resultData: Record<string, unknown>; // 结果数据
}
```

## 注意事项
- 此方法为只读操作，不会触发任何事件
- 仅检查条件，不实际触发。如需触发事件，请使用 `trigger_event` 方法
- 不可重复触发的事件（repeatable=false）如果已有非过期/非失败的触发器，将被判定为不匹配
- context 中提供的信息越完整，条件评估越准确
- triggers 列表排除了 status 为 expired 或 failed 的触发器

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| eventType 缺失 | 未传入必填参数 eventType | 必须传入有效的触发器类型 |
| 返回空列表 | 当前上下文无满足条件的事件 | 检查 eventType 和 context 是否正确，或确认是否有该类型的事件 |
| 无效的 eventType | 传入了不支持的触发器类型 | 使用9种有效触发器类型之一 |
| matched 为 false | 事件不可重复且已有触发器 | 检查该事件是否已被触发过 |

## EventBus订阅触发
EventService已订阅EventBus的实时事件（kill/item_change/dialogue/location_enter/quest_update）。当这些事件发生时，EventService会自动检查触发条件。不需要在每次游戏操作后手动调用check_triggers。
