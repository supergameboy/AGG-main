---
tool: numerical_service
method: add_experience
description: "为角色增加经验值(经验足够时自动完成升级，无需再调用process_level_up)"
summary: "为角色增加经验值"
paramTypes:
  amount: "number (required) - 增加的经验量"
since: "1.0"
---

# numerical_service.add_experience

## 功能
为角色增加指定量的经验值。系统会自动检测是否达到升级条件，如满足则自动触发升级处理（含属性成长和派生属性重算），无需再手动调用升级方法。

## 参数详解

### amount（必填）
- **类型**: number
- **说明**: 要增加的经验量，必须为正数

## 返回值
```typescript
{
  leveledUp: boolean;   // 是否触发了升级
  newLevel?: number;    // 升级后的新等级（仅 leveledUp=true 时存在）
}
```

## 注意事项
- 此方法为写操作，会修改角色的经验值，可能修改等级和属性
- amount 必须为正数，负数应使用其他方式扣除经验
- 自动检测升级条件，经验达到升级阈值时自动执行完整升级流程：
  1. 等级 +1
  2. 基础属性按成长值增加
  3. 派生属性重算（含装备加成）
  4. HP/MP上限更新，HP和MP恢复到新上限
- 建议先用 `calculate_experience` 计算合理经验量，再调用此方法添加

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| "Character not found" | 角色未初始化 | 先执行角色初始化流程 |
| 经验未增加 | amount 为0或负数 | amount 必须为正数 |
