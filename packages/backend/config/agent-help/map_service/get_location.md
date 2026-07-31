---
tool: map_service
method: get_location
description: "获取地点详情。支持locationId或locationName查询"
summary: "获取地点详情"
paramTypes:
  locations: "array<object{locationId:string,locationName:string}> (required) - 要获取的地点列表"
returnType: "LocationData"
since: "2.0"
---

# map_service.get_location

## 功能
获取地点的详细信息，包括地点属性、层级关系、子地点列表、连接关系和关联事件。支持通过 locationId 或 locationName 进行查询，locationId 优先匹配，locationName 作为回退方案进行模糊匹配。

## 参数详解

### locations（必填）
- **类型**: array
- **说明**: 要获取的地点列表
- **数组元素结构**:
  - `locationId`（string，可选）— 地点ID，优先匹配
  - `locationName`（string，可选）— 地点名称，模糊匹配，作为ID的回退方案
- **建议**: 优先使用 locationId 查询，仅在无法获取ID时使用 locationName

## 返回值
```typescript
LocationData
{
  id: string;                   // 地点ID（可读ID格式）
  saveId?: string;              // 存档ID
  name: string;                 // 地点名称
  description: string;          // 地点描述
  type: string;                 // 地点类型（如village, forest, dungeon, poi）
  locationLevel: number;        // 层级: 1=区域/大陆, 2=地点/村镇森林湖泊, 3=具体位置/广场房间
  parentLocationId: string | null; // 父地点ID（level=1时为null）
  coordinates: { x: number; y: number }; // 坐标
  isExplored: boolean;          // 是否已探索
  events: string[];             // 该地点的事件ID列表
  connections: string[];        // 相连的地点ID列表
  dangerLevel: number;          // 危险等级（1-5）
  visible: boolean;               // 是否对玩家可见
  childLocationIds: string[];   // 子地点ID列表
  isParent: boolean;            // 是否为父地点（有子地点）
  customData: Record<string, unknown>; // 自定义数据
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- locationId 必须来自预加载上下文或 `list_locations_by_level` 返回的地点ID，禁止编造ID
- 使用 locationName 模糊匹配时，返回第一个匹配结果，可能不够精确
- 地点不存在时抛出异常，不会返回空值
- 必须至少提供 locationId 或 locationName 之一，否则返回 `{ success: false, error: "locationId or locationName is required" }`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 地点不存在 | locationId 错误或 locationName 无匹配 | 使用 `list_locations_by_level` 确认有效地点 |
| 模糊匹配到错误地点 | locationName 不够精确 | 优先使用 locationId 精确查询 |
| 缺少查询条件 | 未提供 locationId 和 locationName | 至少提供一个地点查询条件 |
