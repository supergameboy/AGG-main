---
tool: map_service
method: list_locations_by_level
description: "按地点层级获取地点列表(1=区域/大陆,2=地点/村镇森林湖泊,3=具体位置/广场房间)"
summary: "按层级查询地点"
paramTypes:
  locationLevel: "number (required) - 地点层级(1=区域/大陆,2=地点,3=具体位置)"
  parentLocationId: "string (optional) - 父地点ID(筛选某地图/区域下的子地点)"
returnType: "LocationData[]"
since: "2.0"
---

# map_service.list_locations_by_level

## 功能
按层级查询地点。地点采用3层结构：地图(level=1) → 区域(level=2) → 子地点(level=3)。可通过 parentLocationId 进一步筛选某个父地点下的子级地点。

## 参数详解

### locationLevel（必填）
- **类型**: number
- **说明**: 查询的层级
  - `1` — 地图级地点（顶层）
  - `2` — 区域级地点（地图下的区域）
  - `3` — 子地点级（区域下的具体地点）

### parentLocationId（可选）
- **类型**: string
- **说明**: 父地点ID，用于筛选某个地图或区域下的子级地点
- **示例**: 传入某个 level=1 的地点ID，可获取该地图下所有 level=2 的区域

## 返回值
```typescript
LocationData[] // 匹配层级的地点列表
```

## 使用场景
- 初始化时确认地点结构：`list_locations_by_level({ locationLevel: 1 })` 获取所有地图
- 查看某地图下的区域：`list_locations_by_level({ locationLevel: 2, parentLocationId: "loc_xxx" })`
- 查看某区域下的子地点：`list_locations_by_level({ locationLevel: 3, parentLocationId: "loc_xxx" })`

## 注意事项
- 此方法为只读操作
- locationLevel 只接受 1、2、3 三个值
- 不传 parentLocationId 时返回该层级的所有地点

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 层级值无效 | locationLevel 不在1/2/3范围内 | 只接受1(地图)、2(区域)、3(子地点) |
| 父地点不存在 | parentLocationId 错误 | 使用 `list_locations_by_level` 不带 parentLocationId 先获取有效地点 |
