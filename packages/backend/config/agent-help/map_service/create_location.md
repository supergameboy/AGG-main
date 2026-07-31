---
tool: map_service
method: create_location
description: "创建新地点(自动建立双向连接)"
summary: "创建地点（区域/地点/具体位置三层结构）"
paramTypes:
  locations: "array<object{locationLevel:number,name:string,description:string,type:string,x:number,y:number,terrainType:string,dangerLevel:number,visible:boolean,isExplored:boolean,connections:string,events:string,parentLocationId:string,childLocationIds:string}> (required) - 要创建的地点列表"
returnType: "LocationData"
since: "2.0"
---

# map_service.create_location

## 功能
创建新地点，支持3层结构：区域(level=1) → 地点(level=2) → 具体位置(level=3)。创建后系统自动分配可读格式的地点ID（loc_ 前缀）。

## 地点层级约束
- **level=1** 是区域（大陆），不需要 parentLocationId
- **level=2** 是地点（村镇森林湖泊等），必须指定 parentLocationId 指向 level=1 区域
- **level=3** 是具体位置（广场房间等），必须指定 parentLocationId 指向 level=2 地点
- **推荐创建顺序**：初始化时按层级顺序创建，先 level=1 → 再 level=2 → 最后 level=3
- **玩家起始位置必须是 level=3 具体位置**（如"村庄广场"、"城门口"），禁止设为 level=2 地点或 level=1 区域

## 3层地点结构
```
区域(level=1) — 如"艾尔德兰大陆"，无需 parentLocationId
  └── 地点(level=2) — 如"白杨村"，parentLocationId 指向 level=1 区域
        └── 具体位置(level=3) — 如"村庄广场"、"铁匠铺"，parentLocationId 指向 level=2 地点
```

## 参数详解

### locations（必填）
- **类型**: array
- **说明**: 要创建的地点列表
- **数组元素结构**:
  - `locationLevel`（number，必填）— 层级: 1=区域/大陆, 2=地点/村镇森林湖泊, 3=具体位置/广场房间
  - `name`（string，必填）— 地点名称。level=1 时是区域名（如"艾尔德兰大陆"），level=2 时是地点名（如"白杨村"），level=3 时是具体位置名（如"村庄广场"）。命名必须与 GM task 中指定的名称严格一致（命名一致性硬约束）
  - `description`（string，可选）— 地点描述，默认为空字符串
  - `type`（string，可选）— 地点类型，如 village、forest、dungeon、poi，默认为 `poi`
  - `x`（number，可选）— X坐标，默认为 null
  - `y`（number，可选）— Y坐标，默认为 null
  - `terrainType`（string，可选）— 地形类型：plain、forest、mountain、swamp、desert、city、dungeon、road
  - `dangerLevel`（number，可选）— 危险等级（1-5），默认为1
  - `visible`（boolean，可选）— 是否对玩家可见，默认false。设为true则玩家可访问该地点（如起始地点）
  - `connections`（string，可选）— 连接的地点ID或名称列表（JSON数组字符串，如 `'["白杨村","暗影森林"]'`），支持名称自动解析。连接为单向存储：在当前地点的 connections 中添加目标地点ID
  - `parentLocationId`（string，可选）— 父地点ID。level=2 时指向 level=1 区域，level=3 时指向 level=2 地点，level=1 时不传
  - `events`（string，可选）— 事件ID列表（JSON数组字符串）

## 返回值
```typescript
LocationData // 同 get_location 返回的完整地点数据
```

## 注意事项
- 此方法为写操作，会创建新的地点数据
- connections 中指定的连接为单向存储：在当前地点的 connections 中添加目标地点ID。如需双向连接，需在两个地点的 connections 中互相添加
- locationId 由系统自动分配（loc_ 前缀），后续操作需使用返回的真实ID
- visible 默认为 false，起始地点应设为 true
- **创建顺序**：创建地点时，events 参数引用的事件必须已存在。NPC通过 `npc_service.create_npc` 的 locationId 参数关联到地点，无需在 create_location 中指定
- **玩家起始位置约束**：起始地点必须是 level=3 具体位置，禁止使用 level=2 地点或 level=1 区域

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 父地点不存在 | parentLocationId 错误 | 使用 `list_locations_by_level` 确认有效的父地点ID |
| 层级不匹配 | parentLocationId 指向的地点层级不对 | level=2 的父地点必须是 level=1 区域，level=3 的父地点必须是 level=2 地点 |
| 起始位置层级错误 | 起始地点设为 level=2 或 level=1 | 起始地点必须是 level=3 具体位置（如"村庄广场"），不是 level=2 地点（如"白杨村"） |
| 连接地点不存在 | connections 中的ID/名称无效 | 先创建目标地点，再建立连接 |
| 事件不存在 | events 中引用的事件尚未创建 | 先创建事件，再关联到地点 |
| JSON格式错误 | connections/events 格式不正确 | 使用 JSON 数组字符串格式，如 `'["id1","id2"]'` |
