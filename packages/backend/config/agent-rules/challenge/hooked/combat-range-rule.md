---
name: combat-range-rule
description: 战斗中射程规则约束，melee技能只能攻击近战范围敌人，ranged技能可攻击任意范围敌人
targetAgent: [combat, gamemaster]
alwaysApply: false
hook: [combat]
whenToUse: 战斗回合执行时，LLM描述战斗行为和判断攻击合法性
---

# 射程规则

## 射程分类
技能的 `range` 字段定义射程等级：
- `melee`：近战范围，只能攻击相邻敌人
- `short`：短程，可攻击近距离敌人
- `medium`：中程，可攻击中距离敌人
- `long`：远程，可攻击任意距离敌人

## 射程约束
1. melee 技能只能对近战范围内的目标使用
2. ranged 技能（short/medium/long）可对任意范围目标使用
3. 角色可通过移动改变与敌人的距离，从而改变可攻击范围
4. 战斗描述中应体现射程差异——近战角色需要接近敌人，远程角色可以保持距离

## 距离判断
- 初始距离由战斗场景决定（遭遇战默认近战距离，伏击默认远程距离）
- 移动动作可改变距离：接近（缩短1级距离）或后撤（增加1级距离）
- 距离等级：adjacent → close → medium → far
