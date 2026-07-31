---
tool: event_service
method: trigger_event
description: "触发事件(仅登记event_triggers，已确认事实在resolve_trigger时归档)"
summary: "触发事件"
paramTypes:
  eventId: "string (required) - 要触发的事件ID（必须是events表中的事件模板ID，如\"shadow-creature-attack\"，不是story_events的UUID。使用list_event_templates或get_active_events查看可用事件ID）"
  context: "object (optional) - 触发上下文数据"
since: "1.0"
---

# event_service.trigger_event

## 功能
触发指定的事件，在系统中登记一条事件触发记录（event_trigger）。此操作仅记录事件的触发，不会直接将事件结果写入故事事件。已确认的事实需要在后续通过 `resolve_trigger` 方法归档到 story_events 中。这种两阶段设计确保了事件结果的确认和归档可控。

## 参数详解

### eventId（必填）
- **类型**: string
- **说明**: 要触发的事件模板ID（events表中的ID）
- **来源**: 从 `list_event_templates` 或 `check_triggers` 获取
- **注意**: 必须是events表中的事件模板ID（如"shadow-creature-attack"），不是story_events的UUID

### context（可选）
- **类型**: object
- **说明**: 触发时的上下文数据，存储在触发器的 resultData 中
- **示例**: `{ locationId: "loc-forest-001", npcId: "npc-hunter-001" }`
- **默认行为**: 不传时 resultData 为空对象 `{}`

## 返回值

```typescript
{
  id: string;              // 触发器ID（自动生成，格式: evt-{name}-xxx）
  saveId: string;          // 存档ID（自动注入）
  eventId: string;         // 关联的事件模板ID
  triggeredAt: number;     // 触发时间戳（毫秒）
  resolvedAt: null;        // 解决时间戳，触发时始终为null
  status: "pending";       // 状态，触发时始终为pending
  resultData: Record<string, unknown>; // 上下文数据（即传入的context）
}
```

## 注意事项
- 此方法为写操作，会创建一条待处理的触发器记录
- 触发事件不等于事件结果已归档，需后续调用 `resolve_trigger` 完成归档
- 触发后事件进入 pending 状态，可通过 `get_pending_triggers` 查看
- 同一事件可被多次触发，每次触发生成独立的触发器ID
- 建议在触发前先用 `check_triggers` 确认条件是否满足
- 触发器ID基于事件名称自动生成，格式为 `evt-{eventName}-xxx`

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| eventId 缺失 | 未传入必填参数 eventId | 必须传入有效的事件模板ID |
| 事件不存在 | 传入的 eventId 无对应事件 | 通过 list_event_templates 确认有效的事件ID |

## EventBus事件说明
trigger_event 本身不发布 EventBus 事件。只有 `resolve_trigger` 成功归档后，才会发布 `trigger_resolved` 事件通知 StoryKernel 更新故事投影。如果事件被归档为 story_event，还会额外发布 `story_progress` 事件。
