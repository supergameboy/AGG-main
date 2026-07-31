---
tool: npc_service
method: update_goal
description: "更新NPC目标状态/优先级/进度"
summary: "更新NPC目标状态"
paramTypes:
  goalId: "string (required) - 目标ID"
  status: "string (optional) - 新状态: active/completed/abandoned/blocked/archived"
  priority: "number (optional) - 新优先级1-10"
  progress: "string (optional) - 进度描述"
since: "1.0"
---

# npc_service.update_goal

## 功能
更新NPC目标的状态、优先级或进度描述。用于跟踪目标的推进情况，标记目标完成、放弃或阻塞等状态变化。只需传入需要修改的字段，未传入的字段保持不变。

## 参数详解

### goalId（必填）
- **类型**: string
- **说明**: 目标ID，由 `create_goal` 返回的 goalId

### status（可选）
- **类型**: string
- **说明**: 新状态
- **可选值**: `active`（进行中）、`completed`（已完成）、`abandoned`（已放弃）、`blocked`（被阻塞）、`archived`（已归档）

### priority（可选）
- **类型**: number
- **说明**: 新优先级，范围1-10

### progress（可选）
- **类型**: string
- **说明**: 进度描述，记录目标推进情况

## 返回值
```typescript
{
  goalId: string;    // 目标ID
  updated: boolean;  // 是否更新成功
}
```

## 注意事项
- 此方法为写操作，会修改目标数据
- 只需传入需要修改的字段，未传入的字段保持原值
- 将状态设为 `completed` 表示目标达成，`abandoned` 表示NPC放弃该目标
- `blocked` 状态表示目标暂时无法推进，需要外部条件改变
- goalId 必须是 `create_goal` 返回的真实ID

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| goalId 必填 | 未提供 goalId | 使用 `get_goals` 获取目标ID后再更新 |
| 目标不存在 | goalId 无效 | 确认使用 `create_goal` 返回的真实 goalId |
| 无效状态值 | status 不在允许范围内 | 使用 active/completed/abandoned/blocked/archived 之一 |
