---
name: equipment-management
description: 管理装备的穿戴和卸下，同步更新属性加成
targetAgent: ["inventory"]
trigger: [equip_item, unequip_item]
whenToUse: 玩家装备武器防具、卸下装备、更换装备时
recommendedTools: [inventory_service, character_service]
relatedRules: [inventory-core]
completionCriteria: 装备已穿戴或卸下、槽位状态正确、属性加成已重新计算
version: "4.0"
enabled: true
---

# 装备管理

## 任务是什么
处理装备的穿戴和卸下操作，确保装备槽位正确分配，属性加成实时更新。

## 为什么有这个任务
装备系统需要保证穿戴/卸下操作的原子性——槽位状态和属性加成必须同步变更，避免出现装备已穿戴但属性未加成、或槽位冲突导致装备丢失的情况。

## 完成的标准是什么
1. 装备操作（穿戴或卸下）已成功执行
2. 装备槽位状态与实际一致（无冲突、无空占）
3. 角色属性加成已重新计算并持久化
4. 返回操作后的装备列表和属性变化

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `inventory_service.get_equipment` — 获取当前已装备列表，确认目标槽位状态
2. 调用 `inventory_service.list_inventory` — 查询背包中可装备的物品
3. 调用 `inventory_service.equip_item` — 将物品装备到指定槽位
4. 调用 `inventory_service.unequip_item` — 卸下装备回背包
5. 调用 `character_service.get_full_status` — 获取装备变更后的角色完整状态，验证属性加成已生效

### 注意事项
- 装备前必须确认物品在背包中且属于可装备类型
- 单槽位已有装备时，系统自动将旧装备卸回背包
- 数组化槽位（accessory 容量2）有空位时自动装入空位，无空位时撤下最旧装备（堆栈替换）
- targetSlot 必须与物品类型匹配（武器→main_hand/off_hand，头盔→head，铠甲→body，手套→hands，靴子→feet，盾牌→off_hand，饰品→accessory）
- 装备操作完成后必须调用 get_full_status 验证属性加成已生效

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "装备管理完成",
  "data": {
    "action": "equip|unequip",
    "item": { "inventoryId": "string", "name": "string", "slot": "string" },
    "replacedItem": { "inventoryId": "string|null", "name": "string|null" },
    "statusVerified": true
  }
}
```
