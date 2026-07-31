---
name: calculate-stats
description: 重新计算角色的派生属性并持久化
targetAgent: ["inventory", "combat"]
trigger: []
whenToUse: 角色升级需要重算属性、装备变更影响派生属性、需要查询角色面板数据时
recommendedTools: [numerical_service, character_service]
relatedRules: [numerical-core]
completionCriteria: 派生属性已计算并持久化、角色面板数据已更新
version: "3.0"
enabled: true
---

# 计算属性

## 任务是什么
根据角色基础属性重新计算派生属性（如攻击力、防御力、生命上限等），并将结果持久化到角色数据中。

## 为什么有这个任务
角色的派生属性由基础属性通过公式推导而来，当基础属性因升级、装备变更等原因发生变化时，派生属性必须重新计算并持久化，否则角色面板和战斗数值会不一致。

## 完成的标准是什么
1. 角色当前基础属性已获取
2. 派生属性已通过 numerical_service 计算完成
3. 计算结果已持久化到角色数据
4. 返回结果包含完整的基础属性和派生属性

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `character_service.get_full_status` — 获取角色完整状态面板
2. 调用 `numerical_service.calculate_derived_attributes` — 根据基础属性计算派生属性（仅计算，不持久化）
3. 调用 `numerical_service.calculate_stats` — 重新计算并持久化派生属性

### 注意事项
- calculate_derived_attributes 是纯计算，不修改数据；calculate_stats 会计算并持久化
- 如果只需查看派生属性而不需要保存，使用 calculate_derived_attributes
- 如果基础属性已变更且需要生效，必须使用 calculate_stats 持久化
- 此技能会修改角色状态，调用前确认属性变更已确定

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "角色派生属性已重算并持久化",
  "data": {
    "attributes": {},
    "derivedAttributes": {},
    "level": 1
  }
}
```
