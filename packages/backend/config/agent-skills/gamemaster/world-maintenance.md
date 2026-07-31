---
name: world-maintenance
description: 维护游戏世界的一致性，补充缺失的地点描述和NPC信息
targetAgent: [gamemaster]
trigger: []
whenToUse: 发现地点描述过于简略、NPC信息不完整、世界设定出现空白时
recommendedTools: [map_service, npc_service, event_service, game_time_service, coordinator_service]
relatedRules: []
completionCriteria: 所有已访问地点有完整描述、所有已遇见NPC有完整信息
version: "2.0"
enabled: true
---

# 世界维护

## 任务是什么
维护游戏世界的一致性，处理NPC迁移、地点更新、事件触发等操作，确保世界状态与游戏进程同步，补充缺失的地点描述和NPC信息。

## 为什么有这个任务
游戏世界是动态变化的：NPC会移动、地点会因事件改变、时间推进会触发新事件。如果缺少统一的世界维护机制，会出现NPC位置与剧情矛盾、地点描述过时、事件未及时触发等问题，破坏游戏逻辑一致性。

## 完成的标准是什么
1. 调用的map_service/npc_service/event_service方法均返回成功状态码
2. 地点属性（描述、危险等级、关联NPC等）已通过 `map_service.update_location` 持久化更新
3. NPC位置已通过 `npc_service.move_npc` 正确迁移
4. 触发的事件已通过 `event_service.check_triggers` 或 `event_service.roll_random_event` 检定并记录
5. 游戏时间已通过 `game_time_service.advance_time` 正确推进

## 怎么完成任务

### 调用什么子Agent派发什么任务
- 子Agent类型1：map（地点管理）
- 派发任务描述：创建新地点或更新现有地点属性
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "map",
    "task": "更新地点信息",
    "action": "update_location",
    "context": {
      "locationId": "loc-forest-01",
      "updates": [
        {
          "locationId": "loc-forest-01",
          "description": "浓雾笼罩的古老森林，树木遮天蔽日",
          "dangerLevel": 3
        }
      ]
    }
  }
  ```

- 子Agent类型2：event（事件处理）
- 派发任务描述：检查并触发世界事件
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "event",
    "task": "检查事件触发",
    "action": "check_triggers",
    "context": {
      "eventType": "location_change",
      "context": { "locationId": "loc-forest-01", "timePeriod": "night" }
    }
  }
  ```

- 子Agent类型3：npc_party（NPC管理）
- 派发任务描述：迁移NPC到新位置
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "npc_party",
    "task": "迁移NPC位置",
    "action": "move_npc",
    "context": {
      "moves": [
        { "npcId": "npc-merchant-01", "targetLocationId": "loc-town-02" }
      ]
    }
  }
  ```

### 注入哪些条目的信息
1. 从 `map_service.get_current_location` 获取角色当前位置，作为世界维护的基准点
2. 从 `map_service.get_connected_locations` 获取相邻地点，用于判断哪些地点需要更新
3. 从 `npc_service.get_npcs_by_location` 获取各地点的NPC分布，用于判断NPC是否需要迁移
4. 从 `game_time_service.get_current_time` 获取当前游戏时间，用于判断时间相关事件
5. 从 `game_time_service.get_period_of_day` 获取时段（早晨/白天/傍晚/夜晚），影响事件触发和地点描述

### 注意事项
1. NPC迁移前必须确认目标地点存在（通过map_service查询），不存在时需先通过 `map_service.create_location` 创建
2. 地点更新使用 `map_service.update_location`，参数updates数组中每个元素必须包含locationId
3. 事件触发顺序：先 `event_service.check_triggers` 检查条件事件，再 `event_service.roll_random_event` 检定随机事件
4. 时间推进使用 `game_time_service.advance_time`，必须传入actionType（如"travel"、"rest"）和对应的distance或restHours参数
5. 多个NPC迁移可以合并为一次 `npc_service.move_npc` 调用，moves数组包含所有迁移项

### 收到子Agent返回的结果之后执行什么操作
1. **判断子Agent任务是否成功**：检查每个子Agent返回的success字段是否为true
2. **成功后更新状态**：
   - map子Agent成功：地点数据已持久化，无需额外操作
   - event子Agent成功：若返回了触发的事件，调用 `event_service.record_story_event` 记录到故事上下文
   - npc_party子Agent成功：NPC位置已迁移，无需额外操作
3. **失败后处理**：记录失败的子Agent类型和错误信息，跳过该子步骤继续执行其他维护任务，不回滚已成功的操作
4. **最终向玩家输出**：世界维护为后台操作，不直接向玩家输出；若维护触发了可感知的事件（如随机事件），则通过output Agent生成叙事后输出
