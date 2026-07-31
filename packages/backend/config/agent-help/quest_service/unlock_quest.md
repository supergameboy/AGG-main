---
tool: quest_service
method: unlock_quest
description: "解锁任务(状态→available)。前置条件满足后使用"
summary: "解锁任务使其可接取"
paramTypes:
  questId: "string (required)"
since: "1.0"
---

# quest_service.unlock_quest

## 功能
解锁指定任务，将任务状态从 `locked` 变为 `available`。解锁后任务可被接取。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要解锁的任务ID
- **获取方式**: 从 `list_quests({ statusFilter: "locked" })` 返回结果中获取

## 返回值

```typescript
interface QuestDetail {
  id: string;
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'available';           // 解锁后状态为 available
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
- 前置任务完成时，条件系统会自动调用此方法解锁后续任务
- 也可由GM手动调用

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 解锁失败 | 任务不是 locked 状态 | 确认任务当前状态，只有 locked 任务可解锁 |
| questId 无效 | 传入了错误的 questId | 从 list_quests({ statusFilter: "locked" }) 获取正确的 questId |
