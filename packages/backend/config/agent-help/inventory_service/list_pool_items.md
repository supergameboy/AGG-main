---
tool: inventory_service
method: list_pool_items
description: "列出物品池中的物品，可按taken状态和category筛选。preloaded: 返回结果包含所有物品池条目。"
summary: "列出物品池中的物品"
paramTypes:
  taken: "boolean (optional) - 按taken状态筛选：true=已取用，false=未取用，不传=全部"
  category: "string (optional) - 按物品分类筛选"
since: "1.0"
---

# inventory_service.list_pool_items

## 功能
列出当前存档物品池中的物品定义，可按 taken 状态和 category 筛选。默认显示所有物品，设置 `taken=true` 仅显示已取用物品，`taken=false` 仅显示未取用物品。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| taken | boolean | 否 | 按取用状态筛选：true=仅已取用，false=仅未取用，不传=全部 |
| category | string | 否 | 按物品分类筛选（weapon/armor/accessory/consumable/material/tool/quest/misc） |

**示例**:
```json
// 列出所有未取用的武器
{ "taken": false, "category": "weapon" }

// 列出所有物品池条目
{}
```

## 返回值
```typescript
{
  items: ItemPoolEntry[];  // 物品池条目列表
}
```

**ItemPoolEntry 字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 物品池条目ID |
| saveId | string | 存档ID |
| name | string | 物品名称 |
| description | string | 物品描述 |
| category | ItemCategory | 物品分类 |
| quality | ItemQuality | 品质 |
| stats | Record&lt;string, number&gt; | 属性加成 |
| effects | ItemEffect[] | 效果数组 |
| value | ItemValue | 价值 |
| tags | string[] | 标签数组 |
| weight | number | 重量 |
| maxStack | number | 最大堆叠数 |
| equippedSlot | string \| null | 装备槽位（main_hand/off_hand/head/body/hands/feet/accessory） |
| durability | number | 耐久度 |
| maxDurability | number | 最大耐久度 |
| taken | boolean | 是否已被取用 |
| customData | Record&lt;string, unknown&gt; | 自定义数据 |
| recommendedClasses | string[] | 推荐职业列表 |

## 注意事项
- 物品池中的物品是定义（模板），不是角色背包中的实例
- 默认显示所有物品，设置 `taken=true` 仅显示已取用物品，`taken=false` 仅显示未取用物品
- 已取用的物品（taken=true）仍会出现在默认列表中，可使用 `taken=false` 过滤

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| Save not found | saveId 无效 | 确保使用有效的存档ID |
| 返回空列表 | 物品池为空或筛选条件无匹配 | 检查 taken 和 category 参数，或先通过 `add_pool_item` 添加物品 |
| Invalid category | category 值不在枚举范围内 | 使用 weapon/armor/accessory/consumable/material/tool/quest/misc |
