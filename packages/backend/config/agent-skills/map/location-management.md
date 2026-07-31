---
name: location-management
description: 管理地点数据的创建、更新和删除
targetAgent: ["map"]
trigger: [explore, discover]
whenToUse: 需要创建新地点、更新地点描述或属性、删除地点时
recommendedTools: [map_service]
relatedRules: [map-core]
completionCriteria: 地点数据已正确创建或更新、连接关系已建立
version: "2.0"
enabled: true
---

# 地点管理

## 任务是什么
管理游戏世界中的地点数据，包括创建新地点、更新已有地点属性、删除不再需要的地点，确保地图数据的完整性和一致性。

## 为什么有这个任务
游戏世界需要动态扩展和调整地点数据。剧情推进可能解锁新区域、世界事件可能改变地点状态、废弃地点需要清理。这些操作需要按规范流程执行，避免数据不一致。

## 完成的标准是什么
1. 创建地点：`map_service.create_location` 或 `map_service.batch_create_locations` 已调用，地点ID已返回
2. 更新地点：`map_service.update_location` 已调用，更新后数据已确认
3. 删除地点：`map_service.delete_location` 已调用，删除结果已确认
4. 连接关系正确：新建地点的连接已单向建立

## 怎么完成任务

### 调用什么工具完成什么操作

#### 创建新地点
1. 调用 `map_service.create_location` — 创建单个新地点
2. 调用 `map_service.batch_create_locations` — 批量创建多个地点（推荐用于初始化或批量扩展地图）

#### 更新地点
3. 调用 `map_service.update_location` — 更新地点属性

#### 删除地点
4. 调用 `map_service.delete_location` — 删除地点

### 何时使用 batch_create_locations
- **批量创建场景**（初始化地图、一次性创建多个区域/建筑/房间）使用 `batch_create_locations`
- **单个地点创建**（剧情推进中新增一个地点）使用 `create_location`
- batch_create_locations 的优势：地点间可互相引用连接名称，无需关心创建顺序（内部先创建所有地点，再统一建立连接关系）

### 注意事项
- 创建地点时 locationLevel 必须为 1/2/3，parentLocationId 必须指向上一层级
- connections、events 参数为 JSON 数组字符串格式，如 `'["loc-001"]'`
- visible 默认为 false，起始地点应设为 true
- 3层结构：level=2的父地点必须是level=1(地图)，level=3的父地点必须是level=2(区域)
- 删除地点前需确认没有NPC驻留且角色不在该地点
- 更新 connections 时会整体替换旧连接，如需追加需先获取现有连接再合并

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "地点管理完成",
  "data": {
    "operation": "create|update|delete",
    "locationId": "string",
    "locationName": "string"
  }
}
```
