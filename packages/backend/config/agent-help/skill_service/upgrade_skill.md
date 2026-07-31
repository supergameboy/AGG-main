---
tool: skill_service
method: upgrade_skill
description: "升级技能(检查经验是否足够,计算属性加成)"
summary: "升级技能"
paramTypes:
  skillId: "string (required) - 技能ID"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC升级技能"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)"
since: "1.1"
---

# skill_service.upgrade_skill

## 功能
升级指定技能。系统会检查经验值是否充足，并自动计算属性加成。升级后技能等级提升，相关属性（如伤害加成、消耗减少等）按技能类别自动增长。

## 参数详解

### skillId（required）
- **类型**: string
- **说明**: 要升级的技能ID，支持三种格式：实例ID、模板ID、技能名称
- **获取方式**: 从 `list_skills` 或 `get_skill` 返回结果中获取

### ownerType（optional）
- **类型**: string
- **说明**: 拥有者类型
- **可选值**: `"character"`（默认）、`"npc"`

### ownerId（optional）
- **类型**: string
- **说明**: 拥有者ID或名称
- **必填条件**: 当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）

## 返回值

```typescript
// UpgradeSkillResult
{
  success: boolean;                    // 是否升级成功
  previousLevel: number;               // 升级前等级
  newLevel: number;                    // 升级后等级
  bonuses: Record<string, number>;     // 属性加成详情
  error?: string;                      // 失败原因
}

// bonuses 按技能类别不同：
// attack:   { powerBonus, costReduction }
// defense:  { defenseBonus, damageReduction }
// healing:  { healBonus, costReduction }
// passive:  { passiveBonus, effectDuration }
// buff:     { buffPower, buffDuration }
// debuff:   { debuffPower, debuffChance }
// utility:  { utilityBonus, cooldownReduction }
// 其他:     { genericBonus }
```

## 注意事项
- 这是写操作，会修改游戏状态
- 经验值不足时升级失败，返回 `success: false` 和具体所需经验值
- 技能已达到 maxLevel 时无法继续升级
- 升级消耗的经验值由系统配置的 upgrade_cost（base 和 multiplier）决定
- 升级后剩余经验 = 当前经验 - 升级所需经验
- 属性加成会累加到技能的 effects 中

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Not enough experience | 经验值不足 | 先通过战斗或使用技能积累经验 |
| Skill already at max level | 技能等级已达 maxLevel | 无法继续升级 |
| Skill not found | 技能ID不存在 | 从 list_skills 获取正确的技能ID |
