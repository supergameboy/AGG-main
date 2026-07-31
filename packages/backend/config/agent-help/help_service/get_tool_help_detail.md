---
tool: help_service
method: get_tool_help_detail
description: "获取工具方法的完整帮助正文。"
summary: "获取工具方法的完整帮助正文"
paramTypes:
  toolType: "string (required) - ServiceTool类型名，如\"combat_service\"、\"map_service\""
  method: "string (required) - 方法名，如\"execute_turn\"、\"move_to\""
since: "1.0"
---

# help_service.get_tool_help_detail

## 功能

获取指定工具方法的完整帮助正文，包含详细参数说明、使用示例和注意事项。

与 `get_tool_help` 功能相同，调用此方法会消耗一次按需加载配额（`maxOnDemandLoadsPerTurn`）。

## 参数详解

### toolType（必填）
- **类型**: string
- **说明**: ServiceTool 类型名
- **示例**: `combat_service`、`map_service`、`inventory_service`

### method（必填）
- **类型**: string
- **说明**: 方法名
- **示例**: `execute_turn`、`create_location`、`add_item`

## 返回值

```typescript
{
  help: string  // 完整的帮助文档正文
}
```

## 注意事项

- 此方法为只读操作
- 会消耗按需加载配额，如果配额用尽将返回错误
- 如果该方法已在上下文中预加载（通过技能或规则注入），会直接返回提示而不再加载

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| toolType 或 method 为空 | 参数缺失 | 传入 toolType 和 method |
| 无帮助文档 | 该方法没有编写帮助文档 | 使用 `search_tool_capability` 查找可用工具 |
| 配额用尽 | 本轮按需加载次数已达上限 | 先用 `get_tool_help_summary` 获取摘要 |
| Permission denied | 当前 Agent 无权访问该工具 | 使用 Agent 权限范围内的工具 |
