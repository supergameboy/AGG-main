---
name: player-movement
description: 处理玩家在游戏世界中的移动请求
targetAgent: [gamemaster]
trigger: [move, explore]
whenToUse: 玩家表达前往某地、旅行、探索新区域的意图时
recommendedTools: [map_service, npc_service, game_time_service, event_service]
relatedRules: [move-safety]
completionCriteria: 玩家已到达目标地点、移动时间已消耗、可能触发的事件已处理
version: "2.0"
enabled: true
---

# 玩家移动

## 任务是什么
将玩家从当前位置移动到目标地点，处理移动过程中的时间消耗，检查到达后的事件触发，生成移动叙事。

## 为什么有这个任务
移动是玩家探索游戏世界的基本操作。移动涉及位置变更、时间消耗、事件触发三个关联动作，需要统一编排确保一致性。没有移动管理，玩家无法在游戏世界中推进，也无法触发地点相关的事件和任务。

## 完成的标准是什么
1. `map_service.get_current_location` 返回的位置为目标地点
2. `game_time_service.advance_time` 已被调用，游戏时间已根据移动距离推进
3. 如果存在满足条件的事件，`event_service.check_triggers` 和 `event_service.trigger_event` 已被调用
4. 移动叙事文本已通过 output Agent 生成并返回给玩家

## 怎么完成任务

### 调用什么子Agent派发什么任务
- 子Agent类型：map
- 派发任务描述：执行移动操作，验证路径可达性，返回移动结果
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "map",
    "task": "执行玩家移动",
    "action": "move_player",
    "context": {
      "currentLocation": "<从map_service.get_current_location获取>",
      "targetLocationId": "<目标地点ID>",
      "targetLocationName": "<目标地点名称>",
      "connectedLocations": "<从map_service.get_connected_locations获取>"
    }
  }
  ```

- 子Agent类型：output
- 派发任务描述：根据移动结果生成到达叙事
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "output",
    "task": "生成移动叙事",
    "action": "generate_narrative",
    "context": {
      "fromLocation": "<移动前位置>",
      "toLocation": "<从map_service.get_current_location获取的新位置>",
      "travelDescription": "<移动过程描述>",
      "nearbyNpcs": "<从npc_service.get_npcs_by_location获取>"
    }
  }
  ```

### 注入哪些条目的信息
1. 从 `map_service.get_current_location` 获取当前位置信息，注入给 map Agent 作为移动起点
2. 从 `map_service.get_connected_locations` 获取相邻可到达地点列表，注入给 map Agent 用于路径验证
3. 从 `game_time_service.get_current_time` 获取当前游戏时间，用于计算移动后的时间
4. 移动完成后，从 `map_service.get_current_location` 获取新位置信息，注入给 output Agent 用于场景描述
5. 从 `npc_service.get_npcs_by_location` 获取新地点的NPC列表，注入给 output Agent 用于场景描述

### 注意事项
1. 移动前必须确认目标地点可达，调用 `map_service.get_connected_locations` 验证目标在相邻地点列表中
2. 如果目标地点不在相邻列表中，向玩家说明无法直接到达，并提供可到达地点列表
3. 如果玩家意图不明确（如"去城里"但当前有多个城市可达），调用 `map_service.get_connected_locations` 获取列表后让玩家选择
4. `npc_service.move_to` 支持 targetLocationId 或 targetLocationName 参数，优先使用 ID
5. 探索当前地点使用 `map_service.explore_location`，不是移动操作
6. 移动后必须调用 `game_time_service.advance_time`，actionType 为 "travel"，distance 为移动距离
7. 移动后必须调用 `event_service.check_triggers`，eventType 为 "enter_location"，context 包含新位置信息
8. 如果事件触发，调用 `event_service.trigger_event` 执行事件，并将事件结果注入给 output Agent

### 收到子Agent返回的结果之后执行什么操作
1. **判断 map Agent 任务是否成功**：检查返回结果中是否包含移动成功标识和新位置信息
2. **移动成功后**：
   - 调用 `game_time_service.advance_time` 推进游戏时间
   - 调用 `event_service.check_triggers` 检查事件触发（eventType: "enter_location"）
   - 如果有触发事件，调用 `event_service.trigger_event` 执行事件
   - 派发 output Agent 生成移动叙事
3. **移动失败后**：如果 map Agent 返回目标不可达，向玩家说明原因并提供 `map_service.get_connected_locations` 返回的可到达地点列表
4. **最终向玩家输出**：移动叙事文本，包含旅途描述、到达场景、新地点的NPC和可交互内容
