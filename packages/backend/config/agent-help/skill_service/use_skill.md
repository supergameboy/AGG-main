---
tool: skill_service
method: use_skill
description: "使用技能(检查冷却→检查资源→扣减多种资源→设置冷却→获得经验→计算伤害→传入targetId时自动扣减目标HP)。传入targetId后程序自动应用伤害到目标HP并返回targetApplied字段(newHp/maxHp)，LLM无需额外调用modify_health"
summary: "使用技能"
paramTypes:
  skillId: "string (required) - 技能ID"
  targetId: "string (optional) - 目标ID(可选，战斗中使用)。传入后程序按ID前缀自动识别character/npc并扣减目标HP：npc_开头或能解析为NPC→扣NPC的HP，否则→扣character的HP。返回targetApplied字段含newHp/maxHp，无需再调用modify_health"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC使用技能"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)"
since: "1.1"
---

# skill_service.use_skill

## 功能
使用指定技能，执行完整的技能使用流程：检查冷却→验证资源→扣减多种资源→设置冷却→获得经验→计算伤害和效果。这是技能使用的核心方法。

## 参数详解

### skillId（required）
- **类型**: string
- **说明**: 要使用的技能ID，支持三种格式：实例ID、技能池ID、技能名称
- **获取方式**: 从 `list_skills` 或 `get_skill` 返回结果中获取

### targetId（optional）
- **类型**: string
- **说明**: 技能目标ID（敌人、队友等）
- **不传**: 无目标技能（如增益自身、范围技能等）

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
// UseSkillResult
{
  success: boolean;           // 是否使用成功
  skill?: CharacterSkill;     // 使用后的技能实例（含更新后的经验值和冷却）
  damage?: number;            // 计算出的伤害值
  effectsApplied?: Array<{    // 应用的效果列表
    type: string;             // 效果类型（如 damage、heal、buff 等）
    value: number;            // 效果数值
    target: string;           // 效果目标（如 self、enemy 等）
  }>;
  expGained?: number;         // 获得的经验值
  costSpent?: SkillCostEntry[]; // 实际消耗的资源列表
  cooldownSet?: number;       // 设置的冷却值（回合数或毫秒）
  error?: string;             // 失败原因
}
```

## 注意事项
- 这是写操作，会修改游戏状态（资源、经验、冷却、effects）
- 使用前建议先通过 `check_cooldown` 确认技能可用
- 资源不足时使用失败，返回错误信息列出所有不足的资源
- 冷却中的技能无法使用
- 使用技能自动获得经验，经验公式：`10 * (1 + level * 0.1)`
- 伤害计算：base伤害 + 属性缩放加成 + effects中damage/power类型效果
- 冷却值来源：effects.cooldown_turns（回合制）或 effects.cooldown_ms（实时制），默认分别为 1 回合 / 3000ms
- none 模式下不设置冷却
- cost 支持多种资源消耗，使用时所有资源必须同时满足，否则全部不扣减

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Skill is on cooldown | 技能冷却中 | 等待冷却结束，或用 check_cooldown 检查 |
| 资源不足: 法力: 需要 X，当前 Y | 角色资源不够 | 等待资源恢复或使用恢复道具 |
| Skill not found | 技能ID不存在 | 从 list_skills 获取正确的技能ID |
| Character not found | 存档无角色记录 | 确认存档已初始化并创建了角色 |
