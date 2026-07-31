---
tool: quest_service
method: get_available_quests
description: "获取可接取的任务列表"
summary: "获取可接取的任务列表"
since: "1.0"
---

# quest_service.get_available_quests

## 功能
获取当前存档中所有状态为"可接取"（available）的任务列表。用于向玩家展示可以接受的新任务。

## 参数详解
无参数。

## 返回值

```typescript
// QuestDetail[]，同 list_quests 返回值结构
// 只包含状态为 available 的任务
interface QuestDetail {
  id: string;
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'available';
  visible: boolean;
  questChainId: string | null;
  prerequisiteQuestIds: string[];
  conditions: { accept?: Record<string, unknown>; complete?: Record<string, unknown> };
  giverNpcId: string | null;
  giverLocationId: string | null;
  rewards: QuestReward;
  timeLimit: number;
  customData: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  objectives: QuestObjective[];
  progressPercent: number;
  canComplete: boolean;
}
```

## 注意事项
- 此方法等同于 `list_quests({ statusFilter: "available" })`
- 可接取的任务表示玩家尚未接受但已解锁的任务
- 如果没有可接取的任务，返回空数组
- 返回的 questId 可用于 `accept_quest` 接取任务
- 注意：`create_quest` 创建的任务状态为 available，需调用 `accept_quest` 接取

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空数组 | 当前没有可接取的任务 | 可能需要完成前置任务才能解锁新任务，使用 `get_quest_chain_info` 查看任务链信息 |
