---
name: explore-location
description: 探索指定地点，发现隐藏内容和NPC
targetAgent: ["map"]
trigger: [explore]
whenToUse: 玩家主动探索周围环境、搜索隐藏物品、调查特定地点时
recommendedTools: [map_service]
relatedRules: [map-core, location-safety]
completionCriteria: 地点已标记为已探索、隐藏内容已揭示、探索结果已返回
version: "2.0"
enabled: true
---

# 探索地点

## 任务是什么
对指定地点进行探索，标记为已探索状态，揭示该地点的隐藏NPC和随机事件，返回探索发现的内容。

## 为什么有这个任务
游戏世界中地点可能包含隐藏的NPC和事件，玩家通过探索行为才能发现这些内容。探索需要协调地图服务、NPC服务和事件服务，按流程揭示隐藏内容。

## 完成的标准是什么
1. 已通过 `map_service.get_current_location` 确认当前位置（若未指定探索目标）
2. 已通过 `map_service.explore_location` 执行探索，地点标记为已探索
3. 探索结果包含：地点描述、隐藏内容揭示状态

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `map_service.get_current_location` — 获取角色当前位置（当未指定探索目标时使用当前位置）

2. 调用 `map_service.explore_location` — 执行探索，标记地点为已探索

### NPC和事件相关操作
NPC查询和事件检定由GM协调子Agent处理，map Agent不直接调用：
- NPC列表查询：由GM派发npc_party子Agent调用 `npc_service.get_npcs_by_location` 获取
- 随机事件检定：由GM派发event子Agent调用 `event_service.roll_random_event` 执行

### 注意事项
- `explore_location` 的 `locationId` 和 `locationName` 至少提供一个，优先使用 `locationId`
- 若指定了探索目标地点但角色不在该地点，需先通过 `npc_service.move_to` 移动到目标地点
- 随机事件检定由GM协调event子Agent执行，map Agent不直接调用 event_service
- 探索可能不触发随机事件（概率检定未通过），此时返回空事件
- 同一地点重复探索不会再次触发已揭示的隐藏内容

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "地点探索完成",
  "data": {
    "locationId": "",
    "locationName": "",
    "explored": true,
    "discoveredNpcs": [],
    "randomEvent": null
  }
}
```
