---
tool: inventory_service
method: get_item
description: "获取背包中指定物品的详情(含属性、耐久度、装备状态)。支持通配符查询：ownerType=\"all\"时按物品名称查询返回所有拥有者的匹配记录(数组)"
summary: "获取背包中指定物品详情"
paramTypes:
  items: "array<object{inventoryId:string,ownerType:string,ownerId:string}> (required) - 要获取的物品列表"
since: "1.0"
---

# inventory_service.get_item

## 功能
获取背包中指定物品的详细信息，包括物品属性、耐久度和装备状态。支持批量查询多个物品。支持通过背包实例ID、物品模板ID（itemId）或物品名称进行查询。

## 参数详解

### items（必填）
- **类型**: array
- **说明**: 要获取的物品列表，支持批量查询
- **结构**: 数组中每个元素为对象，包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| inventoryId | string | 是 | 背包物品ID。可使用预加载上下文中的id（如 `item_生锈的铁剑_xxx`）或itemId（如 `medieval-fantasy__rusty-sword`）或物品名称 |
| ownerType | string | 否 | 拥有者类型：不传=默认角色(character)，"npc"=NPC的物品，"all"=所有拥有者(仅查询类支持，返回数组) |
| ownerId | string | 否 | 拥有者ID或名称：ownerType为npc时必传(可传NPC名称)；ownerType为all时忽略 |

**示例**:
```json
[
  { "inventoryId": "item_长剑_1779730545205" },
  { "inventoryId": "medieval-fantasy__rusty-sword" },
  { "inventoryId": "治疗药水", "ownerType": "npc", "ownerId": "npc_铁匠_123" }
]
```

## 返回值
```typescript
InventoryItem | InventoryItem[]
```

- **默认（ownerType 不传或为 character/npc）**: 返回单个 `InventoryItem`
- **ownerType="all"**: 按物品名称查询时返回 `InventoryItem[]`（所有拥有者的匹配记录）

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
- 此方法为只读操作，不会修改物品数据
- `inventoryId` 参数支持三种查询方式：背包实例ID、物品模板ID（itemId）、物品名称，系统按此顺序依次尝试匹配
- 查询不存在的物品会返回错误，提示可用物品列表
- 如需按物品模板ID查询数量，请使用 `check_item_quantity` 方法
- `ownerType="all"` 时按物品名称查询返回所有拥有者的匹配记录（数组），ownerId 参数被忽略

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 物品未找到 | inventoryId 不存在或不在背包中 | 先用 `list_inventory` 获取有效的物品ID |
| 混淆ID类型 | 使用了错误的ID类型 | 可使用背包实例id、itemId或物品名称，系统自动解析 |
