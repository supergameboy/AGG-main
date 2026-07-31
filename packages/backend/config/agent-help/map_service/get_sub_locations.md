---
tool: map_service
method: get_sub_locations
description: "获取指定地点的子地点列表"
summary: "获取某地点的所有子地点"
paramTypes:
  locationId: "string (optional) - 父地点ID(不传则用角色当前位置)"
  locationName: "string (optional) - 父地点名称(模糊匹配,作为ID的回退)"
returnType: "LocationData[]"
since: "2.0"
---

# map_service.get_sub_locations

## 功能
获取指定地点的所有直接子地点。适用于查看某个区域下有哪些具体子地点，或某个地图下有哪些区域。不传参数时默认使用角色当前位置。

## 参数详解

### locationId（可选）
- **类型**: string
- **说明**: 父地点ID
- **来源**: 必须使用预加载上下文或 `list_locations_by_level` 返回的真实地点ID

### locationName（可选）
- **类型**: string
- **说明**: 父地点名称，与 locationId 二选一，模糊匹配作为ID的回退方案
- **注意**: 至少需要提供 locationId 或 locationName 之一，不传则使用角色当前位置

## 返回值
```typescript
LocationData[] // 该地点的所有直接子地点列表
```

## 使用场景
- 查看某区域下的所有子地点：`get_sub_locations({ locationId: "loc_xxx" })`
- 查看某地图下的所有区域：`get_sub_locations({ locationName: "暗影大陆" })`
- 查看当前位置的子地点：`get_sub_locations()`

## 注意事项
- 此方法为只读操作
- 只返回直接子地点，不递归返回子地点的子地点
- 如果地点没有子地点，返回空数组

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 地点不存在 | locationId 错误或 locationName 无匹配 | 使用 `list_locations_by_level` 确认有效地点 |
| 缺少查询条件 | 未提供 locationId 和 locationName 且角色无位置 | 至少提供一个地点查询条件 |
