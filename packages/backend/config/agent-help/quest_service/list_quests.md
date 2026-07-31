---
tool: quest_service
method: list_quests
description: "获取任务列表(支持状态筛选)"
summary: "获取任务列表"
paramTypes:
  statusFilter: "string (optional) - 状态筛选(available/active/completed/failed)"
  visibility: "string (optional) - 可见性过滤：不传=返回全部任务，\"visible\"=只返回玩家可见的任务"
since: "1.0"
---

# quest_service.list_quests

## 功能
获取当前存档中的任务列表，支持按状态和可见性筛选。返回的任务包含目标（objectives）、进度百分比（progressPercent）和可完成标志（canComplete）。

## 参数详解

### statusFilter（可选）
- **类型**: string
- **说明**: 按任务状态筛选。可选值：
  - `locked` — 已锁定的任务
  - `available` — 可接取的任务
  - `active` — 进行中的任务
  - `completed` — 已完成的任务
  - `failed` — 已失败的任务
- **默认行为**: 不传则返回所有状态的任务

### visibility（可选）
- **类型**: string
- **说明**: 按可见性筛选任务
  - 不传 — 返回全部任务（含可见和不可见）
  - `"visible"` — 只返回可见任务（`visible=true`），即玩家可见的任务
- **默认行为**: 不传时返回全部任务

## 返回值

```typescript
interface QuestDetail {
  id: string;                    // 任务ID，如 quest_暗影初现_1779730545205
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'locked' | 'available' | 'active' | 'completed' | 'failed';
  visible: boolean;              // 是否对玩家可见
  questChainId: string | null;   // 任务链ID
  prerequisiteQuestIds: string[]; // 前置任务ID列表
  conditions: {                  // 条件对象
    accept?: Record<string, unknown>;  // 接取条件
    complete?: Record<string, unknown>; // 完成条件
  };
  giverNpcId: string | null;
  giverLocationId: string | null; // 发布任务的地点ID
  rewards: QuestReward;           // 结构化奖励对象
  timeLimit: number;
  customData: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  objectives: QuestObjective[];  // 任务目标列表
  progressPercent: number;       // 进度百分比 0~100
  canComplete: boolean;          // 所有目标是否已完成
}

// QuestReward 结构化奖励
interface QuestReward {
  experience?: number;           // 经验值
  gold?: number;                 // 金币
  currency?: Record<string, number>;  // 其他货币，如 { "honor": 100 }
  items?: Array<{ itemId: string; itemName?: string; quantity: number }>;  // 物品奖励
  skills?: Array<{ skillId: string; skillName?: string }>;  // 技能奖励
}
```

## 注意事项
- 不传 visibility 时默认返回全部任务，传 `"visible"` 只返回玩家可见的任务
- 不传 statusFilter 时返回所有状态的任务，数据量可能较大，建议按需筛选
- 如只需获取特定状态的任务，也可使用专用方法 `get_active_quests` 或 `get_available_quests`
- 返回结果按创建时间升序排列

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 筛选条件无匹配任务 | 检查 statusFilter 值是否正确，或去掉筛选条件查看全部任务 |
| 看不到不可见任务 | 传了 visibility: "visible" | 不传 visibility 参数查看全部任务 |
| 状态筛选无效 | statusFilter 值不在允许范围内 | 使用 locked/available/active/completed/failed 之一 |
