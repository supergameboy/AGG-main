---
tool: character_service
method: modify_mana
description: "修改角色MP(正数恢复/负数消耗)"
summary: "修改角色MP"
paramTypes:
  delta: "number (required) - MP变化量"
since: "1.0"
---

# character_service.modify_mana

## 功能
修改角色当前MP值。正数表示恢复法力，负数表示消耗法力。MP值会被限制在0到最大MP之间。适用于施法消耗、药水恢复、冥想回蓝等场景。

## 参数详解

### delta（必填）
- **类型**: number
- **说明**: MP变化量。正数恢复，负数消耗。结果会被clamp到[0, maxMP]范围
- 示例：
  - 消耗20点MP施法：`-20`
  - 药水恢复15点MP：`15`

## 返回值

```typescript
{
  previous: number;   // 修改前的MP值
  current: number;    // 修改后的MP值（已clamp到[0, max]）
  max: number;        // 最大MP值
}
```

## 注意事项

1. MP下限为0，上限为最大MP
2. 施法前应检查MP是否足够，此方法不自动检查
3. delta导致MP超过maxMP时截断到maxMP，低于0时截断到0
4. 实际变化量 = current - previous，可能因截断与delta不同

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Character not found | 存档无角色 | 先调用create_character |
| MP不足仍施法 | 此方法不检查MP是否足够 | 先用get_full_status查询当前MP，确认足够后再消耗 |
