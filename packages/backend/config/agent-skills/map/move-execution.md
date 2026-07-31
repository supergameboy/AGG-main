---
name: move-execution
description: 执行角色移动到目标地点
targetAgent: ["map"]
whenToUse: 玩家意图为移动到相邻地点（intentHint=travel/move）或快速旅行到远处地点（intentHint=teleport）时
recommendedTools: [map_service, npc_service]
relatedRules: [map-core, location-safety]
completionCriteria: 角色已移动到目标地点、位置已更新、移动结果已返回
version: "2.0"
enabled: true
---

# 执行移动

## 任务是什么
将角色从当前位置移动到目标地点。支持两种移动方式：普通移动（相邻地点）和快速旅行（远距离地点）。

## 为什么有这个任务
玩家在游戏世界中需要通过移动来探索不同地点。移动必须验证可达性，确保角色只能移动到合法的目标地点。

## 完成的标准是什么
1. 已通过 `map_service.get_current_location` 确认当前位置
2. 已通过 `map_service.get_connected_locations` 或 `map_service.get_reachable_locations` 验证目标可达
3. 已通过 `npc_service.move_to` 或 `npc_service.quick_travel` 执行移动
4. 移动结果已确认角色位置已更新

## 怎么完成任务

### 调用什么工具完成什么操作

#### 普通移动（相邻地点）
1. 调用 `map_service.get_current_location` — 获取角色当前位置
2. 调用 `map_service.get_connected_locations` — 获取相邻可到达地点，验证目标在列表中
3. 调用 `npc_service.move_to` — 执行移动到相邻目标地点

#### 快速旅行（远距离地点）
1. 调用 `map_service.get_current_location` — 获取角色当前位置
2. 调用 `map_service.get_navigation_path` — 计算路径，确认可达性
3. 调用 `npc_service.quick_travel` — 执行快速旅行到目标地点

### 注意事项
- 普通移动只能移动到与当前位置直接相连的地点
- 快速旅行消耗资源（金币），需确认玩家同意
- 目标地点不在可达列表时禁止移动，需告知玩家可达范围
- 移动必须通过工具执行，禁止在未调用工具的情况下声称玩家已移动

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "角色移动完成",
  "data": {
    "fromLocationId": "",
    "toLocationId": "",
    "toLocationName": "",
    "moveType": "move|quick_travel"
  }
}
```
