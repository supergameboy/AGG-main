---
tool: inventory_service
method: add_item
description: "添加物品到背包(自动堆叠同ID物品,自动找空槽位,支持最大堆叠数限制,负重系统检查)。必须传入完整的物品属性（description、stats、effects、value、quality、tags等），不依赖模板。"
summary: "添加物品到背包"
paramTypes:
  items: "array<object{name:string,category:string,description:string,quantity:number,quality:string,stats:object,effects:array,value:number,tags:array,durability:number,maxDurability:number,weight:number,maxStack:number,visible:boolean,customData:object,fromPool:boolean,inventorySlot:number,ownerType:string,ownerId:string}> (required) - 要添加的物品列表，必须传入完整的物品属性"
since: "1.0"
---

# inventory_service.add_item

## 功能
添加物品到角色或NPC的背包。系统自动处理同ID物品堆叠、空槽位分配、最大堆叠数限制检查和负重系统检查。支持批量添加多个不同物品。

**重要：必须传入完整的物品属性**。本工具不依赖模板ID，LLM 需要自行提供物品的完整信息（description、stats、effects、value、tags 等），确保物品记录完整可用。

**去重行为（同名同 owner 自动增量更新）**：调用时按 `saveId + name + ownerType + ownerId` 四元组查重，命中已存在物品时**不会重复创建**，而是增量更新非黑名单字段并返回 `alreadyExists: true` + `warnings`（字段级 diff），引导 Agent 使用 `update_item` 修改而非重复 `add_item`。

## 参数详解

### items（必填）
- **类型**: array
- **说明**: 要添加的物品列表，支持批量添加
- **结构**: 数组中每个元素为对象，包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 物品名称（用户语言） |
| category | string | 是 | 物品分类（weapon/armor/accessory/consumable/material/quest/misc） |
| description | string | 否 | 物品描述（用户语言，100-200字，详细描述物品外观、来历、特性） |
| stats | object | 否 | 属性加成（如 `{"attack":5,"defense":3}`） |
| effects | string[] | 否 | 效果描述数组（如 `["恢复50点生命值","增加10点攻击力"]`） |
| value | object | 否 | 物品价值，格式 `{buy:20,sell:10,currency:"gold"}` 或数字快捷方式（自动计算卖出价） |
| tags | string[] | 否 | 标签数组（如 `["可交易","可装备","任务物品"]`） |
| quantity | number | 否 | 添加数量，默认1 |
| quality | string | 否 | 品质（common/uncommon/rare/epic/legendary），默认common |
| durability | number | 否 | 当前耐久度，默认按品质计算 |
| maxDurability | number | 否 | 最大耐久度，默认按品质计算（common=100, uncommon=120, rare=150, epic=200, legendary=300） |
| weight | number | 否 | 单个物品重量，默认1 |
| maxStack | number | 否 | 最大堆叠数，默认99（可被模板配置覆盖） |
| visible | boolean | 否 | 是否对玩家可见，默认true（创建即放入背包） |
| customData | object | 否 | 物品展示与机制数据 |
| fromPool | boolean | 否 | 设为true时优先从物品池取用物品 |
| inventorySlot | number | 否 | 背包排列序号 |
| ownerType | string | 否 | 拥有者类型：不传=默认角色(character)，"npc"=添加到NPC背包 |
| ownerId | string | 否 | 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID) |

**customData 推荐字段**:
- `displayType`: 展示类型（如"武器"/"防具"/"消耗品"）
- `displayRarity`: 展示稀有度（如"普通"/"优秀"/"精良"/"史诗"/"传说"）
- `displayStats`: 属性数组（如 `[{"key":"attack","label":"攻击力","value":"+15"}]`）
- `displayEffects`: 效果描述数组（如 `["攻击力+15","防御力+2"]`）
- `displayDescription`: 物品描述文本
- `displayValue`: 价值（如 `{"buy":120,"sell":60,"currency":"gold"}`）
- 消耗品还需: `effects`（机制效果数组，如 `[{"type":"heal","value":20,"target":"self"}]`）、`price`（售价数值）

**示例**:
```json
[
  {
    "name": "烈焰之剑",
    "category": "weapon",
    "description": "一把燃烧着永恒火焰的精钢长剑，剑身通体赤红，散发着灼热的气息。据传是远古火龙陨落时，其龙息淬炼而成的神兵。",
    "stats": {"attack": 25, "fire_damage": 10},
    "effects": ["攻击时附带10点火焰伤害", "对冰属性敌人伤害翻倍"],
    "value": {"buy": 500, "sell": 250, "currency": "gold"},
    "quality": "rare",
    "tags": ["可装备", "火属性", "双手武器"],
    "quantity": 1,
    "weight": 3.5,
    "customData": {
      "displayType": "武器",
      "displayRarity": "精良",
      "displayStats": [{"key":"attack","label":"攻击力","value":"+25"},{"key":"fire_damage","label":"火焰伤害","value":"+10"}],
      "displayEffects": ["攻击时附带10点火焰伤害", "对冰属性敌人伤害翻倍"],
      "displayDescription": "一把燃烧着永恒火焰的精钢长剑",
      "displayValue": {"buy":500,"sell":250,"currency":"gold"},
      "tags": ["可装备", "火属性", "双手武器"]
    }
  },
  {
    "name": "治疗药水",
    "category": "consumable",
    "description": "一瓶散发着淡淡红光的药水，饮用后可以迅速恢复50点生命值。由资深炼金师精心调配而成。",
    "effects": ["恢复50点HP"],
    "value": {"buy": 25, "sell": 12, "currency": "gold"},
    "quality": "common",
    "tags": ["可交易", "消耗品"],
    "quantity": 5,
    "weight": 0.5,
    "maxStack": 20,
    "customData": {
      "displayType": "消耗品",
      "displayRarity": "普通",
      "displayEffects": ["恢复50点HP"],
      "displayDescription": "一瓶散发着淡淡红光的药水",
      "displayValue": {"buy":25,"sell":12,"currency":"gold"},
      "effects": [{"type":"heal","value":50,"target":"self"}],
      "price": 25,
      "tags": ["可交易", "消耗品"]
    }
  }
]
```

## 返回值
```typescript
InventoryItem & {
  alreadyExists?: boolean;  // true 表示命中同名同 owner 去重，已增量更新而非新建
  warnings?: string[];      // 去重命中时的字段级 diff 提示，格式如：
                            // "物品 '幸运护符' 已存在，已增量更新 stats: {\"dodgeRate\":0.03} → {\"dodgeRate\":0.05}"
                            // "物品 '幸运护符' 已存在，quantity: 1 → 3（增量合并 +2）"
                            // "以下字段为黑名单字段，已拒绝更新并保留原值: itemId: item_幸运护符_<ts> (拒绝值: custom_id_xxx)"
}
```

返回添加后的物品完整信息，包含自动生成的 `id`（如 `item_烈焰之剑_1779730545205`）、`itemId`、`inventorySlot`、`quantity` 等字段。详见 `list_inventory` 返回值中的 InventoryItem 字段说明。

### 去重命中时的返回值
当 `saveId + name + ownerType + ownerId` 四元组命中已存在物品时：
- `alreadyExists: true` — 标记为已存在，未新建
- `warnings: string[]` — 字段级 diff 提示，明确告知哪些字段被增量更新、哪些字段被黑名单拒绝
- 返回的 `InventoryItem` 为更新后的完整实体（包含原 `id`、`itemId` 等）

## 去重行为详解

### 查重维度
- **四元组**：`saveId + name + ownerType + ownerId`
- **不同 owner 视为不同物品**：同 name 但不同 `ownerType`/`ownerId` 的物品不会被去重，正常创建新物品

### 黑名单字段（禁止覆盖，强制保留原值）
`id, saveId, itemId, poolId, createdAt, ownerType, ownerId, equipped, equippedSlot, equippedIndex, inventorySlot`

若 Agent 传入黑名单字段，warnings 会同时返回：
- `blockedFields`：拒绝字段 + 拒绝值 + 保留原值
- `updatedFields`：已更新字段 diff（如有其他非黑名单字段被更新）

### 可更新字段（白名单，增量覆盖）
`description, category, quality, stats, effects, value, tags, weight, maxStack, durability, maxDurability, customData, visible, quantity`

### quantity 堆叠语义
- `maxStack > 1` 且 `existing.equipped === false`：按 `min(existing.quantity + params.quantity, maxStack)` 合并，warnings 含 "（增量合并 +N）"
- `maxStack <= 1` 或 `existing.equipped === true`：仅做字段更新，不合并 quantity（避免已装备物品被意外堆叠）

## 注意事项
- **必须传入完整的物品属性**：description、stats、effects、value、tags 等字段由 LLM 提供，不依赖模板
- 同 itemId 的物品会自动堆叠，直到达到 `maxStack` 上限，超出部分会分配新槽位
- 添加前会检查负重系统（如模板启用），超重时添加失败并抛出错误
- `visible: false` 的物品在背包中存在但对玩家不可见
- `customData` 可存储消耗品效果、装备附加属性等自定义信息
- `fromPool: true` 时优先从物品池取用物品，物品池中无匹配时仍按普通方式添加
- itemId 由系统自动按 `item_{name转snake_case}_{timestamp}` 格式生成，无需手动指定
- **去重时不会创建新物品**：同 `saveId + name + ownerType + ownerId` 已存在时直接增量更新，Agent 收到 `alreadyExists: true` 应改用 `update_item` 进行后续修改

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 背包已满 | 无空槽位且无法堆叠 | 先清理背包或减少添加数量 |
| 超重 | 添加后总重量超过负重上限 | 减少添加数量或移除其他物品 |
| 无效分类 | category 值不在枚举范围内 | 使用 weapon/armor/accessory/consumable/material/quest/misc |
| 缺少必填字段 | name 未提供 | 每个物品必须提供 name |
