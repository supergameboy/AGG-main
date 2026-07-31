---
name: gm-item-operations
description: 处理玩家使用、装备、丢弃物品的操作编排
targetAgent: [gamemaster]
trigger: [use_item, equip_item, unequip_item, drop_item]
whenToUse: 玩家使用消耗品、装备/卸下装备、丢弃物品时
recommendedTools: [inventory_service, character_service, skill_service, coordinator_service]
relatedRules: [inventory-core]
completionCriteria: 物品操作已生效、角色状态已更新、操作叙事已生成
version: "4.0"
enabled: true
---

# 物品操作编排

## 任务是什么
处理玩家对物品的操作，包括使用消耗品、装备/卸下装备、丢弃物品，确保物品效果正确应用到角色状态，并向玩家呈现操作结果。

## 为什么有这个任务
物品是角色能力的核心载体，消耗品影响HP/MP和临时增益，装备影响角色属性加成。物品操作必须与角色状态同步更新，否则会出现"使用了药水但HP未恢复"或"装备了武器但属性未增加"等状态不一致问题。

## 完成的标准是什么
1. inventory_service 对应方法返回成功状态码
2. 消耗品效果已通过 character_service 应用到角色
3. 装备变更后角色属性已通过 character_service.get_full_status 验证更新
4. 操作叙事已生成并返回

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `inventory_service.list_inventory` — 获取角色完整背包列表，验证物品是否存在
2. 调用 `character_service.get_full_status` — 获取角色当前状态，用于计算效果和验证变更
3. 调用 `skill_service.check_cooldown` — 检查物品关联技能的冷却状态（如物品附带技能效果）
4. 调用 `inventory_service.use_item` — 使用消耗品，扣减数量并返回效果数据
5. 调用 `character_service.modify_health` — 应用治疗效果（当 effects 中含 heal 类型时）
6. 调用 `character_service.modify_mana` — 应用法力恢复效果（当 effects 中含 mana 类型时）
7. 调用 `inventory_service.equip_item` — 装备物品到指定槽位
8. 调用 `inventory_service.unequip_item` — 卸下装备回背包
9. 调用 `inventory_service.remove_item` — 丢弃物品
10. 调用 `coordinator_service.spawn_agent` — 派发 output 子Agent 生成操作叙事

### 注意事项
- 使用消耗品前必须通过 list_inventory 确认物品存在且数量大于0
- 装备物品前需确认物品类型与装备槽位匹配，卸下装备前需确认该槽位有物品
- 装备操作必须成对处理：装备新物品时先 unequip_item 卸下旧装备，再 equip_item 装备新物品
- 物品效果数值由 numerical_service 计算，GameMasterAgent 不自行计算
- 如果物品附带技能效果（如卷轴），需额外调用 skill_service.use_skill 执行技能
- 丢弃物品使用 remove_item，需指定数量

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "物品操作完成",
  "data": {
    "operationType": "use|equip|unequip|drop",
    "itemName": "string",
    "success": true,
    "effectsApplied": [],
    "statusVerified": true
  }
}
```
