---
tool: skill_service
method: list_skills
description: "获取技能列表(含完整详情)。支持通配符查询：ownerType=\"all\"时返回存档下所有拥有者(character+npc)的技能"
summary: "获取角色技能列表"
paramTypes:
  visibility: "string (optional) - 可见性过滤：不传=只返回可见的技能，\"all\"=返回全部技能(含不可见)，\"not_visible\"=只返回不可见的技能"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC的技能，\"all\"=所有拥有者(仅查询类支持)"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)；ownerType为all时忽略"
since: "1.1"
---

# skill_service.list_skills

## 功能
获取角色的技能列表，包含技能的完整详情。通过 visibility 参数控制返回范围：默认只返回已掌握的技能，也可查看全部技能（含隐藏）或仅查看未学习的技能。支持查询NPC的技能。

## 参数详解

### visibility（optional）
- **类型**: string
- **说明**: 可见性过滤条件
- **可选值**:
  - 不传参数 — 仅返回已掌握的技能（hidden=false）
  - `"all"` — 返回所有技能，包括隐藏和未学习的
  - `"hidden"` — 仅返回未学习/隐藏的技能（hidden=true）
- **默认行为**: 不传此参数时仅返回已掌握的技能

### ownerType（optional）
- **类型**: string
- **说明**: 技能拥有者类型
- **可选值**: `"character"`（默认）、`"npc"`、`"all"`（仅查询类支持，返回所有拥有者的技能）
- **默认行为**: 不传时默认查询角色的技能

### ownerId（optional）
- **类型**: string
- **说明**: 技能拥有者ID或名称
- **必填条件**: 当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）；ownerType 为 `"all"` 时忽略
- **默认行为**: 不传时自动使用当前角色ID

## 返回值

```typescript
{
  skills: CharacterSkill[];  // 技能列表
  hint?: string;             // 提示信息（技能列表为空时返回建议）
}

// CharacterSkill 结构
{
  id: string;                // 技能实例ID（如 skill_斩击_1685500000000）
  saveId: string;            // 存档ID
  skillId: string;           // 技能模板ID（如 medieval-fantasy__slash）
  name: string;              // 技能名称
  description: string;       // 技能描述
  level: number;             // 当前等级
  maxLevel: number;          // 最大等级
  experience: number;        // 当前经验值
  cooldownRemaining: number; // 冷却剩余值（回合数或毫秒）
  category: SkillCategory;   // 技能类别
  element: SkillElement;     // 元素属性
  cost?: SkillCostEntry[];     // 消耗数组
  effects: Record<string, unknown>;   // 技能效果
  customData: Record<string, unknown>; // 自定义数据
  unlocked: boolean;         // 是否解锁
  hidden: boolean;           // 是否隐藏
  ownerType: OwnerType;      // 拥有者类型
  ownerId: string;           // 拥有者ID
}

// SkillCategory = 'attack' | 'defense' | 'healing' | 'buff' | 'debuff' | 'utility' | 'passive'
// SkillElement = 'fire' | 'water' | 'earth' | 'wind' | 'light' | 'dark' | 'physical' | 'none'
// OwnerType = 'character' | 'npc'
```

## 注意事项
- 此方法为只读操作，不会修改游戏数据
- 返回的 id 是实例ID（格式如 `skill_{name}_{timestamp}`），用于后续的技能操作（升级、使用、设置冷却等）
- skillId 是模板ID（如 `medieval-fantasy__slash`），仅在 `learn_skill` 时使用
- 技能列表为空时，返回 hint 字段提供操作建议
- 查询NPC技能时，ownerType 和 ownerId 必须同时传入
- `ownerType="all"` 时返回所有拥有者（含角色和NPC）的技能，ownerId 参数被忽略

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 确实无匹配技能 | 检查 visibility 参数，或尝试不传参数查看已掌握技能 |
| No character found | 存档无角色记录 | 确认存档已初始化并创建了角色 |
| NPC技能查询失败 | 未传 ownerId | ownerType 为 npc 时必须传入 ownerId |
