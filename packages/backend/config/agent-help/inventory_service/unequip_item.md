---
tool: inventory_service
method: unequip_item
description: "卸下装备回背包。ownerType为npc时必须传ownerId（可传NPC名称或ID，系统自动解析）"
summary: "卸下装备回背包"
paramTypes:
  inventoryId: "string (required) - 已装备物品的唯一ID"
  ownerType: "string (optional) - 拥有者类型：不传=当前角色(character)，\"npc\"=NPC。当为npc时必须传ownerId"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传（可传NPC名称或ID），ownerType为character时不传（自动从存档解析）"
since: "1.0"
---

# inventory_service.unequip_item

## 功能
将已装备的物品卸下，放回角色或NPC的背包。卸下后角色的派生属性会自动重算，装备槽位变为空。
- **单槽位**：槽位直接清空
- **数组化槽位**（capacity>1，如 accessory）：被卸下装备的 equippedIndex 释放，后续装备索引前移填补空位（保持数组紧凑，无空洞）

## 参数详解

### inventoryId（required）
- **类型**: string
- **说明**: 已装备物品的实例ID
- **获取方式**: 从 `get_equipment` 或 `list_inventory`（equipped=true 的物品）中获取

### ownerType（optional）
- **类型**: string
- **说明**: 拥有者类型
- **可选值**: `"character"`（默认）、`"npc"`
- **必填条件**: 当为 `"npc"` 时必须传 ownerId

### ownerId（optional）
- **类型**: string
- **说明**: 拥有者ID或名称
- **必填条件**: 当 ownerType 为 `"npc"` 时必传（可传NPC名称或ID，程序自动解析为完整ID）

## 返回值

```typescript
// InventoryItem — 卸下后的物品完整信息
{
  id: string;              // 物品实例ID
  name: string;            // 物品名称
  equipped: false;         // 已卸下
  equippedSlot: null;      // 槽位已清空
  equippedIndex: null;     // 数组化槽位索引已清空（卸下前为数字，卸下后为 null）
  // ... 其他字段
}
```

## 注意事项
- 物品必须处于装备状态（equipped=true），未装备的物品调用会返回失败
- ownerType="npc" 时必须传 ownerId，系统会校验归属一致性（不匹配抛错）
- 卸下后角色/NPC 属性加成自动重算：character 调用 `recalculateDerivedAttributes`，npc 调用 `recalculateNpcAttributes`
- 卸下的物品回到背包，自动分配空槽位
- 数组化槽位（accessory）卸下后，后续装备索引自动前移填补空位（保持数组紧凑）

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Item not found | 物品ID不存在 | 从 get_equipment 获取正确的 inventoryId |
| Item not equipped | 物品未处于装备状态 | 确认物品的 equipped=true |
| ownerId is required when ownerType is npc | ownerType=npc 但未传 ownerId | 补传 ownerId（NPC 名称或 ID） |
| Item does not belong to npc XXX | ownerId 与物品实际归属不匹配 | 检查物品实际 owner_id，传入正确的 ownerId |
