---
tool: event_service
method: list_event_templates
description: "获取事件模板列表(支持类型筛选)"
summary: "获取事件模板列表"
paramTypes:
  typeFilter: "string (optional) - 事件类型筛选(random/conditional/story/time_based/location/combat/quest)"
since: "1.0"
---

# event_service.list_event_templates

## 功能
获取当前存档中所有可用的事件模板列表，支持按事件类型进行筛选。事件模板定义了可触发事件的基本结构和触发条件。不传筛选参数时返回所有类型的事件模板。

## 参数详解

### typeFilter（可选）
- **类型**: string
- **说明**: 按事件类型筛选模板
- **可选值**:
  - `random` — 随机事件，基于权重概率触发
  - `conditional` — 条件事件，满足特定条件时触发
  - `story` — 故事事件，与主线剧情相关
  - `time_based` — 时间事件，基于游戏时间触发
  - `location` — 地点事件，进入特定地点时触发
  - `combat` — 战斗事件，与战斗相关
  - `quest` — 任务事件，与任务进度相关
- **默认行为**: 不传此参数时返回所有类型的事件模板

## 返回值

```typescript
{
  events: GameEvent[];  // 事件模板列表
  hint?: string;        // 无事件时的提示信息
}

// GameEvent 结构
{
  id: string;           // 事件模板ID
  templateId: string;   // 模板来源ID
  name: string;         // 事件名称
  description: string;  // 事件描述
  type: EventType;      // 事件类型: random | conditional | story | time_based | location | combat | quest
  triggerType: TriggerType; // 触发器类型
  triggerData: Record<string, unknown>; // 触发条件数据
  effects: EventEffect[];   // 事件效果列表
  priority: number;     // 优先级/权重
  repeatable: boolean;  // 是否可重复触发
  cooldown: number;     // 冷却时间(秒)
}

// EventEffect 结构
{
  type: 'modify_stat' | 'give_item' | 'spawn_enemy' | 'change_weather' | 'dialogue_trigger' | 'quest_unlock';
  params: Record<string, unknown>;
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 事件模板是事件的定义，不是已触发的事件实例
- 如需获取单个事件的详细信息，请使用 `get_event` 方法
- 如需查看哪些事件满足当前触发条件，请使用 `check_triggers` 方法
- 当无匹配事件时，返回 `hint` 字段提供提示信息

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 无匹配类型的事件模板 | 检查 typeFilter 值是否正确，或不传参数查看所有模板 |
| 无效的类型值 | typeFilter 传入了非枚举值 | 使用 random/conditional/story/time_based/location/combat/quest 之一 |
