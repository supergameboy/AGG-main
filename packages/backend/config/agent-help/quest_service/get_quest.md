---
tool: quest_service
method: get_quest
description: "获取任务详情(含目标和进度)"
summary: "获取任务详情"
paramTypes:
  quests: "array<object{questId:string}> (required) - 要获取的任务列表"
since: "1.0"
---

# quest_service.get_quest

## 功能
根据任务ID获取任务的详细信息，包括任务目标（objectives）、进度百分比（progressPercent）和可完成标志（canComplete）。支持多种ID格式解析。

## 参数详解

### quests（必填）
- **类型**: array
- **说明**: 要查询的任务ID数组，每个元素为包含 `questId` 字段的对象
- **questId 解析顺序**: 主键ID → 名称精确匹配 → 名称模糊匹配

**示例**:
```json
[
  { "questId": "quest_暗影初现_1779730545205" },
  { "questId": "medieval-fantasy__defeat-shadow" }
]
```

## 返回值

```typescript
interface QuestDetail {
  id: string;                    // 任务ID
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'locked' | 'available' | 'active' | 'completed' | 'failed';
  visible: boolean;
  giverNpcId: string | null;
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

interface QuestObjective {
  id: string;
  questId: string;
  description: string;
  type: 'kill' | 'collect' | 'talk' | 'explore' | 'use_item';
  target: string;
  required: number;
  current: number;
  completed: boolean;
}
```

## 注意事项
- 支持 questId、名称精确匹配、名称模糊匹配三种方式查询
- 查询不存在的任务会抛出错误，建议先通过 `list_quests` 确认任务存在
- 不要自行构造 questId，应从预加载上下文或其他任务查询方法的返回值中获取

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Quest not found | questId 不存在或格式错误 | 使用 list_quests 查看所有任务，确认 questId 有效性 |
| 缺少 quests 参数 | 未提供必填参数 | 必须传入包含 questId 的数组 |
