---
name: combat-safety
alwaysApply: false
hook: [combat_start]
targetAgent: [gamemaster]
description: 战斗开始前的安全检查
priority: 80
---

# 战斗开始前安全检查

- 攻击方和防御方的HP、MP必须有有效值，任一缺失则禁止启动战斗
- 双方至少装备了一件武器，或确认有无武器战斗能力，否则禁止启动战斗
- 战斗场景必须有有效的地点ID，否则禁止启动战斗
- 战斗状态必须通过工具创建，禁止仅生成战斗叙事文本
- 任一检查失败时禁止启动战斗，必须在叙事中自然地阻止战斗发生
