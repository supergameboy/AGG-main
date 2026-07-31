---
tool: quest_service
method: create_quest
description: "创建新任务(同时创建目标)。需要提供完整的任务信息，包括名称、描述、类型、目标和奖励。创建后状态为available，需要调用accept_quest接取。"
summary: "创建新任务"
paramTypes:
  quests: "array<object{name:string,description:string,type:string,giverNpcId:string,giverLocationId:string,questChainId:string,visible:boolean,prerequisiteQuestIds:array,conditions:object,rewards:object,objectives:array}> (required) - 要创建的任务列表"
since: "1.0"
---

# quest_service.create_quest

## 功能
创建新的任务，同时创建任务目标（objectives）。任务创建后状态为 `available`，需调用 `accept_quest` 接取后才能变为 `active`。适用于 GameMaster 动态生成新任务的场景。

**重要**: 必须提供完整的任务信息，包括名称、描述、类型、目标和奖励。系统不会从模板填充任何字段。

## 参数详解

### quests（必填）
- **类型**: array
- **说明**: 要创建的任务数组，每个元素包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 任务名称 |
| description | string | 是 | 任务描述，详细说明任务背景和要求 |
| type | string | 是 | 任务类型。可选：`main`/`side`/`daily`/`weekly`/`chain`/`repeatable` |
| giverNpcId | string | 否 | 发布任务的 NPC ID |
| visible | boolean | 否 | 是否对玩家可见，默认 `false`。设为 `true` 则玩家可见该任务 |
| rewards | array | 否 | 奖励列表，格式见下方 |
| objectives | array | 是 | 目标列表，格式见下方 |
| prerequisiteQuestIds | string[] | 否 | 前置任务ID数组，完成所有前置任务后才能接取此任务 |
| conditions | object | 否 | 条件对象，包含 `accept`（接取条件）和 `complete`（完成条件） |
| giverLocationId | string | 否 | 发布任务的地点ID |
| questChainId | string | 否 | 任务链ID，用于标识同一任务链中的任务 |

### rewards 结构化奖励对象
```typescript
{
  experience?: number;           // 经验值
  gold?: number;                 // 金币
  currency?: Record<string, number>;  // 其他货币，如 { "honor": 100 }
  items?: Array<{ itemId: string; itemName?: string; quantity: number }>;  // 物品奖励
  skills?: Array<{ skillId: string; skillName?: string }>;  // 技能奖励
}
```

### objectives 数组元素格式
```typescript
{ description: string, type: 'kill' | 'collect' | 'talk' | 'explore' | 'use_item' | 'craft', target: string, required?: number, eventTrigger?: { eventType: string, targetId?: string } }
```
- `required` 默认为 1
- `eventTrigger` 可选，配置后 EventBus 匹配事件时自动更新目标进度

## 返回值

```typescript
interface QuestDetail {
  id: string;                    // 自动生成的可读ID，如 quest_暗影初现_1779730545205
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'available';           // 创建后状态为 available，需调用 accept_quest 接取
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
- **创建后需手动接取**: 任务创建后状态为 `available`，需调用 `accept_quest` 接取后才能变为 `active`
- **必须提供完整信息**: `name`、`description`、`type`、`objectives` 为必填字段，根据游戏剧情和场景自行构造完整的任务信息
- `visible` 默认为 `false`，即创建的任务默认对玩家不可见，需设为 `true` 才能让玩家看到
- 任务ID由系统自动生成，格式为 `quest_{名称转snake_case}_{时间戳}`
- 如设置了 `prerequisiteQuestIds`，任务创建后状态可能为 `locked`，需前置任务完成后才会变为 `available`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 创建失败 | 缺少必填字段 | 确保 name、description、type、objectives 已填写 |
| 任务不可见 | visible 默认为 false | 如需玩家可见，显式传 `visible: true` |
| 任务状态为 locked | 设置了 prerequisiteQuestIds 且前置任务未完成 | 完成前置任务后任务会自动变为 available |
