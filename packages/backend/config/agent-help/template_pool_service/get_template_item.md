---
tool: template_pool_service
method: get_template_item
description: "获取模板物品池中指定物品的详情"
summary: "获取模板池中单个物品详情"
paramTypes:
  itemId: "string (required) - 模板物品ID"
since: "1.0"
---

# template_pool_service.get_template_item

## 功能
获取模板池中指定物品的完整详细信息，包括属性、效果、价值、耐久等全部字段。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| itemId | string | 是 | 模板物品ID（如 medieval-fantasy__flame-sword） |

## 返回值

```typescript
{
  success: boolean;
  data?: TemplateItemPoolEntry;
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
  equippedSlot: string | null;              // 装备槽位（main_hand/off_hand/head/body/hands/feet/accessory）
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
- 物品ID必须存在于当前模板池中
- 可先通过 `list_template_items` 浏览获取物品ID

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|------|------|---------|
| 模板物品未找到 | itemId 不存在 | 先调用 list_template_items 确认正确的物品ID |
