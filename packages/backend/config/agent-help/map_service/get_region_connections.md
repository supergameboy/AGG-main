---
tool: map_service
method: get_region_connections
description: "获取父地点(区域)间的连接关系。如果父地点A的子地点与父地点B的子地点相连接，则显示为A和B连接。用于展示区域级别的地图拓扑"
summary: "获取区域间的连接关系"
returnType: "RegionConnection[]"
since: "2.0"
---

# map_service.get_region_connections

## 功能
获取父地点（区域）之间的连接关系。该方法遍历所有地点连接，将子地点的连接向上映射到其父地点（区域），从而展示区域级别的地图拓扑结构。如果父地点A的子地点与父地点B的子地点之间存在连接，则显示A和B之间有连接关系。适用于绘制区域级地图概览。

## 参数详解

此方法无需任何参数，自动基于当前存档的所有地点和连接数据计算区域间连接关系。

## 返回值
```typescript
RegionConnection[] // 区域连接列表
// 每个 RegionConnection 结构:
{
  fromRegionId: string;     // 起始区域（父地点）ID
  toRegionId: string;       // 目标区域（父地点）ID
  connectionType?: string;  // 连接类型
  customData?: Record<string, unknown>; // 自定义数据
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 仅返回不同父地点之间的连接，同一父地点内子地点间的连接不会出现在结果中
- 没有父地点的顶层地点之间的连接也会被返回
- 如果地点没有设置 parentLocationId，则该地点自身被视为一个区域
- 结果去重：同一对区域之间只返回一条连接记录

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 没有跨区域的地点连接 | 使用 `create_location` 创建地点时设置 connections，或使用 `update_location` 添加跨区域连接 |
| 缺少预期的区域连接 | 子地点未设置 parentLocationId | 使用 `update_location` 为子地点设置 parentLocationId |
