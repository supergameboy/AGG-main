---
tool: quest_service
method: check_completion
description: "检查任务是否可以完成"
summary: "检查任务是否可完成"
paramTypes:
  questId: "string (required)"
since: "1.0"
---

# quest_service.check_completion

## 功能
检查指定任务是否满足完成条件（所有目标是否已达成）。这是只读操作，不会改变任务状态，用于在调用 `complete_quest` 之前确认任务是否可完成。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要检查的任务ID，可读ID格式（如 quest_暗影初现_1779730545205）
- **获取方式**: 从 `get_active_quests` 返回结果或预加载上下文中获取

## 返回值

```typescript
{
  questId: string;       // 任务ID
  canComplete: boolean;  // 是否可完成（所有目标是否已达成）
}
```

## 注意事项
- 这是只读操作，不会修改游戏状态
- 返回值为布尔标志，不包含未完成目标的详细信息
- 如需查看具体哪些目标未完成，请使用 `get_quest` 获取完整目标列表
- 建议在 `complete_quest` 之前调用此方法，避免因目标未达成而失败

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 检查失败 | questId 不存在 | 确认 questId 有效性 |
| canComplete 为 false | 存在未达成的目标 | 使用 get_quest 查看具体目标进度 |
