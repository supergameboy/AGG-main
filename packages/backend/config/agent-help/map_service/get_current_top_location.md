---
tool: map_service
method: get_current_top_location
description: "获取角色当前所在的最顶层区域(level=1)地点"
summary: "获取角色当前所在的最顶层区域"
returnType: "LocationData"
since: "2.0"
---

# map_service.get_current_top_location

## 功能
获取角色当前所在的最顶层区域(level=1)。无论角色在哪个子地点，此方法都会沿 parentLocationId 链向上查找到最顶层的地图级地点并返回。

## 参数详解
无参数

## 返回值
```typescript
LocationData | null // 角色所在的最顶层区域，如果角色没有位置则返回 null
```

## 使用场景
- 确定角色所在的大地图：`get_current_top_location()`
- 在世界地图视图中高亮当前地图：先获取当前地图，再在地图列表中标记

## 注意事项
- 此方法为只读操作
- 如果角色当前位置本身就是 level=1 的地点，直接返回该地点
- 如果角色在 level=2 或 level=3 的地点，沿 parentLocationId 链向上查找到 level=1 的地点
- 如果角色尚未设置位置，返回 null

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回 null | 角色尚未设置位置 | 先通过 `npc_service.move_to` 设置角色位置 |
