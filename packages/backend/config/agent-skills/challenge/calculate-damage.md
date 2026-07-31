---
name: calculate-damage
description: 计算战斗伤害值（纯数值计算，不执行状态变更）
targetAgent: ["combat"]
trigger: [calculate_damage, combat_start]
whenToUse: 攻击命中需要计算伤害、技能造成伤害时
recommendedTools: [numerical_service]
relatedRules: [numerical-core, damage-calculation]
completionCriteria: 伤害值已计算、伤害类型已确定、抗性减免已应用
version: "2.0"
enabled: true
---

# 计算伤害

## 任务是什么
根据攻击者属性、防御者属性和技能公式，计算最终的伤害值。这是纯数值计算，不修改任何游戏状态。

## 为什么有这个任务
战斗系统需要在攻击命中时得出准确的伤害数值，伤害计算涉及基础威力、属性缩放、倍率、抗性减免等多个因子，必须由数值服务统一计算以保证一致性。

## 完成的标准是什么
1. 伤害值已通过 `numerical_service.calculate_damage` 计算得出
2. 伤害类型（物理/魔法/真实/固定）已确定
3. 抗性减免和脆弱加成已包含在计算结果中
4. 返回结果包含最终伤害值和关键计算因子

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `numerical_service.calculate_damage` — 计算伤害值

### 注意事项
- 此技能是纯计算工具，**不修改任何游戏状态**（不扣血、不消耗资源）
- 伤害类型为 "true" 时忽略防御和抗性；为 "fixed" 时忽略所有属性缩放和防御
- `resistance` 和 `vulnerability` 可同时存在，先应用脆弱加成再应用抗性减免
- 如果缺少 `attackerStat` 或 `defenderDefense`，计算将忽略对应因子

### 怎么判断任务完成
`numerical_service.calculate_damage` 返回了有效的伤害数值和类型，返回给 GameMasterAgent 的数据格式：
```json
{
  "completed": true,
  "summary": "计算伤害完成：{type}类型，最终伤害{damage}",
  "data": {
    "damage": 0,
    "type": "physical",
    "breakdown": {}
  }
}
```
