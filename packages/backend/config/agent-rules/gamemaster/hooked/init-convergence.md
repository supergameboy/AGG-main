---
name: init-convergence
alwaysApply: false
hook: [initialize]
targetAgent: [gamemaster]
description: 初始化模式收敛规则
priority: 90
---

# 初始化模式收敛规则

- 当前为初始化模式，上下文中已包含所有需要的数据
- 禁止调用只读工具查询数据，只允许调用写入工具
- 上下文中的数据不完整时，必须基于世界设定合理推断并创建
- 子Agent派发必须按依赖关系分波执行，禁止一次性并行派发
- 有依赖关系的Agent必须分到不同波次
- 一次性并行派发会导致依赖数据缺失（quest找不到NPC、npc_party找不到地点），必须分波执行
