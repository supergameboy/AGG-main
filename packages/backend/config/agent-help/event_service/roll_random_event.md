---
tool: event_service
method: roll_random_event
description: "随机事件检定(基于权重概率)"
summary: "随机事件检定"
paramTypes:
  locationId: "string (required) - 当前地点ID"
  timePeriod: "string (required) - 时间段(morning/afternoon/evening/night)"
since: "1.0"
---

# event_service.roll_random_event

## 功能
基于权重概率进行随机事件检定。根据当前地点和时间段，从随机事件池中筛选匹配的事件，按 priority 作为权重进行加权随机抽取。如果命中事件，会自动调用 `trigger_event` 创建触发器记录。适用于在探索、移动等场景中随机触发事件，增加游戏的随机性和趣味性。

## 参数详解

### locationId（必填）
- **类型**: string
- **说明**: 当前角色所在的地点ID
- **用途**: 与事件 triggerData 中的 location_filter 字段匹配，筛选适用于当前地点的事件
- **影响**: 不同地点可能关联不同的随机事件池

### timePeriod（必填）
- **类型**: string
- **说明**: 当前游戏时间段
- **可选值**:
  - `morning` — 清晨/上午
  - `afternoon` — 下午
  - `evening` — 傍晚
  - `night` — 夜晚
- **用途**: 与事件 triggerData 中的 time_filter 字段匹配，筛选适用于当前时段的事件
- **影响**: 不同时段可能有不同的事件概率或专属事件

## 返回值

```typescript
{
  triggered: boolean;       // 是否成功触发事件
  eventId: string | null;   // 触发的事件ID（未触发时为null）
  eventName: string | null; // 触发的事件名称（未触发时为null）
  reason: string;           // 结果原因说明
  effects: EventEffect[];   // 事件效果列表（未触发时为空数组）
}

// EventEffect 结构
{
  type: 'modify_stat' | 'give_item' | 'spawn_enemy' | 'change_weather' | 'dialogue_trigger' | 'quest_unlock';
  params: Record<string, unknown>;
}
```

**触发成功时**:
- `triggered`: true
- `eventId`: 被选中事件的ID
- `eventName`: 被选中事件的名称
- `reason`: 如 "Rolled with weight 5"（说明命中时的权重值）
- `effects`: 事件的效果列表

**未触发时**:
- `triggered`: false
- `eventId`: null
- `eventName`: null
- `reason`: "No random events available"（无随机事件）或 "No events match current conditions"（无匹配条件的事件）
- `effects`: []

## 注意事项
- 此方法为写操作，如果触发事件将自动创建触发器记录（调用 `trigger_event`）
- 随机性意味着相同参数可能产生不同结果
- 某些地点/时段组合可能没有可用的随机事件，此时不会触发任何事件
- 触发的事件仍需通过 `resolve_trigger` 完成处理流程
- 权重由事件模板的 priority 字段决定，priority 越高被抽中的概率越大
- 仅筛选 type 为 `random` 的事件模板

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| locationId 或 timePeriod 缺失 | 未传入必填参数 | 必须同时传入地点ID和时间段 |
| 无效的时间段 | timePeriod 传入了非枚举值 | 使用 morning/afternoon/evening/night 之一 |
| 总是返回无事件 | 该地点/时段没有配置随机事件 | 检查事件模板配置是否正确，确认有 type=random 的事件 |
