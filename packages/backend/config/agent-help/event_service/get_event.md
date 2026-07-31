---
tool: event_service
method: get_event
description: "获取单个事件详情"
summary: "获取单个事件详情"
paramTypes:
  eventId: "string (required) - 事件模板ID（events表中的ID，如\"shadow-creature-attack\"，不是story_events的UUID）"
since: "1.0"
---

# event_service.get_event

## 功能
获取指定事件模板的详细信息，包括事件定义、触发条件、效果等。适用于在触发事件前了解事件内容，或在事件处理过程中查看事件的具体配置。

## 参数详解

### eventId（必填）
- **类型**: string
- **说明**: 要查询的事件模板ID（events表中的ID）
- **来源**: 从 `list_event_templates` 返回的模板列表中获取
- **注意**: 此ID是events表中的模板ID（如"shadow-creature-attack"），不是story_events表中的UUID

## 返回值

```typescript
{
  id: string;           // 事件模板ID
  templateId: string;   // 模板来源ID
  name: string;         // 事件名称
  description: string;  // 事件描述
  type: EventType;      // 事件类型: random | conditional | story | time_based | location | combat | quest
  triggerType: TriggerType; // 触发器类型: enter_location | combat_end | combat_start | quest_complete | quest_fail | time_reached | relation_change | low_health | discover_location
  triggerData: Record<string, unknown>; // 触发条件数据
  effects: EventEffect[];   // 事件效果列表
  priority: number;     // 优先级/权重
  repeatable: boolean;  // 是否可重复触发
  cooldown: number;     // 冷却时间(秒)
}

// EventEffect 结构
{
  type: 'modify_stat' | 'give_item' | 'spawn_enemy' | 'change_weather' | 'dialogue_trigger' | 'quest_unlock';
  params: Record<string, unknown>;
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- eventId 必须是有效的事件模板ID，不存在的事件将返回错误
- 此方法返回的是事件模板的定义信息，不是已触发事件的实例状态
- 如需查看已触发事件的状态，请使用 `get_pending_triggers` 或 `get_trigger_history`

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| eventId 缺失 | 未传入必填参数 eventId | 必须传入有效的事件模板ID |
| 事件不存在 | 传入的 eventId 无对应事件 | 通过 list_event_templates 确认有效的事件ID |
