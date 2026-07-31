---
name: numerical-guidance
description: 指导Agent使用NumericalService进行数值计算，确保属性和伤害计算一致性
targetAgent: ["*"]
trigger: []
whenToUse: 需要计算角色属性、伤害、经验值等数值时
recommendedTools: [numerical_service, character_service]
relatedRules: [numerical-core]
completionCriteria: 数值计算已完成，属性已更新，结果已返回
version: "1.1"
enabled: true
---

# 数值计算指导

## 任务是什么
指导各Agent在需要数值计算时，正确调用NumericalService的对应方法，确保游戏数值的一致性和正确性。

## 为什么有这个任务
NumericalService是纯计算服务，不调用LLM，所有计算结果确定性可复现。各Agent必须通过NumericalService完成数值计算，避免自行估算导致数值不一致。装备属性加成从 inventory.stats 读取，不从外部表 JOIN。

## 完成的标准是什么
1. 数值计算已通过NumericalService完成
2. 需要持久化的结果已通过character_service写入
3. 返回结果包含完整的计算明细

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `numerical_service.calculate_derived_attributes` — 根据基础属性计算派生属性（仅计算，不持久化）
2. 调用 `numerical_service.calculate_stats` — 重新计算并持久化派生属性
3. 调用 `character_service.update_character` — 将计算结果写入角色数据
4. 调用 `numerical_service.calculate_damage` — 计算战斗伤害
5. 调用 `numerical_service.add_experience` — 增加经验值
6. 调用 `numerical_service.heal` — 计算治疗量

### 衰减曲线机制（v2.3）
模板 `game_rules.decay_curves` 配置定义命名衰减曲线，用于数值随时间/回合的非线性衰减：
- **linear**: 每回合固定减少 `rate` 值
- **exponential**: 每回合乘以 `(1 - rate)` 衰减因子
- **logarithmic**: 每回合除以 `(1 + rate * log(t+1))` 衰减因子
- 每条曲线设有 `floor` 下限值，衰减不会低于此值
- 技能冷却恢复可引用衰减曲线（`customData.decayCurve` 字段），实现非线性冷却恢复
- 衰减曲线由内部计算引擎自动应用，Agent 无需手动计算

### 注意事项
- NumericalService是纯计算服务，不直接修改数据库，需要持久化时调用character_service
- 装备属性加成从 inventory.stats 读取，不从外部表 JOIN
- InventoryService的equip_item和unequip_item已自动调用属性重算，通常不需要手动触发
- 不设独立的NumericalAgent——NumericalService由各Domain Agent按需调用，避免不必要的Agent调度开销

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "数值计算完成",
  "data": {
    "calculationType": "derived_attributes|stats|damage|experience|heal|decay",
    "result": {}
  }
}
```
