---
tool: skill_service
method: check_cooldown
description: "检查技能是否可用(冷却是否结束,返回冷却类型和剩余值)。支持通配符查询：ownerType=\"all\"时返回所有拥有者的冷却状态(数组)"
summary: "检查技能冷却状态"
paramTypes:
  skillId: "string (required) - 技能ID"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC的技能，\"all\"=所有拥有者(仅查询类支持，返回数组)"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称)；ownerType为all时忽略"
since: "1.1"
---

# skill_service.check_cooldown

## 功能
检查指定技能是否可用（冷却是否已结束）。返回冷却类型和剩余时间，便于判断技能是否可以立即使用。支持三种冷却系统模式：回合制（turn）、实时制（time）和无冷却（none）。

## 参数详解

### skillId（required）
- **类型**: string
- **说明**: 要检查冷却的技能ID，支持三种格式：实例ID、模板ID、技能名称
- **获取方式**: 从 `list_skills` 或 `get_skill` 返回结果中获取

### ownerType（optional）
- **类型**: string
- **说明**: 拥有者类型
- **可选值**: `"character"`（默认）、`"npc"`、`"all"`（仅查询类支持，返回所有拥有者的冷却状态数组）

### ownerId（optional）
- **类型**: string
- **说明**: 拥有者ID或名称
- **必填条件**: 当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）；ownerType 为 `"all"` 时忽略

## 返回值

```typescript
// 默认（ownerType 不传或为 character/npc）
{
  available: boolean;           // 技能是否可用（冷却是否结束）
  remaining: number;            // 剩余冷却值
  cooldownType?: CooldownSystemType;  // 冷却系统类型
}

// ownerType="all" 时返回数组
Array<{
  available: boolean;
  remaining: number;
  cooldownType?: CooldownSystemType;
  ownerId: string;              // 拥有者ID
  ownerType: string;            // 拥有者类型
}>

// CooldownSystemType = 'turn' | 'time' | 'none'
// - turn: 回合制，remaining 为剩余回合数
// - time: 实时制，remaining 为剩余毫秒数
// - none: 无冷却，available 始终为 true，remaining 始终为 0
```

## 注意事项
- 此方法为只读操作，不会修改游戏状态
- 建议在使用技能前调用此方法检查冷却状态
- 如果技能可用（available=true），可安全调用 `use_skill`
- none 模式下所有技能始终可用，不受冷却限制
- 冷却系统类型由全局配置决定，非技能级别配置
- `ownerType="all"` 时返回所有拥有者的冷却状态数组（含 ownerId/ownerType 字段），ownerId 参数被忽略

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Skill not found | 技能ID不存在 | 确认使用正确的技能ID |
| 技能不可用 | 冷却尚未结束 | 等待冷却结束，remaining 字段显示剩余时间 |
