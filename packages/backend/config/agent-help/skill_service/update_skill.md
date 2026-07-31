---
tool: skill_service
method: update_skill
description: "更新技能的属性，包括customData"
summary: "更新技能属性"
paramTypes:
  updates: "array<object{skillId:string,name:string,description:string,customData:object,visible:boolean,ownerType:string,ownerId:string}> (required) - 要更新的技能列表"
since: "1.1"
---

# skill_service.update_skill

## 功能
更新技能的可修改属性。支持修改技能名称、描述、自定义数据和可见性。适用于修改技能的元信息、效果参数或自定义标记等场景。

## 参数详解

### updates（required）
- **类型**: array
- **说明**: 更新数组，每个元素包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skillId | string | 是 | 技能ID，支持实例ID、模板ID、技能名称 |
| name | string | 否 | 新的技能名称 |
| description | string | 否 | 新的技能描述 |
| customData | object | 否 | 自定义数据（整体替换，非合并） |
| hidden | boolean | 否 | 是否对玩家隐藏，设为 false 让玩家可见该技能 |
| ownerType | string | 否 | 拥有者类型：不传=默认角色(character)，"npc"=NPC的技能 |
| ownerId | string | 否 | 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID) |

- **skillId 获取方式**: 从 `list_skills` 或 `get_skill` 返回结果中获取，支持三种格式
- **部分更新**: 只需传入要修改的字段，未传入的字段保持不变

## 返回值

```typescript
// 返回更新后的 CharacterSkill
{
  id: string;
  saveId: string;
  skillId: string;
  name: string;               // 更新后的名称
  description: string;        // 更新后的描述
  level: number;
  maxLevel: number;
  experience: number;
  cooldownRemaining: number;
  category: SkillCategory;
  element: SkillElement;
  cost: SkillCostEntry[];
  effects: Record<string, unknown>;
  customData: Record<string, unknown>;  // 更新后的自定义数据
  unlocked: boolean;
  hidden: boolean;             // 更新后的可见性
  ownerType: OwnerType;
  ownerId: string;
}
```

## 注意事项
- 这是写操作，会修改游戏状态
- customData 为整体替换，不是合并更新——传入新值会完全覆盖旧值
- 不能通过此方法修改技能等级（请使用 `upgrade_skill`）
- 不能通过此方法修改冷却状态（请使用 `set_cooldown`）
- 不能通过此方法修改 category、element、cost、maxLevel、effects 等核心属性
- skillId 支持三种格式查找：实例ID > 模板ID > 技能名称

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Skill not found | 技能ID不存在 | 从 list_skills 获取正确的技能ID |
| 技能不属于指定拥有者 | ownerType/ownerId 与技能实际归属不匹配 | 检查 ownerType 和 ownerId 是否正确 |
| 等级未变更 | 尝试通过 update_skill 修改等级 | 使用 upgrade_skill 升级技能 |
| 冷却未变更 | 尝试通过 update_skill 修改冷却 | 使用 set_cooldown 设置冷却 |
