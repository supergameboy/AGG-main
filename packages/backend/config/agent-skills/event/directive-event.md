---
name: directive-event
description: 执行StoryDirective事件指令中的事件操作
targetAgent: ["event"]
trigger: [directive_event]
whenToUse: 用户意图为按指令执行事件操作（intentHint=directive_event），或StoryDirective中包含events字段时
recommendedTools: [event_service]
relatedRules: [event-core]
completionCriteria: Directive中的事件指令已按优先级全部执行
version: "2.0"
enabled: true
---

# Directive Event — 按指令执行事件操作

## 任务是什么
按StoryDirective的events字段执行事件操作，包括检查触发、调度事件和记录故事事件。

## 为什么有这个任务
StoryKernel根据故事进展生成Directive事件指令，Event Agent必须按指令优先级执行，确保故事走向与系统状态一致。Directive模式避免Agent自行决策导致偏离故事规划。

## 完成的标准是什么
1. checkTriggers指令中的每个触发类型已通过 `event_service.check_triggers` 检查
2. scheduleEvents指令中的每个事件模板ID已通过 `event_service.trigger_event` 触发
3. recordStoryEvent指令为true时已通过 `event_service.record_story_event` 记录
4. 所有操作结果已汇总返回给GameMasterAgent

## 怎么完成任务

### 调用什么工具完成什么操作
1. 读取上下文中的StoryDirective.events字段，获取三个指令：
   - `checkTriggers`: 需要检查的触发类型列表
   - `scheduleEvents`: 需要触发的事件模板ID列表
   - `recordStoryEvent`: 是否记录本轮为故事事件

2. 调用 `event_service.check_triggers` — 检查指定触发类型（仅当checkTriggers非空时）
3. 调用 `event_service.trigger_event` — 触发指定事件（仅当scheduleEvents非空时）
4. 调用 `event_service.record_story_event` — 记录故事事件（仅当recordStoryEvent为true时）

### 注意事项
- Directive模式下按指令执行，不自行决策触发哪些事件
- 执行优先级：check_triggers > trigger_event > record_story_event
- 如果指令不明确，使用自主判断补充
- 所有事件操作完成后，EventBus自动通知QuestService和StoryKernel

### 怎么判断任务完成
Directive中所有事件指令已执行，返回给GameMasterAgent的数据格式：
```json
{
  "completed": true,
  "summary": "Directive事件指令已执行",
  "data": {
    "checkedTriggers": ["enter_location", "combat_end"],
    "triggeredEvents": ["shadow-creature-attack"],
    "storyEventRecorded": true,
    "results": {
      "triggersChecked": 2,
      "triggersSatisfied": 1,
      "eventsTriggered": 1,
      "storyEventRecorded": true
    }
  }
}
```
