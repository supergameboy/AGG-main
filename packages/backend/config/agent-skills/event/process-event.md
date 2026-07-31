---
name: process-event
description: 处理已触发的事件，执行事件效果
targetAgent: ["event"]
trigger: [process_event]
whenToUse: 玩家做出事件选择、事件条件已满足需要结算时
recommendedTools: [event_service, game_time_service]
relatedRules: [event-core]
completionCriteria: 事件触发已解决、结果已记录、影响已生效
version: "2.0"
enabled: true
---

# 处理事件

## 任务是什么
处理已触发的事件，根据玩家选择或条件判定解决事件，记录事件结果到故事记录，并使事件影响生效。

## 为什么有这个任务
事件触发后进入待处理状态，需要玩家做出选择或系统自动判定结果。解决过程必须记录到故事事件中，保证剧情连贯性和可追溯性。部分事件还会触发时间推进或随机事件检定。

## 完成的标准是什么
1. 待处理事件已通过 `event_service.get_pending_triggers` 获取
2. 事件已通过 `event_service.resolve_trigger` 解决
3. 结果已通过 `event_service.record_story_event` 记录到故事事件
4. 如需随机事件检定，已通过 `event_service.roll_random_event` 执行
5. 如需时间推进，已通过 `game_time_service.advance_time` 执行

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `event_service.get_pending_triggers` — 获取待处理的触发列表
2. 调用 `event_service.resolve_trigger` — 解决事件触发
3. 调用 `event_service.record_story_event` — 记录故事事件
4. 调用 `event_service.roll_random_event` — 随机事件检定（当事件效果包含随机触发时使用）
5. 调用 `game_time_service.advance_time` — 推进游戏时间（当事件效果包含时间消耗时使用）

### 注意事项
- 必须先获取待处理列表，再逐个解决，避免遗漏
- `resolve_trigger` 的 `resultData` 必须包含玩家选择（如有选项）
- `record_story_event` 应在 `resolve_trigger` 成功后调用，记录解决结果
- 随机事件检定仅在事件效果明确要求时执行，不是每个事件都需要
- 时间推进仅在事件效果明确消耗时间时执行
- EventBus自动通知其他系统（QuestService检查目标、StoryKernel更新投影），不需要手动通知
- 当StoryDirective包含events字段时，优先按Directive指令执行，参见 directive-event 技能

### 怎么判断任务完成
事件已解决、结果已记录、影响已生效，返回给 GameMasterAgent 的数据格式：
```json
{
  "completed": true,
  "summary": "事件已处理：{title}",
  "data": {
    "triggerId": "",
    "eventId": "",
    "resolved": true,
    "choice": "",
    "effects": [],
    "storyRecordId": "",
    "timeAdvanced": false,
    "randomEventTriggered": false
  }
}
```
