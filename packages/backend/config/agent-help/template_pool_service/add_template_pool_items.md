---
tool: template_pool_service
method: add_template_pool_items
description: "批量向模板物品池添加物品（LLM生成时使用，source自动设为generated）"
paramTypes:
  items: "array (required) - 物品数组，每项包含: name(必填), description, category, quality, icon, stats, effects, value, equippedSlot, recommendedClasses"
since: "1.0"
returnsSummary: '{ success: boolean, data: TemplateItemPoolEntry[], errors?: Array<{name: string, error: string}> }'
---

# template_pool_service.add_template_pool_items

<!-- @manual: 本文件 frontmatter 由 generate-agent-help 自动维护，正文由人工维护 -->
<!-- 如需完全手工维护 frontmatter，在正文任意处添加 <!-- @manual-frontmatter --> 标记 -->

## 功能
批量向模板物品池添加物品，source 自动设为 generated。单次调用传入所有生成的物品，减少工具调用次数。

## 参数详解
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| items | array | 是 | 物品数组，每项字段如下 |

### items 数组每项字段
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 物品名称，需唯一 |
| description | string | 否 | 物品描述，默认空 |
| category | string | 否 | 分类: weapon/armor/consumable/material/quest/misc/accessory，默认 misc |
| quality | string | 否 | 品质: common/uncommon/rare/epic/legendary，默认 common |
| stats | object | 否 | 属性数据 {attack: number, defense: number, ...} |
| effects | array | 否 | 效果列表 |
| value | object | 否 | 价值 {gold: number, silver: number, copper: number} |
| equippedSlot | string | 否 | 装备槽位: main_hand/off_hand/head/body/hands/feet/accessory |
| recommendedClasses | array | 否 | 推荐职业列表，默认 [] |

## 返回值
```typescript
{
  success: boolean;
  data: TemplateItemPoolEntry[];
  errors?: Array<{ name: string; error: string }>;
}
```

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| templateId 不可用 | 未在模板上下文中调用 | 确保在模板池生成路径中调用 |
| items 数组不能为空 | 未传入 items 参数 | 传入至少一个物品 |
| name 重复 | 同名物品已存在 | 检查已有物品列表，使用不重复的名称 |
