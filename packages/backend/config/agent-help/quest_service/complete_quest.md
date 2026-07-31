---
tool: quest_service
method: complete_quest
description: "完成任务(检查所有目标→发放奖励→状态变更)"
summary: "完成任务"
paramTypes:
  questId: "string (required)"
since: "1.0"
---

# quest_service.complete_quest

## 功能
完成指定任务。系统会检查所有任务目标是否已完成，若全部完成则发放奖励并将状态变更为 `completed`。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要完成的任务ID，可读ID格式（如 quest_暗影初现_1779730545205）
- **获取方式**: 从 `get_active_quests` 返回结果或预加载上下文中获取

## 返回值

```typescript
// 返回 QuestDetail，状态已变更为 completed
interface QuestDetail {
  id: string;
  name: string;
  status: 'completed';  // 完成后状态
  rewards: QuestReward;  // 结构化奖励对象
  // ... 其他字段同 list_quests 返回值
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
- 这是写操作，会修改游戏状态
- 只有状态为 `active` 的任务才能被完成
- 系统会自动检查所有 objectives 是否已达成，未全部达成则抛出错误
- **自动发放奖励**: 完成任务时会自动发放奖励到角色，支持经验、金币、货币、物品四种奖励类型
- 可先使用 `check_completion` 检查任务是否可完成
- 奖励发放逻辑：经验直接累加到角色 experience，金币/货币累加到角色 currency，物品添加到角色 inventory

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 任务目标未全部达成 | 存在未完成的 objectives | 先用 check_completion 检查，确保所有 objectives 已完成 |
| 任务不是 active 状态 | 任务状态不允许完成 | 只有进行中的任务才能完成 |
| questId 无效 | 传入了错误的 questId | 从 get_active_quests 获取正确的 questId |
