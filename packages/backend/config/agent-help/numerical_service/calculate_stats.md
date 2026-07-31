---
tool: numerical_service
method: calculate_stats
description: "重新计算并持久化派生属性(含装备加成)。支持角色(ownerType=character)和NPC(ownerType=npc)"
summary: "重新计算并持久化派生属性"
paramTypes:
  ownerType: "string (optional) - 所有者类型: character(默认) 或 npc"
  ownerId: "string (optional) - NPC ID(ownerType=npc时必填)"
returnType: "DerivedAttributes"
since: "1.0"
---

# numerical_service.calculate_stats

## 功能
重新计算并持久化派生属性（含装备加成）。读取基础属性，计算派生属性，叠加装备加成，写入数据库。支持角色和NPC两种所有者类型。

## 参数详解

### ownerType（可选）
- **类型**: string
- **说明**: 所有者类型
- **可选值**:
  - `character`（默认）— 角色
  - `npc` — NPC

### ownerId（可选）
- **类型**: string
- **说明**: NPC的ID。当 ownerType 为 `npc` 时必填

## 返回值
```typescript
interface DerivedAttributes {
  attack: number;       // 物理攻击力（含装备加成）
  defense: number;      // 物理防御力（含装备加成）
  speed: number;        // 速度（含装备加成）
  critRate: number;     // 暴击率（含装备加成）
  critDamage: number;   // 暴击伤害（含装备加成）
  dodgeRate: number;    // 闪避率（含装备加成）
  blockRate: number;    // 格挡率（含装备加成）
  magicAttack: number;  // 魔法攻击力（含装备加成）
  magicDefense: number; // 魔法防御力（含装备加成）
  maxHealth?: number;   // HP上限（含装备加成）
  maxMana?: number;     // MP上限（含装备加成）
  // 可能包含模板定义的其他派生属性
  [key: string]: number | undefined;
}
```

## 注意事项
- 此方法为写操作，会修改数据库中的派生属性、max_hp、max_mp 等字段
- 装备加成：自动读取已装备物品的 stats 字段，叠加到派生属性上
- 角色模式下会同时更新 base_max_hp/base_max_mp（不含装备）和 max_hp/max_mp（含装备）
- NPC 模式下会额外更新 current_hp/current_mp（不超过新上限）
- 装备变更后应调用此方法刷新属性
- 与 `calculate_derived_attributes` 的区别：本方法会持久化结果并叠加装备加成

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| "Character not found" | 角色未初始化 | 先执行角色初始化流程 |
| "NPC not found" | NPC ID不存在 | 使用 list_npcs 获取真实 NPC ID |
| "ownerId is required" | ownerType=npc 但未传 ownerId | ownerType 为 npc 时 ownerId 必填 |
