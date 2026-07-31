---
tool: quest_service
method: get_available_chained_quests
description: "获取所有已解锁的可用链式任务(前置已完成)"
summary: "获取可接取的链式任务"
since: "1.0"
---

# quest_service.get_available_chained_quests

## 功能
获取所有已解锁且可接取的链式任务。这些任务的前置任务已经完成，玩家可以接取。适用于发现新的可接取任务链。

## 参数详解
无参数。

## 返回值

```typescript
// QuestChainInfo[]，只包含 isUnlocked 为 true 的任务
interface QuestChainInfo {
  questId: string;
  name: string;
  status: QuestStatus;
  prerequisiteId: string | null;
  prerequisiteName: string | null;
  prerequisiteCompleted: boolean;
  isUnlocked: boolean;  // 始终为 true
}
```

## 注意事项
- 这是只读操作，不会修改游戏状态
- 返回的任务都是前置条件已满足、可以立即接取的
- 与 `get_available_quests` 的区别：此方法额外检查前置任务解锁状态，返回所有已解锁的 available 任务（包括无前置任务的任务和前置已完成的链式任务）
- 如果没有已解锁的链式任务，返回空数组
- 前置任务关系通过 customData 中的 `prerequisite_quest_id` 字段定义

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空数组 | 没有已解锁的链式任务 | 继续完成当前任务以解锁后续任务链 |
