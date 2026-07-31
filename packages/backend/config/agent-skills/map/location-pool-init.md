---
name: location-pool-init
description: 初始化时创建3层地点结构，MapAgent自行读取模板数据
targetAgent: [map]
trigger: [location_init]
whenToUse: 游戏初始化时由GameMaster派发，负责创建地图→区域→子地点3层结构
recommendedTools: [map_service, game_init_service]
relatedRules: [map-core]
completionCriteria: 3层地点结构已创建，连接已建立
version: "2.0"
enabled: true
---

# 地点初始化

## 任务是什么
游戏初始化时，读取模板地点数据，创建3层地点结构（地图→区域→子地点），建立地点间的连接。

## 为什么有这个任务
3层地点结构为游戏世界提供清晰的空间层次。地图是顶层容器，区域是可探索的区域，子地点是具体的交互场所。

## 完成的标准是什么
1. 至少1个地图级地点（level=1）
2. 至少3个区域级地点（level=2）
3. 每个区域至少2个子地点（level=3）
4. 地点间连接已建立

## 怎么完成任务

### Step 0：读取模板地点数据
调用 `game_init_service.get_template_data({ sections: ["locations", "starting_scene"] })`
获取地点数据和起始场景数据。`starting_scene.explorable_areas` 包含完整数据（description/type/danger_level/connections），作为地点创建的参考。

### Step 1：创建地图级地点（level=1）
调用 `map_service.create_location` 创建顶层地图。
- locationLevel: 1
- parentLocationId: 不传（顶层无父地点）
- 参考模板中的地图定义，丰富名称和描述

### Step 2：创建区域级地点（level=2）
调用 `map_service.create_location` 创建区域。
- locationLevel: 2
- parentLocationId: 指向 Step 1 创建的地图ID
- 参考模板中的区域定义
- **起始区域**：如果区域的 id 与 `starting_scene.location` 匹配，description 使用 `starting_scene.location_description`（地点本身的简短描述），禁止使用 `starting_scene.description`（那是给LLM的叙事素材，不是地点描述）

### Step 3：创建子地点（level=3）
调用 `map_service.create_location` 创建子地点。
- locationLevel: 3
- parentLocationId: 指向 Step 2 创建的区域ID
- 参考模板中的子地点定义
- **起始区域的子地点**：优先使用 `starting_scene.sub_locations` 中的数据（description 更丰富），`locations` section 中的子地点作为补充

### Step 4：建立地点间连接
调用 `map_service.create_location` 的 connections 参数建立连接。
- 同层级地点间建立连接（区域↔区域，子地点↔子地点）
- 连接类型：normal（普通）

### Step 5：确认创建结果
调用 `map_service.list_locations_by_level` 确认各层级地点数量。

### 注意事项
- locationLevel 必须严格为 1/2/3
- parentLocationId 必须指向上一层级
- 连接是单向存储，创建时只需指定 from→to
- 不需要在此步骤创建NPC
- `starting_scene.description` 是给LLM的叙事素材（如"你站在白杨村广场中央..."），禁止存入 locations 表的 description 字段
- `starting_scene.location_description` 是地点本身的简短描述（如"白杨村，艾尔德兰王国东部平原上的一个宁静村庄"），应存入 locations 表的 description 字段

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "3层地点结构初始化完成",
  "data": {
    "mapCount": 1,
    "regionCount": 3,
    "subLocationCount": 6,
    "connectionCount": 5
  }
}
```
