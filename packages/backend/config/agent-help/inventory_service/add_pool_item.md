---
tool: inventory_service
method: add_pool_item
description: "向物品池添加物品定义，taken默认为false。返回完整的物品池条目。"
summary: "向物品池添加物品定义"
paramTypes:
  name: "string (required) - 物品名称(用户语言，必填)"
  description: "string (optional) - 物品描述(用户语言)"
  category: "string (optional) - 物品分类 weapon|armor|accessory|consumable|material|quest|misc"
  quality: "string (optional) - 品质 common|uncommon|rare|epic|legendary"
  stats: "object (optional) - 物品属性加成，如{attack:5,defense:3}"
  effects: "array<string> (optional) - 物品效果数组"
  value: "object (optional) - 物品价值，如{buy:20,sell:10,currency:\"gold\"}"
  tags: "array<string> (optional) - 物品标签数组"
  weight: "number (optional) - 物品重量"
  maxStack: "number (optional) - 最大堆叠数"
  equippedSlot: "string (optional) - 装备槽位"
  durability: "number (optional) - 当前耐久度"
  maxDurability: "number (optional) - 最大耐久度"
  customData: "object (optional) - 自定义数据"
  recommendedClasses: "array<string> (optional) - 推荐职业列表"
since: "1.0"
---

# inventory_service.add_pool_item

## 功能
向当前存档的物品池中添加一个物品定义，taken 默认为 false。返回完整的物品池条目，供后续 `add_item_from_pool` 选取到角色背包。

**去重行为（同 saveId + name 自动增量更新）**：调用时按 `saveId + name` 二元组查重，命中已存在条目时**不会重复创建**，而是增量更新非黑名单字段并返回 `alreadyExists: true` + `warnings`（字段级 diff），引导 Agent 使用 `update_pool_item` 修改而非重复 `add_pool_item`。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 物品名称（用户语言） |
| description | string | 否 | 物品描述（用户语言） |
| category | string | 否 | 物品分类（weapon/armor/accessory/consumable/material/tool/quest/misc） |
| quality | string | 否 | 品质（common/uncommon/rare/epic/legendary） |
| stats | object | 否 | 属性加成，如 `{"attack":5,"defense":3}` |
| effects | object[] | 否 | 效果对象数组，每个对象包含 type（效果类型）和 value（效果值），如 `[{"type":"heal","value":50}]` |
| value | object | 否 | 价值，如 `{"buy":20,"sell":10,"currency":"gold"}` |
| tags | array | 否 | 标签数组，如 `["剑","近战"]` |
| weight | number | 否 | 重量 |
| maxStack | number | 否 | 最大堆叠数 |
| equippedSlot | string | 否 | 可装备槽位名（main_hand/off_hand/head/body/hands/feet/accessory），null 表示不可装备 |
| durability | number | 否 | 默认耐久度 |
| maxDurability | number | 否 | 默认最大耐久度 |
| customData | object | 否 | 自定义数据 |
| recommendedClasses | string[] | 否 | 推荐职业列表（如 `["warrior","paladin"]`），为空表示通用 |

**示例**:
```json
{
  "name": "烈焰之剑",
  "description": "一把燃烧着永恒火焰的精钢长剑",
  "category": "weapon",
  "quality": "rare",
  "stats": {"attack": 25, "fire_damage": 10},
  "effects": [{"type": "fire_damage", "value": 10}, {"type": "buff_attack", "value": 5}],
  "value": {"buy": 500, "sell": 250, "currency": "gold"},
  "tags": ["可装备", "火属性", "双手武器"],
  "weight": 3.5,
  "equippedSlot": "main_hand",
  "durability": 150,
  "maxDurability": 150
}
```

## 返回值
```typescript
ItemPoolEntry & {
  alreadyExists?: boolean;  // true 表示命中同 saveId+name 去重，已增量更新而非新建
  warnings?: string[];      // 去重命中时的字段级 diff 提示，格式如：
                            // "物品池 '烈焰之剑' 已存在，已增量更新 stats: {\"attack\":5} → {\"attack\":10}"
                            // "物品池 '烈焰之剑' 已存在，无字段变化"
                            // "以下字段为黑名单字段，已拒绝更新并保留原值: itemId: item_烈焰之剑_<ts> (拒绝值: custom_id_xxx)"
}
```

### 去重命中时的返回值
当 `saveId + name` 二元组命中已存在物品池条目时：
- `alreadyExists: true` — 标记为已存在，未新建
- `warnings: string[]` — 字段级 diff 提示，明确告知哪些字段被增量更新、哪些字段被黑名单拒绝
- 返回的 `ItemPoolEntry` 为更新后的完整实体（包含原 `id`、`saveId`、`itemId` 等）

## 去重行为详解

### 查重维度
- **二元组**：`saveId + name`（不区分 owner，物品池是存档级共享）

### 黑名单字段（禁止覆盖，强制保留原值）
`id, saveId, itemId, createdAt`

若 Agent 传入黑名单字段，warnings 会同时返回：
- `blockedFields`：拒绝字段 + 拒绝值 + 保留原值
- `updatedFields`：已更新字段 diff（如有其他非黑名单字段被更新）

### 可更新字段（白名单，增量覆盖）
`description, category, quality, stats, effects, value, tags, weight, maxStack, equippedSlot, durability, maxDurability, customData, recommendedClasses`

## 注意事项
- 物品池是物品定义的集合，添加后需通过 `add_item_from_pool` 选取到角色背包
- 初始化时批量添加物品到池中，运行时按需选取
- `taken` 字段由系统自动管理，添加时默认为 false，取用后自动更新为 true
- `effects` 数组元素为结构化对象（如 `{"type":"heal","value":50}`），包含 type 和 value 字段
- `recommendedClasses` 用于职业过滤，为空或不传表示所有职业通用
- **去重时不会创建新物品池条目**：同 `saveId + name` 已存在时直接增量更新，Agent 收到 `alreadyExists: true` 应改用 `update_pool_item` 进行后续修改

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| Missing required field: name | 未提供 name 参数 | name 为必填字段，必须提供物品名称 |
| Invalid category | category 值不在枚举范围内 | 使用 weapon/armor/accessory/consumable/material/tool/quest/misc |
| Invalid quality | quality 值不在枚举范围内 | 使用 common/uncommon/rare/epic/legendary |
