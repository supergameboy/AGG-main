---
name: npc-equipment-init
description: NPC装备初始化——通过模板池浏览并取用物品，优先从模板池复制
targetAgent: [npc_party]
trigger: [npc_equipment_init]
whenToUse: NPC首次需要物品数据时（战斗、交易、偷窃等场景），需初始化装备
recommendedTools: [inventory_service, template_pool_service, npc_service]
relatedRules: [npc-core]
completionCriteria: NPC装备已分配并写入数据库
version: "3.0"
enabled: true
---

# NPC装备初始化

## 任务是什么
为NPC分配初始装备，优先从模板池浏览并取用物品。模板池有数据时，按推荐分类浏览后直接装备；模板池无数据时，回退到手动创建。

## 为什么有这个任务
NPC在首次需要物品数据时（战斗、交易、偷窃等场景），必须先初始化装备。模板池提供预构建的物品供直接复制取用，减少LLM生成开销，确保NPC与角色共享同一物品来源。

## 完成的标准是什么
1. NPC物品初始化状态已检查，未初始化时执行初始化
2. 匹配NPC角色和等级的物品已取用并装备
3. NPC已标记为物品已初始化

## 怎么完成任务

### Step 0：检查模板池数据
调用 `template_pool_service.get_template_pool_stats()` 检查模板池中是否有物品数据。
- 如果返回的物品数量 > 0，进入 Step 1（模板池路径）
- 如果返回的物品数量 = 0，进入 Step 2（回退路径）

### Step 1（模板池有数据）：浏览并直接装备
1. 调用 `npc_service.get_npc` — 获取NPC的name/role/race/level/description
2. 调用 `template_pool_service.list_template_items({ recommendedClass: 'NPC角色' })` 按推荐分类浏览模板池物品
3. 从浏览结果中选择适合NPC的物品，调用 `inventory_service.equip_item({ inventoryId: '物品名', ownerType: 'npc' })` 直接装备
4. 消耗品使用 `inventory_service.add_item_from_pool({ poolItemIdOrName: '物品名', ownerType: 'npc', ownerId: npcId })` 添加到NPC背包
5. 调用 `npc_service.mark_inv_initialized` — 标记NPC物品已初始化

物品按NPC角色选择：
- 战士类NPC：武器+重甲+盾牌
- 法师类NPC：法杖+法袍+饰品
- 盗贼类NPC：匕首+皮甲+工具
- 商人类NPC：更多商品类物品

### Step 2（模板池无数据）：回退到手动创建
1. 调用 `npc_service.get_npc` — 获取NPC的name/role/race/level/description
2. 调用 `inventory_service.equip_item({ inventoryId: '物品名', ownerType: 'npc', fullParams: { name, category, quality, stats, effects, value, equippedSlot: 'main_hand|off_hand|head|body|hands|feet|accessory' } })` 一步完成创建+取用+装备
3. 调用 `npc_service.mark_inv_initialized` — 标记NPC物品已初始化

### 注意事项
- 模板池有数据时，优先走浏览+装备的一步路径，无需手动 add_pool_item
- NPC物品默认visible=false（对玩家不可见），玩家偷窃或交易时可设为true
- 生成物品后必须调用 mark_inv_initialized，避免重复初始化

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "NPC装备初始化完成",
  "data": {
    "npcId": "string",
    "role": "string",
    "itemsEquipped": 3,
    "invInitialized": true
  }
}
```
