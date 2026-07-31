---
tool: inventory_service
method: get_equipment
description: "获取当前装备列表(按装备槽位排序)。支持通配符查询：ownerType=\"all\"时返回存档下所有拥有者(character+npc)的已装备物品"
summary: "获取角色当前装备列表"
paramTypes:
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=获取NPC装备，\"all\"=所有拥有者(仅查询类支持)"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)；ownerType为all时忽略"
since: "1.0"
---

# inventory_service.get_equipment

## 功能
获取角色或NPC当前所有已装备物品的列表，按装备槽位排序返回。可快速查看全身装备情况。
- **单槽位**：每个槽位最多1个物品
- **数组化槽位**（capacity>1，如 accessory 容量2）：同一槽位可返回多个物品，按 equippedIndex 升序排列（index=0 为最新/最前）

## 参数详解

### ownerType（可选）
- **类型**: string
- **说明**: 拥有者类型，不传时默认查询角色的装备
- **可选值**: `"character"`（默认）、`"npc"`、`"all"`（仅查询类支持，返回所有拥有者的装备）

### ownerId（可选）
- **类型**: string
- **说明**: 拥有者ID或名称，当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）；ownerType 为 `"all"` 时忽略

## 返回值
```typescript
{
  equipment: InventoryItem[];  // 已装备物品列表（数组化槽位含多个物品，按 equippedIndex 排序）
  hint?: string;               // 提示信息（无装备时返回建议）
}
```

**InventoryItem 关键字段**（详见 `list_inventory` 返回值中的完整字段说明）:

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 背包物品实例ID（如 `item_长剑_1779730545205`） |
| name | string | 物品名称 |
| category | string | 物品分类 |
| equippedSlot | string | 所在装备槽位（如 main_hand、body、accessory） |
| equippedIndex | number \| null | 数组化槽位的索引（0=最前/最新）；单槽位为 null |
| equipped | boolean | 是否已装备（始终为 true） |
| durability | number | 当前耐久度 |
| maxDurability | number | 最大耐久度 |
| customData | Record&lt;string, unknown&gt; | 自定义数据 |
| stats | Record&lt;string, number&gt; | 属性加成 |
| effects | ItemEffect[] | 效果数组 |
| value | ItemValue | 价值 |
| tags | string[] | 标签数组 |

## 注意事项
- 此方法为只读操作，不会修改装备状态
- 返回结果按装备槽位排序（equipped_slot 升序），数组化槽位内按 equippedIndex 升序
- 数组化槽位（accessory）可返回多个物品，每个物品有独立的 equippedIndex
- 空槽位不会出现在返回结果中
- 无装备时返回 `hint` 字段提示使用 `equip_item` 装备物品
- 如需查看背包中所有物品（含未装备的），请使用 `list_inventory`
- `ownerType="all"` 时返回所有拥有者（含角色和NPC）的装备，ownerId 参数被忽略

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 角色未装备任何物品 | — |
| 角色未找到 | ownerType/ownerId 未传且无角色记录 | 确保存档已初始化角色 |
