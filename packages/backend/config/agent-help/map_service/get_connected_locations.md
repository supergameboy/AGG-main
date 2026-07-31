---
tool: map_service
method: get_connected_locations
description: "获取相邻可到达地点。不传locationId时自动使用角色当前位置"
summary: "获取相邻可到达地点"
paramTypes:
  locationId: "string (optional) - 地点ID(优先,不传则用当前位置)"
  locationName: "string (optional) - 地点名称(模糊匹配,作为ID的回退)"
returnType: "LocationData[]"
since: "2.0"
---

# map_service.get_connected_locations

## 功能
获取指定地点的相邻可到达地点列表。不传地点参数时自动使用角色当前位置。用于了解角色可以从当前位置前往哪些地点。

## 参数详解

### locationId（可选）
- **类型**: string
- **说明**: 地点ID，不传则自动使用角色当前位置
- **来源**: 必须使用预加载上下文返回的真实地点ID，禁止编造ID

### locationName（可选）
- **类型**: string
- **说明**: 地点名称，模糊匹配，作为ID的回退方案

## 返回值
```typescript
// 有连接时
LocationData[] // 相邻地点列表，每个地点包含子地点ID和连接关系

// 无连接时
{
  locations: [];           // 空数组
  hint: string;            // 提示信息，建议添加连接或创建新地点
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 不传任何参数时自动使用角色当前位置查询
- 返回的地点均为与指定地点有直接连接关系的地点
- 结果可用于 `npc_service.move_to` 方法的 targetLocationId 参数
- 如果角色无当前位置且未提供地点参数，返回错误

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 地点无连接 | 使用 `update_location` 添加连接，或使用 `create_location` 创建新地点 |
| 无法确定当前位置 | 角色位置数据缺失 | 先使用 `npc_service.move_to` 或初始化角色位置 |
