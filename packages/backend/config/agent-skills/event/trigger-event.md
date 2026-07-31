---
name: trigger-event
description: 检查并触发满足条件的游戏事件
targetAgent: ["event"]
trigger: [trigger_event]
whenToUse: 满足事件触发条件、到达特定地点、完成特定任务后需要触发事件时
recommendedTools: [event_service]
relatedRules: [event-core]
completionCriteria: 事件触发条件已检查、满足条件的事件已触发、触发记录已创建
version: "2.0"
enabled: true
---

# 触发事件

## 任务是什么
检查当前游戏上下文中是否有满足触发条件的事件，如果有则激活事件并创建触发记录，返回事件内容供后续处理。

## 为什么有这个任务
游戏中的剧情事件、随机事件、条件触发事件需要统一的触发机制。当玩家行动导致上下文变化时，必须检查是否有事件满足触发条件，确保事件在正确的时机激活。

## 完成的标准是什么
1. 已通过 `event_service.check_triggers` 检查当前可触发的事件
2. 对满足条件的事件已通过 `event_service.trigger_event` 触发
3. 触发记录已创建
4. 返回结果包含事件ID、事件描述、可选项和影响

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `event_service.check_triggers` — 检查满足条件的事件触发
2. 调用 `event_service.trigger_event` — 触发事件
3. 调用 `event_service.get_pending_triggers` — 获取待处理的触发列表
4. 调用 `event_service.resolve_trigger` — 解决事件触发（当触发需要立即结算时使用）

### 注意事项
- `check_triggers` 只检查不触发，`trigger_event` 才会创建触发记录
- 同一事件可能因上下文不同产生多个触发，需逐个处理
- 触发后事件进入 pending 状态，需要由 process-event 技能或 `resolve_trigger` 解决
- 如果 `check_triggers` 返回空列表，说明当前无满足条件的事件，直接返回完成
- EventBus自动通知QuestService和StoryKernel，不需要手动通知
- 当上下文中包含eventDirective时，按指令执行：scheduleEvents中的每个事件模板ID调用 `trigger_event`

### 怎么判断任务完成
满足条件的事件已触发，触发记录已创建，返回给 GameMasterAgent 的数据格式：
```json
{
  "completed": true,
  "summary": "已触发{count}个事件",
  "data": {
    "triggeredEvents": [
      {
        "triggerId": "",
        "eventId": "",
        "description": "",
        "options": [],
        "impact": {}
      }
    ],
    "pendingCount": 0
  }
}
```
