---
name: quest-progress
description: 更新任务进度和目标完成状态
targetAgent: ["quest"]
trigger: [quest_update, quest_check, quest_progress]
whenToUse: 需要更新任务目标进度、推进任务状态、检查任务完成条件时
recommendedTools: [quest_service]
relatedRules: [quest-core]
completionCriteria: 任务进度已正确更新、目标状态已同步
version: "2.0"
enabled: true
---

# 任务进度更新

## 任务是什么
更新任务的目标进度和任务状态，包括增量更新目标进度、检查任务是否可完成、推进任务状态流转。支持事件触发自动进度更新和混合进度追踪模式。

## 为什么有这个任务
任务进度是玩家游戏体验的核心驱动力。玩家击败怪物、收集物品、与NPC对话等行为需要反映到任务目标进度上，任务系统需要准确追踪和更新这些进度。

## 完成的标准是什么
1. 目标进度已通过 `quest_service.update_objective` 正确更新
2. 已通过 `quest_service.check_completion` 检查任务是否可完成
3. 若所有目标已达成，已调用 `quest_service.complete_quest` 完成任务
4. 进度更新后任务状态与实际游戏状态一致

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `quest_service.get_quest` — 获取任务详情和目标列表

2. 调用 `quest_service.update_objective` — 增量更新目标进度

3. 调用 `quest_service.check_completion` — 检查任务是否可完成

4. 调用 `quest_service.update_quest` — 更新任务属性（名称、描述、自定义数据等）

### 事件触发机制
目标可配置 `eventTrigger` 字段，指定触发自动进度更新的 EventBus 事件类型：
- 当 EventBus 发布匹配的事件时，系统自动调用 `quest_service.update_objective` 更新对应目标进度
- `eventTrigger` 为可选字段，未配置的目标仍由 LLM 主动更新进度
- 混合进度追踪模式：LLM 主动更新 + EventBus 事件监听自动更新，两者共存互补

### 注意事项
- `update_objective` 是增量模式，传入 delta 而非绝对值，进度自动钳制在 0~required 范围
- objectiveId 必须从 `get_quest` 返回的 objectives 数组中获取，不可编造
- 更新目标进度不会自动完成任务，需在所有目标完成后调用 `complete_quest`
- 通过 `update_quest` 修改 status 不会触发关联逻辑（如奖励发放），完成时应使用 `complete_quest`
- 建议每次更新进度后调用 `check_completion` 确认任务状态
- locked 状态的任务不接受进度更新，必须先解锁

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "任务进度更新完成",
  "data": {
    "questId": "string",
    "objectiveUpdated": "string",
    "currentProgress": 0,
    "requiredProgress": 0,
    "canComplete": false
  }
}
```
