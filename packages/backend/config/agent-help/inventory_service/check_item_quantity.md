---
tool: inventory_service
method: check_item_quantity
description: "检查背包中指定物品的总数量(按item_id汇总)"
summary: "检查背包中物品数量"
paramTypes:
  itemId: "string (required) - 物品模板ID"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC的物品"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)"
since: "1.0"
---

# inventory_service.check_item_quantity

## 功能
检查背包中指定物品的总数量，按物品模板ID（item_id）汇总计算。同一模板ID的物品可能分布在多个背包槽位（因堆叠上限），此方法会汇总所有槽位的数量。

## 参数详解

### itemId（必填）
- **类型**: string
- **说明**: 物品模板ID，用于标识物品种类
- **注意**: 这是物品模板ID，不是背包实例ID（inventoryId）

### ownerType（可选）
- **类型**: string
- **说明**: 拥有者类型，不传时默认查询角色的物品
- **可选值**: `"character"`（默认）、`"npc"`

### ownerId（可选）
- **类型**: string
- **说明**: 拥有者ID或名称，当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）

## 返回值
```typescript
{
  itemId: string;     // 物品模板ID
  quantity: number;   // 背包中该物品的总数量
}
```

**示例**:
```json
{
  "itemId": "item_治疗药水_1779730545205",
  "quantity": 15
}
```

## 注意事项
- 此方法为只读操作，不会修改背包数据
- `itemId` 是物品模板ID，与 `inventoryId`（背包实例ID）不同
- 同一物品可能因堆叠上限而分布在多个槽位，此方法汇总所有槽位的数量
- 物品不在背包中时返回数量为0

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回数量为0 | 物品不在背包中或 itemId 错误 | 确认 itemId 是否正确，用 `list_inventory` 检查 |
| 混淆ID类型 | 使用了 inventoryId 而非 itemId | 使用物品模板ID（itemId），不是背包实例ID |
