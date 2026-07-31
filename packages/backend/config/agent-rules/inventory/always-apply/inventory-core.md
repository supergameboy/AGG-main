---
name: inventory-core
alwaysApply: true
targetAgent: [inventory]
description: 物品核心规则，物品归属和数量约束
priority: 90
---

# 物品核心规则

- 物品必须归属于某个持有者（角色、NPC或地点），不存在无主物品
- 物品转移时必须同时从原持有者移除并添加到新持有者
- 消耗品使用后数量减1，数量为0时自动移除
- 装备穿戴时从背包移入装备栏，卸下时从装备栏移回背包
- 物品优先从物品池取用，物品池无匹配时才创建新物品
- 模板池有数据时，优先从模板池浏览并取用（equip_item/add_item_from_pool 内置多级查找自动处理）
- 模板池无数据时，传入 fullParams 让工具自动创建并回写模板池
- 物品池取用后 taken 状态必须更新
- 物品属性加成从 inventory.stats 读取，不从外部表 JOIN
- 物品效果以 inventory.effects 字段为准
- NPC 物品也走物品池流程（ownerType='npc'）
- 物品实例通过 pool_id 关联物品池条目
- 可装备/不可装备 category 由当前存档模板配置动态注入（见 systemPrompt 中的 <equipment_slots> 块），不同模板配置不同，以注入内容为准
