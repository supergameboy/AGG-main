---
tool: quest_service
method: get_active_quests
description: "获取进行中的任务列表"
summary: "获取进行中的任务列表"
since: "1.0"
---

# quest_service.get_active_quests

## 功能
获取当前存档中所有状态为"进行中"（active）的任务列表。调用时会自动检查超时条件，如果配置了超时失败规则（timeout），超时的任务会被自动标记为 `failed` 并从返回结果中排除。

## 参数详解
无参数。

## 返回值

```typescript
// QuestDetail[]，同 list_quests 返回值结构
// 只包含状态为 active 的任务
interface QuestDetail {
  id: string;
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'active';
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
- **自动检查超时**: 如果 YAML 配置中启用了超时失败规则（`fail_conditions` 包含 `timeout` 且 `time_system` 已启用），此方法会自动检查每个活跃任务的 `timeLimit`，超时的任务会被自动调用 `failQuest` 标记为失败
- 被自动失败的任务不会出现在返回结果中
- 此方法等同于 `list_quests({ statusFilter: "active" })`，但额外执行超时检查
- 如果没有进行中的任务，返回空数组
- 返回的任务 questId 为可读ID格式（如 quest_暗影初现_1779730545205），可用于 `get_quest` 获取详情

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空数组 | 当前没有进行中的任务 | 使用 `get_available_quests` 查看可接取的任务 |
| 任务数量比预期少 | 部分任务因超时被自动失败 | 使用 `list_quests({ statusFilter: "failed" })` 查看失败任务 |
