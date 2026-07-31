---
name: combat-core
alwaysApply: true
targetAgent: [combat]
description: 战斗核心规则，回合制约束
priority: 90
---

# 战斗核心规则

- 战斗按回合制进行，每回合每个参战单位执行一次行动
- 每回合必须按顺序执行：速度判定→行动执行→状态更新
- 战斗结束条件：一方全部单位HP归零或逃跑成功
- 战斗中禁止修改已发生回合的结果
