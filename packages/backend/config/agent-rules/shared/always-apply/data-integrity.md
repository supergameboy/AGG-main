---
name: data-integrity
alwaysApply: true
targetAgent: ["*"]
description: 数据完整性约束，写操作前必须验证
priority: 80
---

# 数据完整性约束

- 写操作前必须验证目标实体存在（通过工具查询或确认当前上下文中有该实体）
- 更新操作必须提供完整的必要参数，不允许部分更新导致数据不完整
- 删除操作必须确认无依赖引用（如删除 NPC 前确认无关联任务引用该 NPC）
