---
tool: quest_service
method: get_quest_chain_info
description: "获取任务链信息(前置任务/解锁状态)"
summary: "获取任务链信息"
paramTypes:
  questId: "string (required)"
since: "1.0"
---

# quest_service.get_quest_chain_info

## 功能
获取指定任务的任务链信息，包括前置任务（prerequisite）和解锁状态。用于了解任务之间的前置依赖关系和当前解锁进度。注意：此方法只返回前置任务信息，不返回后续任务。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要查询的任务ID，可读ID格式（如 quest_暗影初现_1779730545205）
- **获取方式**: 从预加载上下文或任务查询方法返回结果中获取

## 返回值

```typescript
interface QuestChainInfo {
  questId: string;                    // 当前任务ID
  name: string;                       // 当前任务名称
  status: QuestStatus;                // 当前任务状态
  prerequisiteId: string | null;      // 前置任务ID（无前置则为 null）
  prerequisiteName: string | null;    // 前置任务名称
  prerequisiteCompleted: boolean;     // 前置任务是否已完成
  isUnlocked: boolean;                // 当前任务是否已解锁（无前置或前置已完成）
}
```

## 注意事项
- 这是只读操作，不会修改游戏状态
- **只返回前置任务信息，不返回后续任务**: 如需查找某任务的后续任务，需遍历其他任务的链信息
- 前置任务关系通过 customData 中的 `prerequisite_quest_id` 字段定义
- 如果没有前置任务，`prerequisiteId` 为 `null`，`isUnlocked` 为 `true`
- 前置任务不存在时，`prerequisiteCompleted` 为 `false`，`isUnlocked` 为 `false`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 查询失败 | questId 不存在 | 确认 questId 有效性 |
| isUnlocked 为 false | 前置任务未完成 | 先完成前置任务 |
| 无前置任务信息 | customData 中未设置 prerequisite_quest_id | 创建任务时在 customData 中设置前置任务ID |
