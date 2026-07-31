---
name: move-safety
alwaysApply: false
hook: [travel]
targetAgent: [gamemaster, map]
description: 移动安全检查，确保地点可达性
priority: 80
---

# 移动安全检查

- 目标地点必须存在且可达，通过工具查询当前可达的相邻地点验证
- 禁止编造不存在的地点或假装玩家已到达未解锁的地点
- 移动必须通过工具执行，禁止在未调用工具的情况下在叙事中声称玩家已移动
- 目标地点不在可达列表时禁止移动
