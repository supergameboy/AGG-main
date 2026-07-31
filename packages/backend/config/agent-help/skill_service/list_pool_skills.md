---
tool: skill_service
method: list_pool_skills
description: "查询技能池中的技能(可按学习状态和分类过滤)"
summary: "查询技能池中的技能列表"
paramTypes:
  learned: "boolean (optional) - 学习状态过滤：true=已学习, false=未学习, 不传=全部"
  category: "string (optional) - 按分类过滤(attack/defense/healing/buff/debuff/utility/passive)"
since: "1.1"
---

# skill_service.list_pool_skills

## 功能
查询技能池中的技能列表。技能池存储当前存档所有可学习的技能，支持按学习状态和分类过滤。

## 参数详解

### learned（optional）
- **类型**: boolean
- **说明**: 按学习状态过滤
- **可选值**:
  - 不传参数 — 返回全部技能
  - `true` — 只返回已学习的技能
  - `false` — 只返回未学习的技能

### category（optional）
- **类型**: string
- **说明**: 按技能分类过滤
- **可选值**: attack/defense/healing/buff/debuff/utility/passive

## 返回值

```typescript
// SkillPoolEntry[]
[{
  id: string;                // 技能池ID
  saveId: string;            // 存档ID
  name: string;              // 技能名称
  description: string;       // 技能描述
  category: string;          // 技能类别
  element: string;           // 元素属性
  cost: SkillCostEntry[];    // 消耗数组
  damage: Record<string, unknown>;  // 伤害定义
  effects: Array<Record<string, unknown>>; // 效果列表
  cooldown: number;          // 冷却回合
  maxLevel: number;          // 最大等级
  targetType: string;        // 目标类型
  range: number;             // 射程
  learned: boolean;          // 是否已学习
  customData: Record<string, unknown>; // 自定义数据
  recommendedClasses: string[]; // 推荐职业列表
}]
```

## 注意事项
- 此方法为只读操作，不会修改游戏数据
- 技能池是存档级别的，每个存档有独立的技能池
- 初始化时技能池会被填充，后续可通过 add_pool_skill 添加新技能
- 使用 learn_skill 从技能池学习技能

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 技能池为空 | 确认初始化已完成，或使用 add_pool_skill 添加技能 |
