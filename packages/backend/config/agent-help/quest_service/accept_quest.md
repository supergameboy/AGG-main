---
tool: quest_service
method: accept_quest
description: "接取任务(状态available→active)"
summary: "接取任务"
paramTypes:
  questId: "string (required)"
since: "1.0"
---

# quest_service.accept_quest

## 功能
接取指定任务，将任务状态从 `available` 变为 `active`。受最大活跃任务数限制，当前活跃任务数已达上限时无法接取。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要接取的任务ID，可读ID格式（如 quest_暗影初现_1779730545205）
- **获取方式**: 从 `get_available_quests` 返回结果或预加载上下文中获取

## 返回值

```typescript
// 返回 QuestDetail，状态已变更为 active
interface QuestDetail {
  id: string;
  name: string;
  status: 'active';  // 接取后状态
  // ... 其他字段同 list_quests 返回值
}
```

## 注意事项
- 这是写操作，会修改游戏状态
- 只有状态为 `available` 的任务才能被接取；`locked` 状态的任务必须先通过 `unlock_quest` 解锁后才能接取
- **最大活跃任务数限制**: 当前活跃任务数达到 YAML 配置中的 `max_active` 上限时，接取会失败并抛出错误
- 同一任务不能重复接取
- **条件检查**: 接取前会检查 `prerequisiteQuestIds`（前置任务是否已完成，程序化强制校验）；`conditions.accept` 仅供参考，LLM 根据游戏情境自主判断是否满足接取条件，不做程序化强制校验

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 接取失败：达到最大活跃任务数限制 | 当前活跃任务数已达上限 | 先完成或失败部分活跃任务 |
| 任务状态不是 available | 任务已被接取或处于 locked 状态 | 先通过 get_available_quests 确认任务可接取；locked 状态需先解锁 |
| 重复接取 | 任务已被接取 | 检查任务当前状态，避免重复操作 |
| questId 无效 | 传入了无效的 questId | 从 get_available_quests 获取正确的 questId |
| 前置任务未完成 | prerequisiteQuestIds 中的任务尚未完成 | 先完成前置任务 |
| 接取条件参考 | conditions.accept 为参考信息，非强制校验 | LLM 根据游戏情境自主判断是否满足接取条件 |
