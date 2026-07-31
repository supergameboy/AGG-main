---
tool: npc_service
method: get_npcs_by_location
description: "获取指定地点的所有NPC(含完整信息：id/name/role/race/level/location/description/services/reputation/mood)。不传locationId时自动使用角色当前位置。输出NPC数据时必须使用返回的真实ID，禁止编造ID"
summary: "获取指定地点的所有NPC"
paramTypes:
  locationId: "string (optional) - 地点ID(不传则用角色当前位置)"
since: "1.0"
---

# npc_service.get_npcs_by_location

## 功能
获取指定地点的所有NPC，返回每个NPC的完整信息。不传地点ID时自动使用角色当前位置。**注意：此方法返回该地点的所有NPC，包括隐藏NPC。**

## 参数详解

### locationId（可选）
- **类型**: string
- **说明**: 地点ID，不传则自动使用角色当前位置
- **来源**: 必须使用预加载上下文返回的真实地点ID，禁止编造ID

## 返回值

```typescript
{
  npcs: NPCProfile[];  // 按名称升序排列，包含隐藏NPC
  hint?: string;       // 当npcs为空时的提示信息
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- **输出NPC数据时必须使用返回的真实ID，禁止编造ID**
- 不传 locationId 时自动使用角色当前位置，方便快速查看当前地点的NPC
- **此方法返回该地点的所有NPC，包括隐藏NPC（hidden=true）**。隐藏NPC是玩家尚未遇到的，不应在对话中透露其存在
- 当结果为空时，返回值中会包含 hint 字段提供排查建议

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 地点无NPC或地点不存在 | 检查 hint 字段，使用 `map_service.get_location` 确认地点信息 |
| 无法确定当前位置 | 角色位置数据缺失 | 先确认角色位置已初始化，或显式传入 locationId |
