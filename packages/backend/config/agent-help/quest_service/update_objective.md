---
tool: quest_service
method: update_objective
description: "更新目标进度(增量模式，自动clamp 0~required)"
summary: "更新任务目标进度"
paramTypes:
  objectiveId: "string (required)"
  delta: "number (required) - 增量值(可正可负)"
since: "1.0"
---

# quest_service.update_objective

## 功能
更新任务目标的进度，采用增量模式。传入正数增加进度，传入负数减少进度，进度值会自动钳制在 0 到 required 之间。

## 参数详解

### objectiveId（必填）
- **类型**: string
- **说明**: 要更新的目标ID
- **获取方式**: 从 `get_quest` 返回的 objectives 列表中获取

### delta（必填）
- **类型**: number
- **说明**: 进度增量值
  - 正数：增加进度
  - 负数：减少进度
- **自动钳制**: 进度值会自动限制在 `0 ~ required` 范围内，无需担心溢出

## 返回值

```typescript
interface QuestObjective {
  id: string;
  questId: string;
  description: string;
  type: 'kill' | 'collect' | 'talk' | 'explore' | 'use_item';
  target: string;
  required: number;
  current: number;       // 更新后的当前进度
  completed: boolean;    // current >= required 时为 true
}
```

## 注意事项
- 这是写操作，会修改游戏状态
- objectiveId 必须是有效的目标ID，可通过 `get_quest` 获取
- 增量模式意味着在当前进度基础上加减，而非设置绝对值
- 进度不会低于 0 或超过 required 值
- 更新目标进度不会自动完成任务，需调用 `complete_quest`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Objective not found | objectiveId 不存在 | 通过 get_quest 获取有效的 objectiveId |
| 进度未达预期 | delta 值计算错误 | 注意 delta 是增量而非绝对值 |
| 任务未完成 | 目标进度已满但未调用完成 | 所有目标完成后需调用 complete_quest |
