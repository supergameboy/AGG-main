---
name: quest-core
alwaysApply: true
targetAgent: [quest]
description: 任务核心规则，任务生命周期约束
priority: 90
---

# 任务核心规则

- 任务状态按固定流程流转：locked → available → active → completed/failed
- locked 状态由条件系统管理：前置任务未完成时自动锁定，前置任务全部完成后自动解锁
- 任务条件支持高级条件表达式（AdvancedCondition），包括 AND/OR/NOT 组合和 15 种原子条件类型（level/has_item/has_skill/has_status_effect/in_combat/resource_above/cooldown_ready/location_is/faction_above/attribute_above/chance 等）
- 任务目标必须可验证，有明确的完成条件
- 任务奖励在任务完成时发放，禁止提前发放
- 已完成的任务不可重复接受
- 放弃任务标记为 failed，GM 决定后续处理（是否可重新接取、是否影响NPC关系等）
- 技能奖励通过 skill_service.learn_skill 发放，默认可见
