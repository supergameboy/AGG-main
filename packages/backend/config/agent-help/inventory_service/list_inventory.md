---
tool: inventory_service
method: list_inventory
description: "获取背包列表(含物品完整详情、数量、耐久度、装备状态)。支持通配符查询：ownerType=\"all\"时返回存档下所有拥有者(character+npc)的物品"
summary: "获取角色完整背包列表"
paramTypes:
  visibility: "string (optional) - 可见性过滤：不传=只返回背包中可见的物品，\"all\"=返回全部物品(含不可见)，\"visible\"=只返回可见的物品"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC的背包，\"all\"=所有拥有者(仅查询类支持)"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)；ownerType为all时忽略"
since: "1.0"
---

# inventory_service.list_inventory

## 功能
获取角色或NPC的完整背包列表，返回每个物品的详细信息，包括物品属性、数量、耐久度和装备状态。支持通过可见性参数过滤结果，控制是否包含隐藏物品。

## 参数详解

### visibility（可选）
- **类型**: string
- **说明**: 按物品可见性过滤结果
- **可选值**:
  - 不传参数 — 仅返回背包中可见的物品（默认行为，visible=1）
  - `"all"` — 返回全部物品，包括可见和不可见的
  - `"visible"` — 仅返回可见的物品
- **默认行为**: 不传时只返回玩家可见的物品

### ownerType（可选）
- **类型**: string
- **说明**: 拥有者类型，不传时默认查询角色的背包
- **可选值**: `"character"`（默认）、`"npc"`、`"all"`（仅查询类支持，返回所有拥有者的物品）

### ownerId（可选）
- **类型**: string
- **说明**: 拥有者ID或名称，当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）；ownerType 为 `"all"` 时忽略

## 返回值
```typescript
{
  items: InventoryItem[];  // 物品列表
  hint?: string;           // 提示信息（背包为空时返回建议）
}
```

**InventoryItem 字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 背包物品实例ID（如 `item_长剑_1779730545205`） |
| saveId | string | 存档ID |
| itemId | string | 物品模板ID |
| poolId | string | 来源物品池条目ID |
| name | string | 物品名称 |
| description | string | 物品描述 |
| category | string | 物品分类（weapon/armor/accessory/consumable/material/tool/quest/misc） |
| quantity | number | 数量 |
| quality | string | 品质（common/uncommon/rare/epic/legendary） |
| durability | number | 当前耐久度 |
| maxDurability | number | 最大耐久度 |
| inventorySlot | number \| null | 背包槽位索引 |
| equippedSlot | string \| null | 装备槽位（main_hand/off_hand/head/body/hands/feet/accessory） |
| equippedIndex | number \| null | 数组化槽位的索引（0=最前/最新）；单槽位为 null |
| equipped | boolean | 是否已装备 |
| weight | number | 重量 |
| maxStack | number | 最大堆叠数 |
| stats | Record&lt;string, number&gt; | 属性加成 |
| effects | ItemEffect[] | 效果数组 |
| value | ItemValue | 价值 |
| tags | string[] | 标签数组 |
| customData | Record&lt;string, unknown&gt; | 自定义数据 |
| visible | boolean | 是否可见 |
| ownerType | string | 拥有者类型（character/npc） |
| ownerId | string | 拥有者ID |
| createdAt | number | 创建时间戳 |
| updatedAt | number | 更新时间戳 |

## 注意事项
- 此方法为只读操作，不会修改背包数据
- 隐藏物品（visible=false）通常用于剧情道具等玩家暂不应看到的物品
- 已装备的物品也会出现在背包列表中（`equipped` 为 true）
- 背包为空时返回 `hint` 字段提示使用 `add_item` 添加物品
- 如需查看装备槽位详情，请使用 `get_equipment` 方法
- `ownerType="all"` 时返回所有拥有者（含角色和NPC）的物品，ownerId 参数被忽略

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 背包中无物品或过滤条件无匹配 | 检查 visibility 参数，尝试使用 "all" |
| 无效的可见性值 | visibility 传入了非枚举值 | 不传、传 "all" 或 "visible" |
| 角色未找到 | ownerType/ownerId 未传且无角色记录 | 确保存档已初始化角色 |
