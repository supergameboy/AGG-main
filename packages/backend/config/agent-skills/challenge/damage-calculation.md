---
name: damage-calculation
description: 计算战斗伤害并更新战斗状态
targetAgent: ["combat"]
trigger: [combat_start, combat_turn]
whenToUse: 需要计算伤害或执行战斗回合时使用
recommendedTools: [combat_service, numerical_service]
relatedRules: [combat-safety]
completionCriteria: 伤害计算完成、战斗状态已更新、状态效果已处理
version: "2.0"
enabled: true
---

# 伤害计算

## 任务是什么
执行战斗中的伤害计算，包括普通攻击和技能伤害，处理暴击、防御减免、状态效果等战斗机制，更新战斗状态。

## 为什么有这个任务
伤害计算是战斗系统的核心逻辑，涉及攻击力、防御力、技能倍率、暴击、随机浮动等多个因素。需要按固定公式计算并更新战斗状态，确保战斗结果准确一致。

## 完成的标准是什么
1. 伤害已通过 `combat_service.calculate_damage` 计算或通过 `execute_turn` 执行
2. 暴击判定已完成
3. 防御减免已正确应用
4. 战斗状态已更新（HP变化、状态效果变化）
5. 战斗结束判定已完成

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `combat_service.get_combat_state` — 获取当前战斗状态
2. 调用 `combat_service.calculate_damage` — 纯计算伤害（预判用）
3. 调用 `combat_service.execute_turn` — 执行回合行动（含伤害计算和状态更新）
4. 调用 `combat_service.get_status_effects` — 获取当前状态效果
5. 调用 `combat_service.check_combat_end` — 检查战斗是否结束

### 伤害计算公式参考
```
finalDamage = floor((baseDamage × skillMult + attack × attack_contribution + levelBonus - defense × defense_reduction_coeff) × (1 - defendReduction) × variance × criticalMultiplier)
```
- 暴击概率：threshold / 20（默认10%）
- 暴击倍率：默认1.5
- 伤害浮动：0.9~1.1
- 最终伤害保底为1

### 注意事项
- `calculate_damage` 是纯计算不修改状态，用于预判；`execute_turn` 会实际修改战斗状态
- 防御姿态（isDefending=true）提供额外减伤
- 技能伤害使用 skill.baseDamage 替代攻击力，skill.multiplier 作为倍率
- 每回合执行后必须调用 `check_combat_end` 判断战斗是否结束
- 状态效果（中毒、灼烧等）在回合结束时处理

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "伤害计算完成",
  "data": {
    "damageDealt": 0,
    "isCritical": false,
    "combatEnded": false,
    "statusEffects": []
  }
}
```
