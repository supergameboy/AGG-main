---
tool: quest_service
method: lock_quest
description: "锁定任务(状态→locked)。前置条件未满足时使用"
summary: "锁定任务使其不可接取"
paramTypes:
  questId: "string (required)"
since: "1.0"
---

# quest_service.lock_quest

## 功能
锁定指定任务，将任务状态变为 `locked`。锁定后的任务不可被接取，需通过 `unlock_quest` 解锁后才能接取。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要锁定的任务ID
- **获取方式**: 从 `list_quests` 返回结果中获取

## 返回值

```typescript
interface QuestDetail {
  id: string;
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'locked';              // 锁定后状态为 locked
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
- 锁定通常由条件系统自动触发（前置任务未完成时自动锁定后续任务）
- 也可由GM通过 `update_quest` 手动设置 `status: 'locked'`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 锁定失败 | 任务已经是 locked 状态 | 确认任务当前状态，避免重复锁定 |
| questId 无效 | 传入了错误的 questId | 从 list_quests 获取正确的 questId |
