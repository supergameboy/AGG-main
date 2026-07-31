---
name: time-core
alwaysApply: true
targetAgent: [time]
description: 时间核心规则，时间推进约束
priority: 90
---

# 时间核心规则

- 时间只能向前推进，不可回退
- 时间推进量必须与行动类型匹配（战斗回合、旅行、休息等）
- 时间段变化（昼夜、季节）影响游戏世界状态
- 并行行动的时间消耗取最大值，不叠加
