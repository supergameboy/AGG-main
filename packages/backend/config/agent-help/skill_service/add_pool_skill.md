---
tool: skill_service
method: add_pool_skill
description: "向技能池添加技能(不学习,仅注册到池中)"
summary: "向技能池添加技能"
paramTypes:
  name: "string (required) - 技能名称"
  description: "string (optional) - 技能描述"
  category: "string (optional) - 技能类别(attack/defense/healing/buff/debuff/utility/passive)"
  element: "string (optional) - 元素属性(fire/water/earth/wind/light/dark/physical/none)"
  cost: "array (optional) - 消耗数组(如[{type:\"mp\",amount:10}])"
  damage: "object (optional) - 伤害数据"
  effects: "array (optional) - 技能效果数组"
  cooldown: "number (optional) - 冷却时间"
  maxLevel: "number (optional) - 最大等级(默认10)"
  targetType: "string (optional) - 目标类型(single/multi/self/aoe)"
  range: "number (optional) - 技能范围(默认1)"
  customData: "object (optional) - 自定义数据"
  recommendedClasses: "array<string> (optional) - 推荐职业列表"
since: "1.1"
---

# skill_service.add_pool_skill

## 功能
向技能池添加技能，只添加不学习。添加后技能出现在技能池中，可通过 learn_skill 学习。

## 参数详解

### name（required）
- **类型**: string
- **说明**: 技能名称

### description（optional）
- **类型**: string
- **说明**: 技能描述

### category（optional）
- **类型**: string
- **说明**: 技能类别，默认 `"attack"`。可选值：attack/defense/healing/buff/debuff/utility/passive

### element（optional）
- **类型**: string
- **说明**: 元素属性，默认 `"physical"`。可选值：fire/water/earth/wind/light/dark/physical/none

### cost（optional）
- **类型**: array
- **说明**: 消耗数组，如 `[{type:"mp",amount:20}]`

### damage（optional）
- **类型**: object
- **说明**: 伤害数据

### effects（optional）
- **类型**: array
- **说明**: 效果列表

### cooldown（optional）
- **类型**: number
- **说明**: 冷却时间，默认 0

### maxLevel（optional）
- **类型**: number
- **说明**: 最大等级，默认 10

### targetType（optional）
- **类型**: string
- **说明**: 目标类型，默认 `"single"`。可选值：single/multi/self/aoe

### range（optional）
- **类型**: number
- **说明**: 技能范围，默认 1

### customData（optional）
- **类型**: object
- **说明**: 自定义数据

## 返回值

```typescript
interface SkillPoolEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  element: string;
  cost: number;
  damage: number;
  effects: object[];
  cooldown: number;
  maxLevel: number;
  targetType: string;
  range: number;
  customData: object;
  recommendedClasses: string[];
  source: string;
  learned: boolean;
}
```

## 注意事项
- 这是写操作，会修改游戏状态
- 添加的技能默认 learned=false，需要调用 learn_skill 学习
- 与 create_skill(learn=false) 效果相同，但 create_skill(learn=true) 可以一步完成添加+学习
- 技能池ID格式: `pool_{name}_{timestamp}`

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|------|------|---------|
| 添加失败 | 缺少必填字段 name | 确保 name 已填写 |
