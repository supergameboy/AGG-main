---
tool: help_service
method: search_tool_capability
description: "按场景搜索可用工具能力，返回工具和方法摘要列表。"
summary: "按场景搜索可用工具能力"
paramTypes:
  query: "string (required) - 场景描述或操作目标"
since: "1.0"
---

# help_service.search_tool_capability

## 功能

根据场景描述搜索匹配的工具能力。当你不知道哪个工具能完成某个操作时，使用此方法查找。

返回匹配的工具列表，每个条目包含工具名、方法名、描述摘要和适用场景。

## 参数详解

### query（必填）
- **类型**: string
- **说明**: 场景描述或操作目标
- **示例**: "初始化游戏世界"、"创建NPC"、"添加物品到背包"

## 返回值

```typescript
{
  matches: Array<{
    tool: string;        // ServiceTool类型名，如 "inventory_service"
    method: string;      // 方法名，如 "add_item"
    description: string; // 方法描述
    whenToUse?: string[];// 适用场景
  }>
}
```

## 注意事项

- 此方法为只读操作，不会修改游戏状态
- 搜索结果取决于帮助文档的覆盖率，未编写帮助文档的方法不会出现在结果中
- 如果找不到匹配结果，尝试用不同的关键词描述

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| query 为空 | 未传入 query 参数 | 传入场景描述字符串 |
| 无匹配结果 | 关键词无法匹配任何帮助文档 | 尝试更通用的描述词 |
