---
tool: npc_service
method: get_nearby_npcs
description: "获取指定地点附近的NPC(支持半径筛选)。不传locationId时自动使用角色当前位置"
summary: "获取附近NPC"
paramTypes:
  locationId: "string (optional) - 地点ID(不传则用角色当前位置)"
  radius: "number (optional) - 搜索半径(可选)"
since: "1.0"
---

# npc_service.get_nearby_npcs

## 功能
获取指定地点附近的NPC，支持按半径筛选。不传地点ID时自动使用角色当前位置。**注意：此方法返回该地点的所有NPC，包括隐藏NPC。**

## 参数详解

### locationId（可选）
- **类型**: string
- **说明**: 地点ID，不传则自动使用角色当前位置
- **来源**: 必须使用预加载上下文返回的真实地点ID，禁止编造ID

### radius（可选）
- **类型**: number
- **说明**: 搜索半径，基于NPC和地点的 x/y 坐标计算欧几里得距离
- **默认行为**: 不传或传入0/负数时，返回指定地点的所有NPC（不做距离过滤）
- **坐标来源**: NPC的 customData.x 和 customData.y，地点的 custom_data.x 和 custom_data.y
- **过滤逻辑**: 仅当NPC同时拥有 x 和 y 坐标时才进行距离计算；无坐标的NPC默认包含在结果中

## 返回值

```typescript
{
  npcs: NPCProfile[];  // 附近NPC列表，包含隐藏NPC
  hint?: string;       // 当npcs为空时的提示信息
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 不传 locationId 时自动使用角色当前位置，方便快速查看附近的NPC
- 与 `get_npcs_by_location` 的区别：此方法支持半径筛选，更灵活
- **此方法返回该地点的所有NPC，包括隐藏NPC（hidden=true）**。隐藏NPC是玩家尚未遇到的，不应在对话中透露其存在
- 半径筛选依赖NPC和地点的坐标数据，如果NPC没有 x/y 坐标，则默认包含在结果中
- 当结果为空时，返回值中会包含 hint 字段提供排查建议

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 地点无NPC或位置数据缺失 | 检查 hint 字段，确认地点有NPC且位置数据正常 |
| 无法确定当前位置 | 角色位置数据缺失 | 先确认角色位置已初始化，或显式传入 locationId |
| 半径过滤无效 | NPC缺少 x/y 坐标 | 为NPC设置 customData.x 和 customData.y |
