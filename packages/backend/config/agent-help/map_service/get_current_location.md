---
tool: map_service
method: get_current_location
description: "获取角色当前位置"
summary: "查询角色当前所在地点"
returnType: "LocationData"
since: "2.0"
whenToUse:
  - 需要先确认玩家当前处于哪里时
  - 在移动、探索或生成场景描述前需要读取当前位置时
returnsSummary: 返回当前地点的完整位置数据
---

# map_service.get_current_location

## 功能
获取角色当前所在的地点详情。无需传入任何参数，自动根据角色状态返回当前位置信息。适用于需要了解角色所在环境的场景。

## 参数详解
此方法无需任何参数。

## 返回值
```typescript
LocationData // 同 get_location 返回的完整地点数据
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- **角色没有位置信息时抛出异常**，不会返回空值
- 返回结果与 `get_location` 格式一致，只是自动获取当前位置

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 角色没有位置信息 | 角色尚未初始化或位置数据缺失 | 使用 `npc_service.move_to` 或 `npc_service.quick_travel` 设置角色位置 |
