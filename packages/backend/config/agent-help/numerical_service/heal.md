---
tool: numerical_service
method: heal
description: "治疗角色(恢复HP和MP)"
summary: "治疗角色"
paramTypes:
  amount: "number (required) - 治疗量(HP恢复100%, MP恢复50%)"
since: "1.0"
---

# numerical_service.heal

## 功能
治疗角色，恢复HP和MP。HP恢复量为治疗量的100%，MP恢复量为治疗量的50%（向下取整）。HP和MP恢复不会超过各自的上限。

## 参数详解

### amount（必填）
- **类型**: number
- **说明**: 治疗量
- **效果**:
  - HP恢复 = amount（不超过 max_hp）
  - MP恢复 = Math.floor(amount × 0.5)（不超过 max_mp）

## 返回值
```typescript
{
  amount: number;          // 传入的治疗量
  healthHealed: number;    // 实际恢复的HP量
  manaRestored: number;    // 实际恢复的MP量
  newHealth: number;       // 恢复后的当前HP
  newMana: number;         // 恢复后的当前MP
}
```

## 注意事项
- 此方法为写操作，会修改角色的HP和MP
- HP和MP恢复不会超过各自的上限（max_hp / max_mp）
- amount 必须为正数
- MP恢复量为 amount 的50%并向下取整，即 amount=100 时，HP恢复100，MP恢复50
- 如需精确控制HP或MP的恢复量，可使用 `character_service.modify_health` 和 `character_service.modify_mana`
- 使用数据库事务保证原子性

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| "Character not found" | 角色未初始化 | 先执行角色初始化流程 |
| 恢复量小于预期 | HP/MP已接近上限 | 检查角色当前HP/MP和上限值 |
