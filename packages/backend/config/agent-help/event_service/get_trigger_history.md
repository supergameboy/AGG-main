---
tool: event_service
method: get_trigger_history
description: "获取触发历史记录"
summary: "获取触发历史记录"
paramTypes:
  limit: "number (optional) - 返回数量限制(默认50)"
since: "1.0"
---

# event_service.get_trigger_history

## 功能
获取事件触发的历史记录，包含所有状态的触发器（pending/resolved/expired/failed）。适用于回顾事件触发情况、分析事件触发频率、调试事件系统等场景。

## 参数详解

### limit（可选）
- **类型**: number
- **说明**: 返回记录的数量上限
- **默认值**: 50
- **建议**: 历史记录可能较多，使用合理的 limit 值控制返回量

## 返回值

```typescript
// 返回 EventTrigger 数组
[
  {
    id: string;              // 触发器ID
    saveId: string;          // 存档ID
    eventId: string;         // 关联的事件模板ID
    triggeredAt: number;     // 触发时间戳（毫秒）
    resolvedAt: number | null; // 解决时间戳（未解决时为null）
    status: TriggerStatus;   // 状态: pending | resolved | expired | failed
    resultData: Record<string, unknown>; // 结果/上下文数据
  }
]
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 返回所有状态的触发记录，与 `get_pending_triggers` 仅返回 pending 状态的不同
- 与 `get_story_events` 不同，此方法返回的是触发器级别的记录，包括未归档的触发
- 记录按触发时间倒序排列（最新的在前）
- 如需查看仅待处理的触发器，使用 `get_pending_triggers` 方法

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 无触发历史记录 | 确认是否已有事件被触发 |
| 数据量过大 | limit 设置过大 | 使用合理的 limit 值（建议20-50） |
