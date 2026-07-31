---
name: item-pool-init
description: 基于预注入的模板数据和池数据初始化角色物品池并装备适合的物品
targetAgent: ["inventory"]
trigger: [item_pool_init]
whenToUse: 初始化阶段为角色生成物品池并装备初始装备
recommendedTools: [inventory_service]
relatedRules: [inventory-core]
completionCriteria: 角色已装备 GM 指定数量且适合职业的可装备物品、装备覆盖多个槽位、背包和装备列表可查到已装备物品
version: "2.2"
enabled: true
---

# 物品池初始化

## 任务是什么
基于预注入的"模板数据.物品定义"和"池数据.物品"两类数据源，为角色装备 GM 指定数量且适合职业的可装备物品。

## 为什么有这个任务
初始化阶段需要为角色配置物品和装备。物品数据已由游戏数据处理器预注入到上下文，包含两类数据源：
- **模板数据.物品定义**：YAML 种子定义的物品（确定存在）
- **池数据.物品**：模板池 DB 中已审核的可复用物品（可能为空，非空时质量更高）

无需主动查询数据库。GM 根据游戏情况在派发任务时指定装备数量和质量要求，子 Agent 基于注入数据自主选择具体物品。调用 equip_item 时系统自动完成"模板池查找→字段合并→复制到存档池→背包→装备"全链路。

## 完成的标准是什么
1. 角色已装备 GM 派发任务中指定数量的可装备物品
2. 装备的物品适合角色职业（recommendedClasses 作为参考，非硬性筛选）
3. 装备覆盖多个槽位，避免只装备单一槽位
4. 调用 inventory_service.list_inventory 确认背包物品
5. 调用 inventory_service.get_equipment 确认装备状态

## 怎么完成任务

### 调用什么工具完成什么操作
1. 读取 injectedContext 中的"模板数据.物品定义"和"池数据.物品"文本块——获取两类可用物品列表
2. 根据 GM 派发任务中的数量要求，结合角色职业特点自主选择具体可装备物品（recommendedClasses 作为参考）
3. 调用 inventory_service.equip_item——按名称装备选定的可装备物品（系统自动完成模板池查找→字段合并→复制到存档池→背包→装备；若池数据+模板数据均无该名称，则需传入全部字段创建）
4. 调用 inventory_service.add_item_from_pool——取用适合角色的不可装备物品（如消耗品）到背包
5. 调用 inventory_service.list_inventory——确认背包物品
6. 调用 inventory_service.get_equipment——确认装备状态

### 注意事项
1. 禁止调用 list_template_items / list_template_skills 工具——数据已预注入到上下文
2. 应装备多个槽位的物品，避免只装备单一槽位（不能只装备武器，也不能只装备防具，应多槽位搭配）
3. recommendedClasses 作为参考，允许根据角色特点自主选择非推荐但适合的物品，增加游戏随机性
4. 装备的物品名称必须与注入数据中的 name 字段完全一致
5. equip_item 内置四级查找（背包→存档池→模板池→字段齐全创建+回写模板池），覆盖全链路。禁止调用 add_pool_item——模板池由程序自动管理，Agent 无需也无法手动管理

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "物品池初始化完成",
  "data": {
    "equippedCount": "<GM 派发的数量>",
    "equippedItems": ["<实际装备的物品名称列表>"],
    "slotsCovered": ["<实际覆盖的槽位列表>"]
  }
}
```
