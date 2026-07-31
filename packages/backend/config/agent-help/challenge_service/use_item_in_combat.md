---
tool: challenge_service
method: use_item_in_combat
description: "战斗中使用消耗品(仅consumable类别可用)"
summary: "战斗中使用消耗品"
paramTypes:
  itemId: "string (required) - 物品ID"
returnType: "TurnResult"
since: "1.0"
---

# combat_service.use_item_in_combat

## 功能
在战斗中使用消耗品。根据物品类型执行不同效果：治疗药水恢复HP，法力药水恢复MP。使用后物品数量减少（数量为1时自动从背包删除），效果立即生效。

## 参数详解

### itemId (required)
物品ID，必须是背包（inventory 表）中存在的物品实例ID。

示例：
- `"inv_health_potion_001"`：治疗药水实例ID
- `"inv_mana_potion_001"`：法力药水实例ID

## 返回值
```typescript
interface TurnResult {
  actorName: string;       // 使用者名称（玩家名）
  actionType: "item";      // 固定为 "item"
  targetName?: undefined;  // 无目标
  damage?: undefined;      // 无伤害
  healed?: number;         // 治疗量（仅治疗药水时有值）
  effect: string;          // 效果描述，如 "healed 30 HP" 或 "restored 20 MP"
  isCritical?: undefined;
  killed?: undefined;
  logMessage: string;      // 如 "玩家 used 治疗药水, healed 30 HP"
}
```

## 注意事项
- 支持的物品类型及效果：
  - `potion` / `health_potion` / `consumable`：恢复HP，治疗量 = min(itemData.heal_amount, maxHP - currentHP)，默认治疗量30（由 potion_heal 配置决定）
  - `mana_potion`：恢复MP，恢复量 = min(itemData.mana_amount, maxMP - currentMP)，默认恢复量20（由 mana_potion_restore 配置决定）
  - 其他类型：抛出错误 `Cannot use item type 'xxx' in combat`
- 物品类型优先级：item_data.type > inventory.item_type > 默认 "consumable"
- 治疗量不会超过 maxHP - currentHP（不溢出）
- 使用后物品数量自动减少1，数量为1时从背包删除
- 无活跃战斗或战斗已结束时抛出错误

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Item not found | itemId 在背包中不存在 | 先查询背包确认物品存在 |
| Cannot use item type 'xxx' in combat | 物品类型不在允许列表中 | 只能使用 potion/health_potion/consumable/mana_potion 类型 |
| No active combat found | 当前无活跃战斗 | 先调用 start_combat 开始战斗 |
| Combat is not active | 战斗已结束 | 不应再使用物品 |
| Player not found in combat | 战斗参与者中无玩家 | 检查战斗状态是否异常 |
