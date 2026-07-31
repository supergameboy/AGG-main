---
tool: skill_service
method: get_skill
description: "获取技能详情(含等级/经验/冷却/效果)。支持通配符查询：ownerType=\"all\"时按技能名称查询返回所有拥有者的匹配记录(数组)"
summary: "获取技能详情"
paramTypes:
  skills: "array<object{skillId:string,ownerType:string,ownerId:string}> (required) - 要获取的技能列表"
since: "1.1"
---

# skill_service.get_skill

## 功能
获取一个或多个技能的详细信息，包括等级、经验值、冷却状态和效果列表。支持按实例ID、模板ID或技能名称查询。适用于需要查看特定技能完整信息的场景。

## 参数详解

### skills（required）
- **类型**: array
- **说明**: 要查询的技能数组，每个元素包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skillId | string | 是 | 技能ID，支持三种格式：实例ID、模板ID、技能名称 |
| ownerType | string | 否 | 拥有者类型：不传=默认角色(character)，"npc"=NPC的技能，"all"=所有拥有者(仅查询类支持，返回数组) |
| ownerId | string | 否 | 拥有者ID或名称：ownerType为npc时必传(可传NPC名称)；ownerType为all时忽略 |

- **skillId 查找顺序**: 系统依次按 实例ID → 模板ID(skill_id) → 技能名称(name) 查找
- **示例**: `[{ "skillId": "skill_斩击_1685500000000" }]` 或 `[{ "skillId": "medieval-fantasy__slash" }]` 或 `[{ "skillId": "斩击" }]`

## 返回值

```typescript
CharacterSkill | CharacterSkill[]
```

- **默认（ownerType 不传或为 character/npc）**: 返回单个 `CharacterSkill`
- **ownerType="all"**: 按技能名称查询时返回 `CharacterSkill[]`（所有拥有者的匹配记录）

```typescript
// CharacterSkill 结构
{
  id: string;                // 技能实例ID
  saveId: string;            // 存档ID
  skillId: string;           // 技能模板ID
  name: string;              // 技能名称
  description: string;       // 技能描述
  level: number;             // 当前等级
  maxLevel: number;          // 最大等级
  experience: number;        // 当前经验值
  cooldownRemaining: number; // 冷却剩余值
  category: SkillCategory;   // 技能类别
  element: SkillElement;     // 元素属性
  cost: SkillCostEntry[];      // 消耗数组
  effects: Record<string, unknown>;   // 技能效果
  customData: Record<string, unknown>; // 自定义数据
  unlocked: boolean;         // 是否解锁
  hidden: boolean;           // 是否隐藏
  ownerType: OwnerType;      // 拥有者类型
  ownerId: string;           // 拥有者ID
}
```

## 注意事项
- 此方法为只读操作，不会修改游戏状态
- 查询不存在的技能会返回错误（`success: false`），不会静默返回空结果
- skillId 支持三种格式，系统自动按优先级查找：实例ID > 模板ID > 技能名称
- 查询NPC技能时，需传入 ownerType="npc" 和 ownerId
- `ownerType="all"` 时按技能名称查询返回所有拥有者的匹配记录（数组），ownerId 参数被忽略

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Skill not found | 技能ID不存在 | 确认使用正确的ID，或使用 list_skills 查看已有技能 |
| 技能不属于指定拥有者 | ownerType/ownerId 与技能实际归属不匹配 | 检查 ownerType 和 ownerId 是否正确 |
| No character found | 存档无角色记录 | 确认存档已初始化并创建了角色 |
