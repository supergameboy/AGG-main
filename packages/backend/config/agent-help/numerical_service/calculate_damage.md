---
tool: numerical_service
method: calculate_damage
description: "计算伤害值(物理/魔法/真实/固定伤害)"
summary: "计算伤害值"
paramTypes:
  formula: "object (required) - 伤害公式配置。type:伤害类型(physical/magical/true/fixed), basePower:基础威力(数字), scaling:属性缩放数组(每个元素{attribute:属性名,multiplier:缩放倍率}), multiplier:总倍率, flatBonus:固定加成。例: {type:\"physical\",basePower:20,scaling:[{attribute:\"attack\",multiplier:0.5}]}"
  attackerLevel: "number (required) - 攻击者等级"
  defenderLevel: "number (required) - 防御者等级"
  attackerStat: "number (optional) - 攻击属性值"
  defenderDefense: "number (optional) - 防御值"
  resistance: "number (optional) - 抗性(0-1)"
  vulnerability: "number (optional) - 脆弱(0-1)"
returnType: "DamageResult"
since: "1.0"
---

# numerical_service.calculate_damage

## 功能
根据公式和参数计算伤害值。支持物理、魔法、真实和固定四种伤害类型，含暴击判定。纯计算方法，不会修改任何游戏状态。

## 参数详解

### formula（必填）
- **类型**: object
- **说明**: 伤害公式配置对象，定义伤害的计算方式
- **结构**:
  - `type`（string）— 伤害类型：`physical`（物理）、`magical`（魔法）、`true`（真实）、`fixed`（固定）
  - `basePower`（number）— 基础威力，默认10
  - `scaling`（Array<{attribute, multiplier}>，可选）— 属性缩放数组，每个元素包含 `attribute`（属性名）和 `multiplier`（缩放倍率）
  - `multiplier`（number，可选）— 总倍率乘数
  - `flatBonus`（number，可选）— 固定额外伤害
- **示例**:
```json
{
  "type": "physical",
  "basePower": 20,
  "scaling": [{"attribute": "attack", "multiplier": 0.5}]
}
```

### attackerLevel（必填）
- **类型**: number
- **说明**: 攻击者的等级，影响物理/魔法伤害的等级修正

### defenderLevel（必填）
- **类型**: number
- **说明**: 防御者的等级，影响物理/魔法伤害的等级修正

### attackerStat（可选）
- **类型**: number
- **说明**: 攻击属性值（如攻击力或法术强度），用于属性缩放计算

### defenderDefense（可选）
- **类型**: number
- **说明**: 防御者的防御值，用于物理/魔法伤害减免

### resistance（可选）
- **类型**: number
- **说明**: 抗性值，范围0-1。最终伤害乘以 (1 - resistance)

### vulnerability（可选）
- **类型**: number
- **说明**: 脆弱值，范围0-1。最终伤害乘以 (1 + vulnerability)

## 返回值
```typescript
interface DamageResult {
  finalDamage: number;       // 最终伤害（含暴击）
  baseDamage: number;        // 基础伤害（不含暴击）
  isCritical: boolean;       // 是否暴击
  criticalMultiplier: number; // 暴击倍率（暴击时1.5，非暴击时1）
  type: string;              // 伤害类型(physical/magical/true/fixed)
  breakdown: {
    formulaType: string;           // 公式类型
    basePower: number;             // 基础威力
    scaling?: Array<{attribute: string; multiplier: number}>; // 缩放配置
    resistanceApplied: number;     // 实际抗性
    vulnerabilityApplied: number;  // 实际脆弱
  };
}
```

## 注意事项
- 此方法为只读操作，纯数值计算，不修改任何游戏状态
- 不同伤害类型的计算逻辑不同：
  - `physical` — 受防御值减免，受等级差影响
  - `magical` — 受防御值减免，受等级差影响
  - `true` — 仅使用 basePower，不受防御和抗性影响
  - `fixed` — 仅使用 basePower，不受任何因素影响
- `true` 和 `fixed` 类型仍受 flatBonus、multiplier、resistance、vulnerability 影响
- 暴击率默认10%，暴击倍率默认1.5倍
- 最终伤害最低为1（Math.max(1, damage)）
- scaling 参数支持容错：LLM 传入对象 `{stat, ratio}` 时会自动转换为 `[{attribute, multiplier}]`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| "Invalid damage type" | type 不是有效枚举值 | 使用 physical/magical/true/fixed 之一 |
| "formula is required" | 未传入 formula 参数 | formula 为必填参数，必须为 object |
| 伤害始终为1 | basePower 过低或防御过高 | 检查 basePower 和 defenderDefense 的合理性 |
