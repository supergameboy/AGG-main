---
tool: map_service
method: explore_location
description: "探索地点(标记已探索,发现隐藏内容)。支持locationId或locationName"
summary: "探索地点"
paramTypes:
  locationId: "string (optional) - 要探索的地点ID(优先)"
  locationName: "string (optional) - 地点名称(模糊匹配,作为ID的回退)"
returnType: "ExploreResult"
since: "2.0"
---

# map_service.explore_location

## 功能
探索指定地点，将地点标记为已探索状态，并可能发现隐藏的NPC、事件、物品或秘密。支持通过地点ID或名称指定目标。

## 参数详解

### locationId（可选）
- **类型**: string
- **说明**: 要探索的地点ID，优先匹配
- **来源**: 必须使用预加载上下文返回的真实地点ID，禁止编造ID

### locationName（可选）
- **类型**: string
- **说明**: 地点名称，模糊匹配，作为ID的回退方案
- **注意**: 至少需要提供 locationId 或 locationName 之一

## 返回值
```typescript
ExploreResult
{
  success: boolean;                // 是否成功（始终为 true）
  location: LocationData;         // 地点信息（isExplored 强制为 true）
  discoveries: Array<{            // 发现的隐藏内容
    type: 'npc' | 'event' | 'item' | 'secret';
    id: string;
    name: string;
    description: string;
  }>;
  rewards: Record<string, unknown>; // 探索奖励（如经验值、金币）
  dangerLevel: number;            // 地点危险等级
}
```

## 注意事项
- 此方法为写操作，会修改地点的探索状态和地图的已探索列表
- 已探索的地点再次探索不会重复发现隐藏内容，discoveries 为空数组
- 首次探索时会更新地图的 exploredLocations 列表
- 探索奖励包含经验值，高危险等级地点有概率获得金币
- 危险等级≥4的地点有概率发现"远古秘密"
- 必须至少提供 locationId 或 locationName 之一，否则返回 `{ success: false, error: "locationId or locationName is required" }`

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 无新发现 | 地点已被探索过或无隐藏内容 | 尝试探索其他未探索的地点 |
| 地点不存在 | ID错误或名称无匹配 | 使用 `get_current_location` 确认有效地点 |
| 缺少查询条件 | 未提供 locationId 和 locationName | 至少提供一个地点查询条件 |
