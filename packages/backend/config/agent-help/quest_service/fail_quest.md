---
tool: quest_service
method: fail_quest
description: "标记任务失败"
summary: "标记任务失败"
paramTypes:
  questId: "string (required)"
since: "1.0"
---

# quest_service.fail_quest

## 功能
将指定任务标记为失败，状态从 `active` 变为 `failed`。适用于任务失败条件触发时（如超时、关键NPC死亡等）。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要标记失败的任务ID，可读ID格式（如 quest_暗影初现_1779730545205）
- **获取方式**: 从 `get_active_quests` 返回结果或预加载上下文中获取

## 返回值

```typescript
// 返回 QuestDetail，状态已变更为 failed
interface QuestDetail {
  id: string;
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'failed';
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
- 这是写操作，会修改游戏状态
- 只有状态为 `active` 的任务才能被标记为失败
- 任务失败后不可恢复，请谨慎使用
- 建议先使用 `check_fail_conditions` 检查失败条件是否满足
- 失败任务不会发放奖励

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 任务不是 active 状态 | 只有进行中的任务才能标记为失败 | 确认任务当前状态 |
| questId 无效 | 传入了错误的 questId | 从 get_active_quests 获取正确的 questId |
