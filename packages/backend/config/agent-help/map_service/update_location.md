---
tool: map_service
method: update_location
description: "更新地点属性(只传需要修改的字段)"
summary: "更新地点属性"
paramTypes:
  updates: "array<object{locationId:string,name:string,description:string,type:string,terrainType:string,dangerLevel:number,x:number,y:number,connections:string,events:string,visible:boolean,parentLocationId:string,custom_data:object}> (required) - 要更新的地点列表"
returnType: "LocationData"
since: "2.0"
---

# map_service.update_location

## 功能
更新地点属性，只需传入需要修改的字段。支持更新名称、描述、类型、地形、危险等级、坐标、连接、事件、隐藏状态、父地点和自定义数据等。

## 参数详解

### updates（必填）
- **类型**: array
- **说明**: 要更新的地点列表
- **数组元素结构**:
  - `locationId`（string，必填）— 地点ID，必须使用预加载上下文中的真实ID，禁止编造ID
  - `name`（string，可选）— 新名称
  - `description`（string，可选）— 新描述
  - `type`（string，可选）— 新类型
  - `terrainType`（string，可选）— 新地形类型
  - `dangerLevel`（number，可选）— 新危险等级
  - `x`（number，可选）— 新X坐标
  - `y`（number，可选）— 新Y坐标
  - `connections`（string，可选）— 新连接地点ID列表（JSON数组字符串），更新时会先删除所有旧连接再创建新连接
  - `events`（string，可选）— 新事件ID列表（JSON数组字符串），整体替换
  - `visible`（boolean，可选）— 是否对玩家可见，设为true让玩家访问该地点
  - `parentLocationId`（string | null，可选）— 设置或更改父地点ID，传null清除父地点关系
  - `custom_data`（object，可选）— 自定义数据，与现有数据合并（浅合并）

## 返回值
```typescript
LocationData // 更新后的完整地点数据
```

## 注意事项
- 此方法为写操作，会修改地点数据
- 只需传入需要修改的字段，未传入的字段保持不变
- locationId 为必填项，必须来自预加载上下文，禁止编造ID
- connections、events 参数为 JSON 数组字符串格式，更新时整体替换（不是追加）
- connections 更新时会先删除该地点的所有旧连接，再创建新连接
- visible 设为 true 可让玩家访问该地点（常用于剧情推进后解锁新区域）
- custom_data 为合并模式，新数据与现有数据浅合并，不会删除未传入的键
- parentLocationId 变更时会验证层级关系（level=2必须指向level=1，level=3必须指向level=2）

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 地点不存在 | locationId 错误 | 使用 `list_locations_by_level` 或 `search_locations` 确认有效地点 |
| 更新失败 | locationId 未提供 | locationId 为必填参数 |
| 连接被覆盖 | connections 整体替换而非追加 | 如需追加连接，先获取现有连接再合并后更新 |
| 嵌套层级不匹配 | parentLocationId 指向的地点层级不对 | level=2的父地点必须是level=1，level=3的父地点必须是level=2 |
