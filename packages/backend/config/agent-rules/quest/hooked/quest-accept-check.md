---
name: quest-accept-check
alwaysApply: false
hook: [accept_quest]
targetAgent: [quest]
description: 任务接受前检查规则
priority: 85
---

# 任务接受前检查

- 接受任务前确认任务存在且状态为"available"（locked 状态的任务必须先解锁）
- 确认角色满足前置条件：所有 prerequisiteQuestIds 已完成，conditions.accept 条件已满足
- 同一任务不可重复接受
- 条件系统为参考性质而非强制执行：GM 可决定允许在条件未完全满足时接取任务
