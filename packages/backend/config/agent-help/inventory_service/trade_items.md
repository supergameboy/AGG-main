---
tool: inventory_service
method: trade_items
description: "交易物品(卖出物品验证数量和价格→移除→买入物品记录→更新金币)"
summary: "交易物品"
paramTypes:
  sellItems: "array (required) - 卖出的物品列表 [{inventoryId, quantity}]"
  buyItems: "array (required) - 买入的物品列表 [{inventoryId, quantity}]"
  goldDelta: "number (optional) - 金币变化量(正数获得,负数支付)"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC交易物品"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)"
since: "1.0"
---

# inventory_service.trade_items

## 功能
执行物品交易操作，支持同时卖出和买入物品。卖出物品时验证数量和价格后移除物品，买入物品时从物品池查找物品定义并添加到背包，最后更新金币。交易过程在事务中执行，确保金币和物品的一致性。

## 参数详解

### sellItems（必填）
- **类型**: array
- **说明**: 卖出的物品列表
- **结构**: 数组中每个元素为对象，包含：
  - `inventoryId` (string): 背包物品实例ID
  - `quantity` (number): 卖出数量

### buyItems（必填）
- **类型**: array
- **说明**: 买入的物品列表
- **结构**: 数组中每个元素为对象，包含：
  - `inventoryId` (string): **物品池条目ID**（物品池中的物品定义ID，不是背包实例ID）
  - `quantity` (number): 买入数量

### goldDelta（可选）
- **类型**: number
- **说明**: 金币变化量
- **正值**: 角色获得金币（卖出多于买入时）
- **负值**: 角色支付金币（买入多于卖出时）
- **默认**: 0

### ownerType（可选）
- **类型**: string
- **说明**: 拥有者类型，不传时默认为角色
- **可选值**: `"character"`（默认）、`"npc"`

### ownerId（可选）
- **类型**: string
- **说明**: 拥有者ID或名称，当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）

## 返回值
```typescript
interface TradeResult {
  success: boolean;              // 交易是否成功
  sold: Array<{                 // 卖出的物品列表
    itemId: string;              // 物品池条目ID
    name: string;                // 物品名称
    quantity: number;            // 卖出数量
    value: number;               // 总价值（单价×数量，单价从 customData.price 读取，默认1）
  }>;
  bought: Array<{               // 买入的物品列表
    itemId: string;              // 物品池条目ID
    name: string;                // 物品名称
    quantity: number;            // 买入数量
  }>;
  goldChange: number;            // 金币变化量（等于 goldDelta）
  newGoldBalance: number;        // 交易后金币余额
  error?: string;                // 错误信息（失败时）
}
```

**成功示例**:
```json
{
  "success": true,
  "sold": [{"itemId": "item_铁剑_123", "name": "铁剑", "quantity": 1, "value": 30}],
  "bought": [{"itemId": "item_长剑_456", "name": "长剑", "quantity": 1}],
  "goldChange": -70,
  "newGoldBalance": 30
}
```

**失败示例**:
```json
{
  "success": false,
  "sold": [],
  "bought": [],
  "goldChange": 0,
  "newGoldBalance": 100,
  "error": "Insufficient gold. Have: 100, Need: 150"
}
```

## 注意事项
- 交易为原子操作（事务），任一步骤失败则整体回滚
- 卖出物品前会验证物品存在性和数量，数量不足时抛出错误
- 买入物品的 `inventoryId` 是**物品池条目ID**（物品池中的定义ID），不是背包实例ID
- 买入物品需要物品池中存在对应的物品定义
- 卖出物品的价格从 `customData.price` 读取，默认为1
- 金币不足时交易失败（goldDelta 为负数且余额不足）
- 如只需卖出或买入，可将另一个参数设为空数组 `[]`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 金币不足 | 角色金币不够支付 | 减少买入数量或增加卖出物品 |
| 物品不存在 | sellItems 中的 inventoryId 无效 | 先用 `list_inventory` 获取有效的 inventoryId |
| 买入物品不存在 | buyItems 中的物品池条目ID在物品池中不存在 | 确认物品池条目ID是否正确，使用 `list_pool_items` 查看可用物品 |
| 数量不足 | 卖出数量超过物品实际数量 | 检查物品剩余数量 |
| 背包已满 | 买入物品无空槽位 | 先清理背包空间 |
