---
tool: inventory_service
method: equip_item
description: "批量装备物品到指定槽位(自动替换已装备物品,验证槽位类型兼容性)。程序对每项自动四级查找：背包→名称→存档物品池→模板池→字段齐全创建"
summary: "装备物品到指定槽位"
paramTypes:
  items: "array<object{inventoryId:string,targetSlot:string,ownerType:string,ownerId:string,fullParams:object}> (required) - 要装备的物品列表"
since: "1.0"
---

# inventory_service.equip_item

## 功能
将背包中的物品装备到指定槽位。系统会自动验证物品类型与槽位的兼容性：
- **单槽位**（capacity 未定义或=1）：目标槽位已有装备时自动替换，将原装备卸回背包
- **数组化槽位**（capacity>1，如 accessory 容量2）：有空位时自动装入空位（追加到末尾）；无空位时按堆栈替换（撤下 equippedIndex 最大的最旧装备，新装备插入 equippedIndex=0，其他装备索引后移）

装备后角色的派生属性会自动重算。

## 参数详解

### inventoryId（required）
- **类型**: string
- **说明**: 背包中物品的实例ID
- **获取方式**: 从 `list_inventory` 返回结果中获取

### targetSlot（optional）
- **类型**: string
- **说明**: 目标装备槽位ID，不传则系统自动选择
- **标准槽位**: main_hand, off_hand, head, body, hands, feet, accessory
- **数组化槽位**: accessory（容量2）—可装多个物品，自动找空位或堆栈替换
- **别名映射**: chest/torso→body, hat/helmet/cap→head, boot/boots/shoe/shoes→feet, main→main_hand, off→off_hand, hand→hands, accessory1/accessory2/ring1/ring2/amulet/necklace→accessory（旧别名自动映射到 accessory 数组化槽位）
- **规则**: 必须与物品类型匹配（武器→main_hand/off_hand，头盔→head，铠甲→body，手套→hands，靴子→feet，盾牌→off_hand，饰品→accessory）
- **返回值**: 发生别名映射时返回值含 requestedSlot 字段（原始输入）和 newSlot 字段（解析后槽位）

### ownerType（optional）
- **类型**: string
- **说明**: 拥有者类型
- **可选值**: `"character"`（默认）、`"npc"`

### ownerId（optional）
- **类型**: string
- **说明**: 拥有者ID或名称，当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）

### fullParams（optional）
- **类型**: object
- **说明**: 物品完整字段，当物品不在背包/物品池时用于自动创建
- **包含字段**: name, category, quality, stats, effects, value, tags, description 等

## 返回值

```typescript
// EquipResult
{
  success: boolean;           // 是否装备成功
  message: string;            // 操作描述（含别名映射提示，如 chest→body）
  previousSlot: EquipmentSlot | null;  // 被替换物品的原槽位（单槽位替换时填充）
  newSlot: EquipmentSlot | null;       // 实际装备槽位（解析后）
  requestedSlot?: string;     // 仅当发生别名映射时返回（LLM 传入的原始 targetSlot）
  alreadyEquipped?: boolean;  // 物品已装备时为 true
  assignedIndex?: number;     // 数组化槽位时新装备分配的 equippedIndex（0=最前/最新）
  replacedItems?: Array<{     // 堆栈替换时撤下的装备列表（仅数组化槽位无空位时填充）
    inventoryId: string;      // 被撤下装备的实例ID
    previousIndex: number;    // 被撤下装备的原 equippedIndex
  }>;
}
```

## 注意事项
- 装备前物品必须在背包中（equipped=false），已装备的物品需先卸下
- 单槽位已有装备时，系统自动将旧装备卸回背包
- 数组化槽位（accessory）有空位时自动装入空位，无空位时撤下最旧装备（堆栈替换）
- 装备后角色属性加成自动重算，可通过 `character_service.get_full_status` 验证
- 槽位与物品类型不匹配时返回失败
- `inventoryId` 支持传入物品名称，系统自动完成四级查找（背包→存档池→模板池→创建）
- `fullParams` 在物品不在任何池中时使用，传入完整物品定义即可一步完成创建+装备

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Item not found | 物品ID不存在 | 从 list_inventory 获取正确的 inventoryId |
| Item already equipped | 物品已处于装备状态 | 先调用 unequip_item 卸下 |
| Slot incompatible | 物品类型与槽位不匹配 | 确认物品类型对应的正确槽位 |
