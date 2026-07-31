---
tool: character_service
method: modify_currency
description: "修改角色货币(正数获得/负数花费)"
summary: "修改角色货币"
paramTypes:
  currencyId: "string (required) - 货币ID(如 gold, silver 等)"
  delta: "number (required) - 货币变化量"
since: "1.0"
---

# character_service.modify_currency

## 功能
修改角色指定货币的数量。正数表示获得，负数表示花费。货币值下限为0，不会出现负数。支持任意货币类型（gold/silver等），由currencyId指定。

## 参数详解

### currencyId（必填）
- **类型**: string
- **说明**: 货币类型ID，对应currency对象中的键名
- 示例：`gold`、`silver`、`copper`

### delta（必填）
- **类型**: number
- **说明**: 货币变化量。正数获得，负数花费。结果会被clamp到≥0
- 示例：
  - 获得50金币：currencyId=`"gold"`, delta=`50`
  - 花费30金币：currencyId=`"gold"`, delta=`-30`

## 返回值

```typescript
{
  currency: Record<string, number>;  // 更新后的全部货币，如 {gold: 120, silver: 50}
}
```

## 注意事项

1. 货币下限为0，花费超过余额时截断到0（不会报错）
2. 花费前应检查余额是否足够，此方法不自动检查
3. currencyId不存在时会自动创建该货币类型（初始0+delta）
4. modify_gold是此方法的别名（action映射，priority=5），统一走modify_currency

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Character not found | 存档无角色 | 先调用create_character |
| 花费后余额为0 | 传入的花费量超过余额 | 先用get_full_status查询currency，确认足够后再花费 |
