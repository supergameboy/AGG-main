---
tool: npc_service
method: modify_currency
description: "修改NPC的货币数量(正数增加，负数减少)"
summary: "修改NPC的货币数量"
paramTypes:
  npcId: "string (required) - NPC ID"
  currencyType: "string (required) - 货币类型，如 gold/silver"
  delta: "number (required) - 增减数量，正数增加，负数减少"
since: "1.0"
---

# npc_service.modify_currency

## 功能
修改NPC的货币数量。正数增加货币，负数减少货币。减少时如果余额不足会抛出错误。修改后返回NPC的完整货币余额。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: NPC ID，可使用 UUID、templateNpcId 或 NPC 名称

### currencyType（必填）
- **类型**: string
- **说明**: 货币类型，如 `gold`、`silver` 等
- **示例**: `"gold"`

### delta（必填）
- **类型**: number
- **说明**: 增减数量，正数增加，负数减少
- **示例**: 增加50金币传 `50`，减少30金币传 `-30`

## 返回值
```typescript
Record<string, number> // NPC的完整货币余额
// 示例:
{
  gold: 120,    // 金币余额
  silver: 50    // 银币余额
}
```

## 注意事项
- 此方法为写操作，会修改NPC的货币数据
- 减少货币时如果余额不足会抛出 `Insufficient currency` 错误
- 如果NPC之前没有该类型的货币，增加时会自动初始化为0再增加
- 货币余额不会变为负数
- 交易场景建议使用 `inventory_service.trade_items` 而非直接修改货币

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Insufficient currency | 减少量超过当前余额 | 先用 `get_npc` 查询NPC当前余额，确保减少量不超过余额 |
| NPC not found | npcId 不存在 | 使用 `list_npcs` 获取真实NPC ID |
| 必填参数缺失 | npcId/currencyType/delta 未提供 | 确保提供所有必填参数 |
