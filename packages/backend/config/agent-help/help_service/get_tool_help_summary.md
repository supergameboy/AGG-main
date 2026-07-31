---
tool: help_service
method: get_tool_help_summary
description: "获取工具方法的摘要帮助，不返回完整正文。"
summary: "获取工具方法的摘要帮助"
paramTypes:
  toolType: "string (required) - ServiceTool类型名，如\"combat_service\"、\"map_service\""
  method: "string (required) - 方法名，如\"execute_turn\"、\"move_to\""
since: "1.0"
---

# help_service.get_tool_help_summary

## 功能

获取指定工具方法的摘要帮助，只包含简要说明，不含完整参数列表和示例。token 消耗远小于 `get_tool_help`。

适合快速确认方法用途和适用场景。

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
  helpSummary: {
    summary?: string;       // 简要说明
    description?: string;   // 方法描述
    whenToUse?: string[];   // 适用场景
    returnsSummary?: string;// 返回值摘要
  }
}
```

## 注意事项

- 此方法为只读操作
- 摘要不含完整参数和示例，如需详细信息请使用 `get_tool_help`

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| toolType 或 method 为空 | 参数缺失 | 传入 toolType 和 method |
| 无帮助文档 | 该方法没有编写帮助文档 | 使用 `search_tool_capability` 查找可用工具 |
