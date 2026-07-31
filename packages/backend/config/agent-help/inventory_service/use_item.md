---
tool: inventory_service
method: use_item
description: "使用消耗品(减少数量并返回效果,仅consumable类别可用)"
summary: "使用消耗品"
paramTypes:
  inventoryId: "string (required) - 消耗品唯一ID"
  ownerType: "string (optional) - 拥有者类型：不传=默认角色(character)，\"npc\"=NPC使用物品"
  ownerId: "string (optional) - 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID)"
since: "1.0"
effectTypes: heal（回血）、mana_restore（回蓝）、stamina_restore（回体力）、damage（伤害）
---

# inventory_service.use_item

## 功能
使用背包中的消耗品物品。使用后物品数量自动减少1，并返回物品的效果数据（从 effects 字段中读取）。仅 consumable 类别的物品可以使用。数量减为0时物品自动从背包移除。

## 参数详解

### inventoryId（required）
- **类型**: string
- **说明**: 消耗品的实例ID
- **获取方式**: 从 `list_inventory` 返回结果中获取（category=consumable 的物品）

### ownerType（optional）
- **类型**: string
- **说明**: 拥有者类型
- **可选值**: `"character"`（默认）、`"npc"`

### ownerId（optional）
- **类型**: string
- **说明**: 拥有者ID或名称
- **必填条件**: 当 ownerType 为 `"npc"` 时必传（可传NPC名称，程序自动解析为ID）

## 返回值

```typescript
// UseItemResult
{
  success: boolean;           // 是否使用成功
  effects: Array<{            // 物品效果列表（从 inventory.effects 读取）
    type: string;             // 效果类型（heal, mana, buff 等）
    value: number;            // 效果数值
    target?: string;          // 效果目标（self 等）
    duration?: number;        // 持续时间（如有）
  }>;
  consumed: boolean;          // 物品是否已消耗完毕并移除
  remainingQuantity: number;  // 剩余数量
  message: string;            // 操作描述
}
```

## 注意事项
- 仅 `consumable` 类别的物品可使用，其他类别返回 success=false
- `use_item` **自动应用确定性效果**到角色/NPC 属性，无需额外调用 modify_health/modify_mana
  - `heal` 效果：character 调用 `characterService.modifyHealth`；npc 调用 `npcService.modifyNpcResource('hp')`
  - `mana_restore` 效果：character 调用 `characterService.modifyMana`；npc 调用 `npcService.modifyNpcResource('mp')`
  - `stamina_restore` 效果：character 调用 `characterService.modifyStamina`；npc 调用 `npcService.modifyNpcResource('stamina')`
  - `damage` 效果：character 调用 `characterService.modifyHealth(-value)`；npc 调用 `npcService.modifyNpcResource('hp', -value)`
- 效果类型必须在 `DeterministicEffectType` 定义的四种内（heal/mana_restore/stamina_restore/damage），其他类型不会自动应用
- 战斗中使用消耗品应使用 `combat_service.use_item_in_combat`，而非此方法
- 物品数量为0时自动从背包移除（consumed=true）

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Item not found | 物品ID不存在 | 从 list_inventory 获取正确的 inventoryId |
| Not consumable | 物品不是消耗品 | 仅 consumable 类别可用 |
| Quantity insufficient | 物品数量为0 | 物品已被消耗完毕 |
