---
tool: quest_service
method: get_quests_by_giver
description: "按发布者NPC查询任务"
summary: "按发布NPC查询任务"
paramTypes:
  npcId: "string (required) - NPC ID"
since: "1.0"
---

# quest_service.get_quests_by_giver

## 功能
根据发布者 NPC 查询该 NPC 发布的所有任务。适用于玩家与 NPC 对话时，查看该 NPC 关联的任务。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 发布任务的 NPC ID

## 返回值

```typescript
// Quest[]（注意：不含 objectives、progressPercent、canComplete）
interface Quest {
  id: string;
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
- 这是只读操作，不会修改游戏状态
- 返回的任务包含所有状态（available/active/completed/failed），不按状态筛选
- 返回的是 `Quest` 类型（不含目标和进度），如需详情请使用 `get_quest`
- 如果该 NPC 没有发布任何任务，返回空数组
- 结果按创建时间升序排列

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | npcId 不存在或该 NPC 没有关联任务 | 确认 npcId 正确，检查 NPC 是否有任务 |
