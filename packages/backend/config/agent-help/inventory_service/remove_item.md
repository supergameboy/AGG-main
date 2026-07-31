---
tool: inventory_service
method: remove_item
description: "移除背包中的物品(支持部分移除或全部删除)"
summary: "移除背包中的物品"
paramTypes:
  inventoryId: "string (required) - 背包物品唯一ID"
  quantity: "number (optional) - 移除数量(不传则删除全部)"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC的物品"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)"
since: "1.0"
---

# inventory_service.remove_item

## 功能
从角色或NPC的背包中移除物品，支持部分移除或全部删除。部分移除时仅减少数量，物品仍保留在背包中；全部删除时物品从背包中彻底移除。

## 参数详解

### inventoryId（必填）
- **类型**: string
- **说明**: 背包物品唯一ID，指定要移除的物品实例

### quantity（可选）
- **类型**: number
- **说明**: 移除数量
- **默认行为**: 不传时删除该物品的全部数量
- **部分移除**: 传入小于当前数量的值时，仅减少指定数量，物品保留在背包中

### ownerType（可选）
- **类型**: string
- **说明**: 拥有者类型，不传时默认为角色
- **可选值**: `"character"`（默认）、`"npc"`

### ownerId（可选）
- **类型**: string
- **说明**: 拥有者ID或名称，当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）

## 返回值
```typescript
InventoryItem | null
```

- **部分移除**: 返回更新后的 `InventoryItem`（quantity 已减少）
- **全部删除**: 返回 `null`

## 注意事项
- 移除数量等于或超过物品当前数量时，物品被彻底删除
- 移除操作不可逆，请确认后再执行
- 已装备的物品可以直接移除，无需先卸下
- 如需删除物品但保留记录，考虑使用 `update_item` 设置 `hidden: true`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 物品不存在 | inventoryId 无效 | 先用 `list_inventory` 获取有效的 inventoryId |
| 物品不属于指定拥有者 | ownerType/ownerId 与物品实际拥有者不匹配 | 确认物品归属或省略 ownerType/ownerId |
