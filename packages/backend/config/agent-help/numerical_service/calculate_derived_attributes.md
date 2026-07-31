---
tool: numerical_service
method: calculate_derived_attributes
description: "根据基础属性计算派生属性"
summary: "计算派生属性"
paramTypes:
  attributes: "object (required) - 基础属性(模板定义的属性ID和值，如 {str: 12, dex: 10, int: 14, con: 11, wis: 8, cha: 10})"
returnType: "DerivedAttributes"
since: "1.0"
---

# numerical_service.calculate_derived_attributes

## 功能
根据基础属性计算派生属性。通过模板定义的属性角色映射（AttributeRoleMapping）将基础属性映射到角色属性（physical_power/agility/mental_power/endurance/perception/influence），再根据模板定义的派生公式计算结果。纯计算方法，不会修改任何游戏状态。

## 参数详解

### attributes（必填）
- **类型**: object
- **说明**: 基础属性键值对，键为模板定义的属性ID，值为属性数值
- **示例**:
```json
{
  "str": 15,
  "dex": 12,
  "con": 14,
  "int": 10,
  "wis": 8,
  "cha": 13
}
```

## 返回值
```typescript
interface DerivedAttributes {
  attack: number;       // 物理攻击力
  defense: number;      // 物理防御力
  speed: number;        // 速度
  critRate: number;     // 暴击率
  critDamage: number;   // 暴击伤害
  dodgeRate: number;    // 闪避率
  blockRate: number;    // 格挡率
  magicAttack: number;  // 魔法攻击力
  magicDefense: number; // 魔法防御力
  maxHealth?: number;   // HP上限
  maxMana?: number;     // MP上限
  // 可能包含模板定义的其他派生属性
  [key: string]: number | undefined;
}
```

## 注意事项
- 此方法为只读操作，纯数值计算，不修改任何游戏状态
- 派生属性的具体公式由游戏模板定义，不同模板可能有不同的公式和结果
- 属性ID必须与模板定义一致，否则对应属性不会被纳入计算（默认值为10）
- 通常在创建角色或更新基础属性后调用此方法获取最新的派生属性
- 如需重新计算并持久化派生属性（含装备加成），请使用 `calculate_stats` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 派生属性值偏低 | attributes 中无匹配的属性ID | 使用模板定义的标准属性ID（如 str, dex, con 等） |
| 结果不符合预期 | 属性值过低或过高 | 检查输入的基础属性值是否合理 |
