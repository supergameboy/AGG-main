---
tool: npc_service
method: move_to
description: "移动角色到目标地点(计算路径距离)。队伍中的NPC会自动跟随移动。支持targetLocationId或targetLocationName"
summary: "移动角色到目标地点"
paramTypes:
  targetLocationId: "string (optional) - 目标地点ID(优先)"
  targetLocationName: "string (optional) - 目标地点名称(模糊匹配,作为ID的回退)"
returnType: "MoveResult"
since: "1.0"
---

# npc_service.move_to

## 功能
将角色移动到目标地点。系统会自动计算移动距离、所需时间和可能遭遇的事件。队伍中的NPC会自动跟随移动（从原地点移除，添加到目标地点）。支持通过地点ID或名称指定目标，ID优先匹配，名称作为回退方案。

## 参数详解

### targetLocationId（可选）
- **类型**: string
- **说明**: 目标地点ID
- **来源**: 必须使用预加载上下文或 `get_connected_locations` 返回的真实地点ID，禁止编造ID

### targetLocationName（可选）
- **类型**: string
- **说明**: 目标地点名称，与 targetLocationId 二选一
- **注意**: 至少需要提供 targetLocationId 或 targetLocationName 之一

## 返回值
```typescript
MovementResult
{
  success: boolean;                // 是否成功（始终为 true）
  fromLocationId: string | null;   // 出发地点ID
  toLocationId: string;            // 到达地点ID
  distance: number;                // 移动距离
  followersMoved: number;          // 跟随移动的队伍NPC数量
}
```

## 注意事项
- 此方法为写操作，会修改角色位置、队伍NPC位置和游戏时间
- 移动会推进游戏时间，具体时长取决于距离和目标地形类型
- 移动过程中可能触发随机遭遇事件（概率与目标地点危险等级相关）
- 路径必须可达（通过BFS验证），目标地点必须与当前位置有连接关系或路径可达
- 队伍中的NPC会自动跟随移动
- 优先使用 targetLocationId，名称匹配可能不够精确
- 首次移动（角色无当前位置时）不检查可达性，直接设置位置

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 目标地点不可达 | 目标地点与当前位置无连接 | 使用 `map_service.get_connected_locations` 查看可到达的地点 |
| 地点不存在 | ID错误或名称无匹配 | 使用 `map_service.search_locations` 确认有效地点 |
| 未提供目标 | 两个参数都未传入 | 至少提供 targetLocationId 或 targetLocationName 之一 |
