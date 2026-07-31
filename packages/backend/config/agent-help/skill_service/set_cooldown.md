---
tool: skill_service
method: set_cooldown
description: "设置技能冷却剩余时间(ms或回合数,取决于冷却系统类型)"
summary: "设置技能冷却时间"
paramTypes:
  skillId: "string (required) - 技能ID"
  remaining: "number (required) - 冷却剩余值(时间制为毫秒,回合制为回合数)"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC的技能"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)"
since: "1.1"
---

# skill_service.set_cooldown

## 功能
设置技能的冷却剩余时间。根据冷却系统类型，remaining 参数的单位可能是毫秒（实时制）或回合数（回合制）。适用于 GameMaster 需要手动调整技能冷却的场景。

## 参数详解

### skillId（required）
- **类型**: string
- **说明**: 要设置冷却的技能ID，支持三种格式：实例ID、模板ID、技能名称
- **获取方式**: 从 `list_skills` 或 `get_skill` 返回结果中获取

### remaining（required）
- **类型**: number
- **说明**: 冷却剩余时间
  - 实时制（time）：毫秒数（如 30000 表示 30 秒）
  - 回合制（turn）：回合数（如 3 表示 3 回合）
  - 无冷却制（none）：设置无效，技能始终可用
- **设为 0**: 立即清除冷却，技能可立即使用
- **负数处理**: 系统自动取 `Math.max(0, remaining)`，负数等同于 0

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
// 返回更新后的 CharacterSkill
{
  id: string;
  saveId: string;
  skillId: string;
  name: string;
  description: string;
  level: number;
  maxLevel: number;
  experience: number;
  cooldownRemaining: number;  // 更新后的冷却剩余值
  category: SkillCategory;
  element: SkillElement;
  cost: SkillCostEntry[];
  effects: Record<string, unknown>;
  customData: Record<string, unknown>;
  unlocked: boolean;
  hidden: boolean;
  ownerType: OwnerType;
  ownerId: string;
}
```

## 注意事项
- 这是写操作，会修改游戏状态
- 通常技能使用后系统会自动设置冷却，此方法用于手动调整
- 冷却系统类型由全局配置决定（turn/time/none），不是技能级别配置
- none 模式下设置冷却无实际效果

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Skill not found | 技能ID不存在 | 确认使用正确的技能ID |
| 单位混淆 | 实时制传了回合数或反之 | 根据当前冷却系统类型使用正确的单位 |
