---
tool: map_service
method: get_location_by_name
description: "按名称模糊查询地点(返回第一个匹配)"
summary: "按名称模糊查询地点"
paramTypes:
  name: "string (required) - 地点名称(模糊匹配)"
returnType: "LocationData"
since: "2.0"
---

# map_service.get_location_by_name

## 功能
根据地点名称进行模糊查询，返回第一个匹配的地点详情。适用于只知道地点名称而不知道ID的场景，如玩家口头描述想去某个地点。

## 参数详解

### name（必填）
- **类型**: string
- **说明**: 要查询的地点名称，支持模糊匹配
- **匹配规则**: 对名称和描述进行不区分大小写的模糊匹配（包含即匹配），返回第一个匹配结果
- **ID回退**: 如果 name 值符合地点ID格式（`loc_xxx_N`），会先尝试按ID精确查找

## 返回值
```typescript
LocationData // 同 get_location 返回的完整地点数据
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 模糊匹配可能返回不完全预期的结果，如"森林"可能匹配到"黑暗森林"或"精灵森林"
- 仅返回第一个匹配结果，如需查看所有匹配项，请使用 `search_locations` 方法
- 如已知地点ID，优先使用 `get_location` 方法进行精确查询
- **未找到匹配时抛出异常**，不会返回空值

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 未找到匹配地点 | 无匹配的地点名称 | 检查名称拼写，或使用 `search_locations` 扩大搜索范围 |
| 匹配到错误地点 | 名称模糊匹配不够精确 | 提供更精确的名称，或改用 locationId 查询 |
