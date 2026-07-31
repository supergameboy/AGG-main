---
tool: map_service
method: get_reachable_locations
description: "获取从当前位置可达的所有地点（含层级关系：兄弟地点、父地点、子地点、连接地点）"
summary: "获取从当前位置可达的地点"
paramTypes:
  locationId: "string (optional) - 地点ID(不传则用角色当前位置)"
  locationName: "string (optional) - 地点名称(模糊匹配,作为ID的回退)"
returnType: "LocationData[]"
since: "2.0"
---

# map_service.get_reachable_locations

## 功能
获取从指定地点可达的所有地点列表，包含层级关系中的兄弟地点、父地点、子地点以及直接连接的地点。不传地点参数时自动使用角色当前位置。与 `get_connected_locations` 不同，此方法不仅返回直接连接的地点，还返回层级关系上可达的地点（如同一父地点下的兄弟地点、父地点的其他连接地点及其子地点）。

## 参数详解

### locationId（可选）
- **类型**: string
- **说明**: 地点ID，不传则自动使用角色当前位置
- **来源**: 必须使用预加载上下文返回的真实地点ID，禁止编造ID

### locationName（可选）
- **类型**: string
- **说明**: 地点名称，模糊匹配，作为ID的回退方案

## 返回值
```typescript
LocationData[] // 可达地点列表，每个地点包含完整详情
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 可达地点包括：当前地点自身、当前地点的子地点、当前地点的父地点、父地点下的兄弟地点、直接连接的地点及其子地点
- 不传任何参数时自动使用角色当前位置查询
- 如果角色无当前位置且未提供地点参数，返回错误
- 返回的地点列表可能较大，适合用于展示区域概览

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 无法确定当前位置 | 角色位置数据缺失 | 先使用 `npc_service.move_to` 或初始化角色位置 |
| 返回地点过多 | 层级关系复杂 | 可结合 `get_connected_locations` 仅获取直接连接的地点 |
| 缺少预期地点 | 地点未建立连接或层级关系 | 使用 `update_location` 添加连接或设置 parentLocationId |
