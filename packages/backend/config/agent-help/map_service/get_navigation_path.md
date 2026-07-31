---
tool: map_service
method: get_navigation_path
description: "计算导航路径(BFS最短路径)。fromLocationId可选，不传则使用角色当前位置"
summary: "计算导航路径"
paramTypes:
  fromLocationId: "string (optional) - 起点地点ID(可选,默认角色当前位置)"
  toLocationId: "string (required) - 终点地点ID"
returnType: "NavigationPath"
since: "2.0"
---

# map_service.get_navigation_path

## 功能
计算从起点到终点的最短导航路径，使用BFS（广度优先搜索）算法。返回途经的所有地点、总距离、预估时间和危险信息。适用于需要规划长途旅行路线的场景。

## 参数详解

### fromLocationId（可选）
- **类型**: string
- **说明**: 起点地点ID，不传则自动使用角色当前位置
- **来源**: 必须使用预加载上下文或 `get_current_location` 返回的真实地点ID，禁止编造ID

### toLocationId（必填）
- **类型**: string
- **说明**: 终点地点ID
- **来源**: 必须使用预加载上下文或 `search_locations` 返回的真实地点ID，禁止编造ID

## 返回值
```typescript
NavigationPath
{
  path: Array<{                   // 路径节点（按顺序排列）
    locationId: string;           // 地点ID
    name: string;                 // 地点名称
    distance: number;             // 与前一节点的距离（起点为0）
    relationship?: 'parent' | 'child' | 'connection'; // 与前一节点的关系
  }>;
  totalDistance: number;          // 总距离
  estimatedTime: number;         // 预估时间（分钟）
  dangers: Array<{               // 途经的危险地点（dangerLevel > 3）
    locationId: string;
    dangerLevel: number;
    type: string;                // 地点类型
  }>;
  crossesRegionBoundary: boolean; // 是否跨越区域边界（经过父子关系）
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 使用BFS算法保证找到的是最短路径（按连接跳数计算）
- 路径中的每个地点都是可达的，可按顺序逐段移动
- **起点与终点不连通时抛出异常**，不会返回空路径
- 起点和终点相同时，返回距离为0的单节点路径
- 直接相连的两个地点直接返回路径，无需BFS搜索
- BFS搜索最大深度为20跳
- 计算结果可用于 `quick_travel` 的费用计算参考

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 无路径 | 起点与终点不连通 | 检查地点连接关系，使用 `update_location` 添加连接 |
| 地点不存在 | ID错误 | 使用 `search_locations` 确认有效地点ID |
| 缺少必填参数 | 未传入终点ID | toLocationId 为必填参数 |
