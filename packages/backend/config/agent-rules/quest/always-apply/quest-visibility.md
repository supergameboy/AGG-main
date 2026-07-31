---
name: quest-visibility
alwaysApply: true
targetAgent: [quest]
description: 任务可见性规则，约束 NPC 任务与系统任务的初始可见性
priority: 88
---

# 任务可见性规则

- NPC 发布的任务（giverNpcId 非空）创建时必须 `visible:false, status:locked`，禁止在 quest agent 创建时直接设为 `visible:true`
- 系统引导任务（giverNpcId 为空）创建时必须 `visible:true, status:active`，由 GM 在初始化阶段直接创建
- **初始化探索任务**是系统引导任务的一种特殊形式：在游戏初始化阶段创建，giverNpcId 为空，`visible:true, status:active`，内容引导玩家探索当前地点并接触故事主线的早期线索。每个新存档必须至少有 1 个初始化探索任务，保证玩家进入游戏后立即有事可做
- 主线任务（type=main）默认 `visible:false, status:locked`，由剧情 NPC 发布（giverNpcId 非空）。玩家通过与发布 NPC 对话触发后，由 gamemaster 的 dialogue-management 技能调用 `quest_service.update_quest` 将 `visible` 置为 true、`status` 置为 available
- NPC 任务的可见性由对话触发：玩家与发布 NPC 对话后，由 gamemaster 的 dialogue-management 技能触发 `quest_service.update_quest` 将 `visible` 置为 true、`status` 置为 available
- locked 状态的 NPC 任务不进入玩家任务面板，仅 available/active/completed/failed 状态的可见任务进入面板
- 系统引导任务不设前置任务（prerequisiteQuestIds 为空），保证初始化后立即可见可执行
