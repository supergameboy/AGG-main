---
name: advance-time
description: 推进游戏时间并处理时段变化
targetAgent: ["time"]
trigger: [advance_time]
whenToUse: 玩家执行任何行动需要消耗时间、休息等待、查看当前时间时
recommendedTools: [game_time_service, event_service]
relatedRules: [time-core]
completionCriteria: 游戏时间已推进、时段已更新、时间相关事件已检查
version: "2.0"
enabled: true
---

# 推进时间

## 任务是什么
根据玩家行动类型推进游戏时间，更新时段信息，并检查时间变化是否触发相关事件。

## 为什么有这个任务
游戏中的行动都消耗时间，时间推进会影响时段（白天/夜晚）、商店营业状态、随机事件触发等。时间系统是游戏节奏控制的核心，必须与事件系统联动。

## 完成的标准是什么
1. 游戏时间已通过 `game_time_service.advance_time` 推进
2. 推进后的时段信息已通过 `game_time_service.get_period_of_day` 获取
3. 时段变化已检查是否触发事件（通过 `event_service.check_triggers`）
4. 返回结果包含推进后的时间详情和时段信息

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `game_time_service.advance_time` — 推进游戏时间
   - 参数：`actionType`(string, req): 行动类型，可选值 "dialogue"/"move"/"explore"/"combat"/"trade"/"rest"/"use_item"/"quest_complete"/"save"/"status"/"cast_skill"/"quest_accept"
   - 参数：`distance`(number, opt): 移动距离（actionType 为 "move" 时使用）
   - 参数：`restHours`(number, opt): 休息时长（actionType 为 "rest" 时使用）
   - 返回：推进后的时间详情，包含 `currentTime`(object, 当前时间)、`timeAdvanced`(number, 推进量)、`periodChanged`(boolean, 时段是否变化)

2. 调用 `game_time_service.get_current_time` — 获取当前游戏时间详情
   - 参数：无
   - 返回：当前时间对象，包含 `day`(number)、`hour`(number)、`minute`(number)、`period`(string, 时段)

3. 调用 `game_time_service.get_period_of_day` — 获取当前时段
   - 参数：无
   - 返回：时段信息，包含 `period`(string, 如 "morning"/"afternoon"/"evening"/"night")、`description`(string, 时段描述)

4. 调用 `event_service.check_triggers` — 检查时间相关事件触发（时段变化时调用）
   - 参数：`eventType`(string, req): 固定传 "time"
   - 参数：`context`(object, opt): 传入时段上下文，如 `{ period: "night", previousPeriod: "evening" }`
   - 返回：满足条件的事件触发列表

### 注意事项
- `actionType` 决定了时间推进的基准量，不同行动消耗不同时长
- 移动类行动必须传 `distance`，休息类行动必须传 `restHours`
- 时段变化（`periodChanged` 为 true）时，必须调用 `event_service.check_triggers` 检查时间相关事件
- 如果只是查询当前时间而不推进，使用 `get_current_time` 而非 `advance_time`
- 时间推进是不可逆操作，调用前确认行动已确定

### 怎么判断任务完成
游戏时间已推进，时段信息已更新，时间相关事件已检查，返回给 GameMasterAgent 的数据格式：
```json
{
  "completed": true,
  "summary": "时间已推进：{actionType}，当前{period}",
  "data": {
    "currentTime": { "day": 1, "hour": 14, "minute": 30, "period": "afternoon" },
    "timeAdvanced": 30,
    "periodChanged": false,
    "triggeredEvents": []
  }
}
```
