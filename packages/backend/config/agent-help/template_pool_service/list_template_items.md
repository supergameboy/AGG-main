---
tool: template_pool_service
method: list_template_items
description: "查询模板物品池中的物品(可按分类、装备槽位、推荐职业和品质过滤)"
summary: "按类别查询模板物品池"
paramTypes:
  category: "string (optional) - 按分类过滤(weapon/armor/consumable/material/quest/misc/accessory)"
  equippedSlot: "string (optional) - 按装备槽位过滤(head/chest/legs/feet/hands/main_hand/off_hand/accessory)"
  recommendedClass: "string (optional) - 按推荐职业过滤(返回推荐该职业的物品+无职业限制的物品)"
  quality: "string (optional) - 按品质过滤(common/uncommon/rare/epic/legendary)"
since: "1.0"
---

# template_pool_service.list_template_items

## 功能
按类别查询模板物品池，返回匹配的物品列表。用于初始化时浏览可用物品，支持按分类、装备槽位、推荐职业和品质多维度筛选。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| category | string | 否 | 按分类过滤。可选值: weapon, armor, consumable, material, quest, misc, accessory |
| equippedSlot | string | 否 | 按装备槽位过滤。可选值: main_hand, off_hand, head, body, hands, feet, accessory |
| recommendedClass | string | 否 | 按推荐职业过滤（如 warrior, mage, rogue, priest）。返回 recommendedClasses 包含该职业的物品。**空数组=通用，任何职业筛选都命中** |
| quality | string | 否 | 按品质过滤。可选值: common, uncommon, rare, epic, legendary |

## 返回值

```typescript
{
  success: boolean;
  data?: TemplateItemPoolEntry[];
  error?: string;
}

interface TemplateItemPoolEntry {
  id: string;
  templateId: string;
  name: string;
  description: string;
  category: ItemCategory;
  quality: ItemQuality;
  stats: Record<string, number>;
  effects: ItemEffect[];
  value: ItemValue;
  tags: string[];
  weight: number;
  maxStack: number;
  equippedSlot: string | null;
  durability: number;
  maxDurability: number;
  customData: Record<string, unknown>;
  recommendedClasses: string[];
  source: 'manual' | 'generated';
  createdAt: number;
  updatedAt: number;
}

type ItemCategory = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'material' | 'quest' | 'misc';
type ItemQuality = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

interface ItemEffect {
  type: string;
  value: number;
  target?: string;
  duration?: number;
}

interface ItemValue {
  buy?: number;
  sell?: number;
  currency?: string;
}
```

## 注意事项
- 只读操作，不修改游戏状态
- 不传任何参数时返回当前模板下所有物品
- 多个筛选参数同时传入时取交集
- recommendedClasses 为空数组的物品视为通用物品，任何职业筛选都会命中
- 返回的是模板池数据，需通过 `inventory_service.add_item_from_pool` 将物品从池取用到背包，再通过 `inventory_service.equip_item` 装备

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|------|------|---------|
| 返回空数组 | 筛选条件无匹配结果 | 调整筛选参数，或不传参数查看全部 |
