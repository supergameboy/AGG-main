---
tool: npc_service
method: quick_travel
description: "快速旅行(消耗金币，基于BFS路径计算费用，默认每单位距离10金币)。队伍中的NPC会自动跟随移动。支持targetLocationId或targetLocationName"
summary: "快速旅行到目标地点"
paramTypes:
  targetLocationId: "string (optional) - 目标地点ID(优先)"
  targetLocationName: "string (optional) - 目标地点名称(模糊匹配,作为ID的回退)"
  costPerUnit: "number (optional) - 每单位距离消耗金币数(默认10)"
returnType: "MoveResult"
since: "1.0"
---

# npc_service.quick_travel

## 功能
快速旅行到目标地点，消耗金币，费用基于BFS最短路径计算。与 `move_to` 不同，快速旅行不需要相邻即可移动，直接到达目标地点。

## 参数详解

### targetLocationId（可选）
- **类型**: string
- **说明**: 目标地点ID
- **来源**: 必须使用预加载上下文返回的真实地点ID，禁止编造ID

### targetLocationName（可选）
- **类型**: string
- **说明**: 目标地点名称，与 targetLocationId 二选一
- **注意**: 至少需要提供 targetLocationId 或 targetLocationName 之一

### costPerUnit（可选）
- **类型**: number
- **说明**: 每单位距离消耗金币数，默认为10
- **示例**: `costPerUnit: 5` 表示每单位距离5金币

## 返回值
```typescript
QuickTravelResult
{
  success: boolean;                // 是否成功
  fromLocationId: string | null;   // 出发地点ID
  toLocationId: string;            // 目标地点ID
  goldCost: number;                // 消耗金币
  distance: number;                // 路径距离
  error?: string;                  // 失败原因（仅失败时有值）
}
```

## 消耗计算
- `goldCost = ceil(totalDistance × costPerUnit)`，costPerUnit 默认为10
- 已在目标地点时，goldCost 为0

## 注意事项
- 此方法为写操作，会修改角色位置和金币
- 快速旅行不会触发沿途遭遇事件
- 角色必须有足够的金币支付旅行费用，否则返回失败
- 目标地点必须与当前位置连通（路径可达）
- 优先使用 targetLocationId，名称匹配可能不够精确
- 不需要相邻即可移动，只要有路径连通即可

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 金币不足 | 角色金币不够支付旅行费用 | 使用 `character_service.get_full_status` 检查金币 |
| 目标不可达 | 目标地点与当前位置不连通 | 使用 `map_service.get_navigation_path` 检查路径 |
| 地点不存在 | ID错误或名称无匹配 | 使用 `map_service.search_locations` 确认有效地点 |
| 未提供目标 | 两个参数都未传入 | 至少提供 targetLocationId 或 targetLocationName 之一 |
