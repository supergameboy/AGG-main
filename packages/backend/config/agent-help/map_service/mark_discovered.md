---
tool: map_service
method: mark_discovered
description: "批量标记地点为已发现（写入 discovered_locations，幂等）。初始化时用于标记玩家已知的起始区域地点。visible=true 的地点在 create_location 时自动标记，无需手动调用"
summary: "标记地点为已发现（幂等，访问即发现）"
paramTypes:
  locations: "array<object{locationId:string,locationName:string}> (required) - 要标记为已发现的地点列表"
since: "2.0"
---

# map_service.mark_discovered

## 功能
将指定地点标记为"已发现"，写入 `discovered_locations` 表。此方法为幂等操作：重复标记同一地点不会报错（UNIQUE 约束 + onConflict ignore）。前端小地图通过已发现地点列表过滤显示。

## 调用场景
- **探索即发现**：`explore_location` 探索地点时自动调用
- **创建即发现**：`create_location` 创建 visible=true 的地点时自动调用
- **访问即发现**：`npc_service.move_character_to` / `npc_service.quick_travel_to` 角色到达新地点时自动调用
- **手动标记**：GM 可显式调用此方法标记地点为已发现（如剧情触发）

## 参数详解

### locationId（必填）
- **类型**: string
- **说明**: 要标记为已发现的地点ID（loc_ 前缀）
- **获取方式**: 通过 `create_location` 返回值、`search_locations`、`get_location_by_name` 等方法获取

## 返回值
无返回值（void）。操作成功即表示已标记。

## 注意事项
- 此方法为**幂等操作**：重复标记同一地点不会报错
- 此方法为**写操作**，但不会修改地点本身的数据，仅在 `discovered_locations` 表插入记录
- 如果 locationId 不存在（违反外键约束），会抛出错误
- 前端小地图只显示已发现地点，未发现地点不显示

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 地点不存在 | locationId 无效 | 使用 `search_locations` 确认有效的地点ID |
| 数据库错误 | DB 连接或约束问题 | 检查日志中的错误信息 |
