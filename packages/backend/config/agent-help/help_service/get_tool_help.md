---
tool: help_service
method: get_tool_help
description: "获取工具方法的详细帮助文档。首次使用工具前应先调用此方法了解完整用法、参数格式和注意事项。"
summary: "获取工具方法的详细帮助文档"
paramTypes:
  toolType: "string (required) - ServiceTool类型名，如\"combat_service\"、\"map_service\""
  method: "string (required) - 方法名，如\"execute_turn\"、\"move_to\""
since: "1.0"
---

# help_service.get_tool_help

## 功能

获取工具方法的详细帮助文档，包含完整参数格式、使用示例和注意事项。

首次使用某个工具方法前，应先调用此方法了解完整用法，避免参数格式错误导致调用失败。

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
- 会消耗按需加载配额（内部调用 `get_tool_help_detail`）
- 如果帮助已通过技能或规则预注入，返回提示而不再重复加载
- token 消耗较大，如果只需要确认用途，优先用 `get_tool_help_summary`

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| toolType 或 method 为空 | 参数缺失 | 传入 toolType 和 method |
| 无帮助文档 | 该方法没有编写帮助文档 | 使用 `search_tool_capability` 查找可用工具 |
