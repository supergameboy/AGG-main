---
tool: quest_service
method: abandon_quest
description: "放弃任务(状态active→failed)。放弃后标记为failed，由Agent决定后续处理"
summary: "放弃任务"
paramTypes:
  questId: "string (required)"
since: "1.0"
---

# quest_service.abandon_quest

## 功能
放弃指定任务，将任务状态从 `active` 变为 `failed`。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要放弃的任务ID
- **获取方式**: 从 `get_active_quests` 返回结果或预加载上下文中获取

## 返回值

```typescript
void  // 无返回值，放弃操作不返回任务详情
```

## 注意事项
- 只有 `active` 状态的任务可以放弃
- 放弃后统一标记为 `failed`，由GM决定是否重新创建任务
- 主线任务和日常任务放弃后同样标记为 `failed`（不再重置为available）

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 放弃失败 | 任务不是 active 状态 | 确认任务当前状态，只有 active 任务可放弃 |
| questId 无效 | 传入了错误的 questId | 从 get_active_quests 获取正确的 questId |
