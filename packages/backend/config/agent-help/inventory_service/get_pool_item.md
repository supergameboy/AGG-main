---
tool: inventory_service
method: get_pool_item
description: "获取物品池中指定物品的详细信息。preloaded: 返回结果包含完整物品定义。"
summary: "获取物品池中指定物品详情"
paramTypes:
  poolItemId: "string (required) - 物品池条目ID"
since: "1.0"
---

# inventory_service.get_pool_item

## 功能
获取物品池中指定物品定义的详细信息。支持通过物品池条目ID或物品名称查询。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| poolItemId | string | 是 | 物品池条目ID或物品名称 |

**示例**:
```json
{ "poolItemId": "pool_烈焰之剑_1779730545205" }
{ "poolItemId": "烈焰之剑" }
```

## 返回值
```typescript
interface ItemPoolEntry {
  id: string;                              // 物品池条目ID
  saveId: string;                          // 存档ID
  name: string;                            // 物品名称
  description: string;                     // 物品描述
  category: ItemCategory;                  // 物品分类
  quality: ItemQuality;                    // 品质
  stats: Record<string, number>;           // 属性加成
  effects: ItemEffect[];                   // 效果数组
  value: ItemValue;                        // 价值
  tags: string[];                          // 标签数组
  weight: number;                          // 重量
  maxStack: number;                        // 最大堆叠数
  equippedSlot: string | null;             // 装备槽位（main_hand/off_hand/head/body/hands/feet/accessory）
  durability: number;                      // 耐久度
  maxDurability: number;                   // 最大耐久度
  taken: boolean;                          // 是否已被取用
  customData: Record<string, unknown>;     // 自定义数据
  recommendedClasses: string[];            // 推荐职业列表
}
```

## 注意事项
- 返回的是物品池定义数据，不是背包实例数据
- `poolItemId` 支持传入条目ID或物品名称，系统按 ID 优先、名称其次的顺序匹配
- 如需查看背包中的物品实例，请使用 `get_item` 方法

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| Pool item not found | poolItemId 对应的条目不存在 | 使用 `list_pool_items` 获取有效的条目ID或名称 |
| 名称重复匹配 | 多个条目使用相同名称 | 使用唯一的条目ID而非名称查询 |
