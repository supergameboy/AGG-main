---
tool: event_service
method: resolve_trigger
description: "解决事件触发，并在命中严格归档规则时写入 story_events"
summary: "解决事件触发"
paramTypes:
  triggerId: "string (required) - 触发器ID"
  resultData: "object (optional) - 结果数据"
since: "1.0"
---

# event_service.resolve_trigger

## 功能
解决（完成）一个待处理的事件触发器，将触发器状态从 pending 更新为 resolved，并记录结果数据。当事件满足严格归档规则时（事件类型为 story/quest，或效果中包含 quest_unlock），事件将被自动写入 story_events 进行永久归档。这是事件处理流程的第二阶段，配合 `trigger_event` 使用，确保事件结果经过确认后才归档。

## 参数详解

### triggerId（必填）
- **类型**: string
- **说明**: 要解决的触发器ID
- **来源**: 从 `trigger_event` 返回的 id，或从 `get_pending_triggers` 获取

### resultData（可选）
- **类型**: object
- **说明**: 事件的结果数据，描述事件的具体结果
- **示例**: `{ outcome: "success", reward: { gold: 100 }, description: "成功击退了强盗" }`
- **默认行为**: 不传时使用空对象 `{}`

## 返回值

```typescript
{
  id: string;              // 触发器ID
  saveId: string;          // 存档ID
  eventId: string;         // 关联的事件模板ID
  triggeredAt: number;     // 触发时间戳（毫秒）
  resolvedAt: number;      // 解决时间戳（毫秒），解决后为实际时间
  status: "resolved";      // 状态，解决后为resolved
  resultData: Record<string, unknown>; // 结果数据（即传入的resultData）
}
```

## 注意事项
- 此方法为写操作，会修改触发器状态并可能写入 story_events
- triggerId 必须是 pending 状态的触发器，已解决/已过期/已失败的触发器不能重复解决
- 严格归档规则：事件类型为 `story` 或 `quest`，或效果中包含 `quest_unlock` 类型时，自动归档到 story_events
- 归档的故事事件 importance 固定为 `major`
- 解决触发器后，该触发器从 pending 列表中移除
- 如需查看待处理的触发器，使用 `get_pending_triggers` 方法

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| triggerId 缺失 | 未传入必填参数 triggerId | 必须传入有效的触发器ID |
| 触发器不存在 | 传入的 triggerId 无对应记录 | 通过 get_pending_triggers 确认有效的触发器ID |
| 触发器非 pending 状态 | 触发器已解决/已过期/已失败 | 每个触发器只能解决一次，检查是否已处理 |

## EventBus通知
resolve_trigger成功后，EventBus会自动发布 trigger_resolved 事件通知StoryKernel，以及 story_progress 事件（如果有归档的story_event）。其他订阅者（如QuestService）也会收到通知。
