---
tool: numerical_service
method: calculate_loot
description: "根据掉落表计算战利品"
summary: "计算战利品"
paramTypes:
  dropTable: "array (required) - 掉落表 [{id, name, quality, chance, minQuantity, maxQuantity}]"
returnType: "LootResult"
since: "1.0"
---

# numerical_service.calculate_loot

## 功能
根据掉落表计算战利品。基于每个物品的掉落概率（chance）进行随机判定，确定最终获得的物品列表。纯计算方法，不直接添加物品到背包。

## 参数详解

### dropTable（必填）
- **类型**: array
- **说明**: 掉落表，定义了可能掉落的物品及其概率
- **数组元素结构**:
  - `id`（string）— 物品模板ID
  - `name`（string）— 物品名称
  - `rarity`（string）— 稀有度：common、uncommon、rare、epic、legendary
  - `chance`（number）— 掉落概率，范围0-100（如50表示50%概率掉落）
  - `minQuantity`（number）— 最小掉落数量
  - `maxQuantity`（number）— 最大掉落数量

## 返回值
```typescript
interface LootResult {
  drops: Array<{
    id: string;       // 物品ID
    name: string;     // 物品名称
    rarity: string;   // 稀有度
    quantity: number;  // 掉落数量
  }>;
  totalItems: number;   // 掉落物品总数量
  uniqueItems: number;  // 掉落物品种类数
  dropped: boolean;     // 是否有物品掉落
}
```

## 注意事项
- 此方法为只读操作，纯概率计算，不修改任何游戏状态
- 每个物品独立进行概率判定，互不影响
- chance 范围为 0-100，不是 0-1。chance=100 必定掉落，chance=0 必定不掉落
- 掉落数量在 minQuantity 和 maxQuantity 之间随机（含两端）
- 如需将战利品添加到背包，需配合 `inventory_service.add_item` 使用

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | chance 值过小 | chance 范围为0-100，50表示50%概率 |
| 掉落表格式错误 | 缺少必要字段 | 确保每个元素包含 id、name、rarity、chance、minQuantity、maxQuantity |
| 概率不符合预期 | chance 传了0-1的小数 | chance 使用0-100整数，如50表示50% |
