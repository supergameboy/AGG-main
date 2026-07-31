---
tool: challenge_service
method: calculate_damage
description: "伤害计算(纯计算，不修改状态)"
summary: "计算伤害值"
paramTypes:
  attacker: "object (required) - 攻击者CombatParticipant数据"
  defender: "object (required) - 防御者CombatParticipant数据"
  skill: "object (optional) - 技能信息(可选)"
returnType: "DamageBreakdown"
since: "1.0"
---

# combat_service.calculate_damage

## 功能
纯计算伤害值，不修改任何战斗状态。用于预判攻击效果、比较不同行动的伤害收益，或在战斗外进行伤害模拟。计算结果包含随机因素（暴击、伤害浮动），每次调用结果可能不同。

## 参数详解

### attacker (required)
攻击者的 CombatParticipant 数据，必须包含以下字段：

```json
{
  "attack": 30,
  "level": 5,
  "defense": 10,
  "isDefending": false,
  "speed": 12
}
```

核心字段：attack（攻击力，必填）、level（等级，必填）。defense 和 isDefending 属于 defender 参数，不是 attacker 的核心字段。

### defender (required)
防御者的 CombatParticipant 数据，结构与 attacker 相同。isDefending 字段影响减伤计算。

### skill (optional)
技能信息，影响伤害计算公式。不传则使用普通攻击公式。

```json
{"baseDamage": 60, "multiplier": 1.5}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| baseDamage | number? | 技能基础伤害（替代攻击力作为 baseDamage） |
| multiplier | number? | 技能倍率（默认1.0） |

## 返回值
```typescript
interface DamageBreakdown {
  baseAttack: number;        // 攻击者基础攻击力
  skillMultiplier: number;   // 技能倍率（无技能时为1.0）
  levelBonus: number;        // 等级差加成 = max(0, (attacker.level - defender.level) × level_bonus_factor)
  defenseReduction: number;  // 防御减免总量（含基础防御减免 + 防御姿态额外减免）
  variance: number;          // 随机浮动系数（0.9~1.1之间，3位小数）
  criticalMultiplier: number;// 暴击倍率（暴击时为配置值如1.5，否则1.0）
  finalDamage: number;       // 最终伤害值（向下取整）
  isCritical: boolean;       // 是否暴击
}
```

## 注意事项
- 此方法为纯计算，不会修改任何游戏状态
- 伤害计算公式：`finalDamage = floor((baseDamage × skillMult + attack × attack_contribution + levelBonus - defense × defense_reduction_coeff) × (1 - defendReduction) × variance × criticalMultiplier)`
  - 无技能时 baseDamage = attack，skillMult = 1.0
  - 有技能时 baseDamage = skill.baseDamage ?? (attack × skill_base_damage_factor)，skillMult = skill.multiplier ?? 1.0
  - defendReduction 仅在 defender.isDefending=true 时生效
- 最终伤害保底为1（`Math.max(1, reducedDamage)`）
- 暴击概率 = `critical_hit.threshold / 20`（默认 threshold=2，即10%）
- 暴击倍率由 `critical_hit.multiplier` 决定（默认1.5）
- 伤害浮动范围：`variance_min + random() × variance_range`（默认0.9~1.1）
- 所有数值参数由模板配置 damage_formula 和 critical_hit 决定

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 计算结果为1 | 攻击力过低或防御力过高 | 检查传入的属性值是否合理 |
| 伤害异常高 | 传入了不合理的属性值 | 检查属性值是否在正常范围内 |
