---
name: pathfinding
description: 计算从当前位置到目标地点的导航路径
targetAgent: ["map"]
trigger: [move]
whenToUse: 玩家需要规划远距离旅行路线、查看如何到达某地点时
recommendedTools: [map_service]
relatedRules: [map-core]
completionCriteria: 路径已计算、途经地点已列出、旅行费用已估算
version: "2.0"
enabled: true
---

# 路径规划

## 任务是什么
计算从当前位置到目标地点的最短路径（BFS算法），列出途经地点，提供路径信息供玩家决策。

## 为什么有这个任务
玩家在远距离旅行时需要了解路径规划，包括途经哪些地点、是否可达、是否有更优路线。路径规划是移动和快速旅行的前置步骤。

## 完成的标准是什么
1. 已通过 `map_service.get_current_location` 获取起点位置
2. 已通过 `map_service.get_navigation_path` 计算最短路径
3. 若路径不可达，已通过 `map_service.get_reachable_locations` 确认可达范围
4. 路径结果包含：途经地点列表、路径是否可达

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `map_service.get_current_location` — 获取角色当前位置作为路径起点

2. 调用 `map_service.get_navigation_path` — 计算从起点到终点的BFS最短路径

3. 调用 `map_service.get_connected_locations` — 获取某地点的相邻可到达地点（用于路径不可达时的替代方案）

4. 调用 `map_service.get_reachable_locations` — 获取从当前位置可达的所有地点（路径不可达时提供可达范围）

### 注意事项
- `get_navigation_path` 的 `toLocationId` 为必需参数，必须提供目标地点ID
- 若路径不可达，需调用 `get_reachable_locations` 告知玩家可达范围，不可省略此步骤
- 路径计算结果中的途经地点列表按行进顺序排列，第一个为起点，最后一个为终点
- 若起点与终点相同，直接返回无需路径计算
- `get_connected_locations` 可用于展示某途经点的分支路线，辅助玩家决策

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "路径规划完成",
  "data": {
    "fromLocationId": "",
    "toLocationId": "",
    "reachable": true,
    "path": [],
    "pathLength": 0
  }
}
```
