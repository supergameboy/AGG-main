---
tool: event_service
method: get_pending_triggers
description: "获取待处理的触发列表"
summary: "获取待处理的触发列表"
since: "1.0"
---

# event_service.get_pending_triggers

## 功能
获取当前所有待处理（pending）的事件触发器列表。这些触发器已通过 `trigger_event` 创建但尚未通过 `resolve_trigger` 解决。适用于检查是否有需要处理的事件、了解待处理事件的数量和详情。

## 参数详解

此方法无需任何参数。

## 返回值

```typescript
{
  triggers: EventTrigger[];  // 待处理的触发器列表
  hint?: string;             // 无触发器时的提示信息
}

// EventTrigger 结构
{
  id: string;              // 触发器ID
  saveId: string;          // 存档ID
  eventId: string;         // 关联的事件模板ID
  triggeredAt: number;     // 触发时间戳（毫秒）
  resolvedAt: number | null; // 解决时间戳，待处理时为null
  status: "pending";       // 状态，始终为pending
  resultData: Record<string, unknown>; // 触发时的上下文数据
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 返回的触发器需要通过 `resolve_trigger` 方法进行处理
- 待处理触发器过多可能意味着事件处理流程存在阻塞
- 空列表表示没有待处理的事件触发器，此时返回 `hint` 字段提供提示
- 触发器按触发时间倒序排列（最新的在前）

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 无待处理的触发器 | 属正常情况，使用 check_triggers 检查是否有满足条件的事件 |
| 触发器堆积 | 触发后未及时解决 | 定期检查并使用 resolve_trigger 处理待处理触发器 |
