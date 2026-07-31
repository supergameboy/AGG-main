---
tool: character_service
method: modify_health
description: "修改角色HP(正数治疗/负数受伤)"
summary: "修改角色HP"
paramTypes:
  delta: "number (required) - HP变化量"
since: "1.0"
---

# character_service.modify_health

## 功能
修改角色当前HP值。正数表示治疗（恢复生命），负数表示受伤（扣除生命）。HP值会被限制在0到最大HP之间。适用于战斗受伤、治疗恢复、中毒扣血等场景。

## 参数详解

### delta（必填）
- **类型**: number
- **说明**: HP变化量。正数治疗，负数受伤。结果会被clamp到[0, maxHP]范围
- 示例：
  - 治疗10点：`10`
  - 受伤15点：`-15`
  - 大治疗术：`50`

## 返回值

```typescript
{
  previous: number;   // 修改前的HP值
  current: number;    // 修改后的HP值（已clamp到[0, max]）
  max: number;        // 最大HP值
}
```

## 注意事项

1. HP下限为0（角色死亡线），上限为最大HP
2. delta导致HP超过maxHP时截断到maxHP，低于0时截断到0
3. 此方法不触发死亡判定，需额外检查current是否为0
4. 实际变化量 = current - previous，可能因截断与delta不同

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Character not found | 存档无角色 | 先调用create_character |
| HP为0后未处理 | 此方法不触发死亡判定 | 每次受伤后检查返回的current是否为0 |
