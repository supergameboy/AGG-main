---
tool: entity_graph_service
method: list_entities_by_type
description: "获取指定类型的所有实体"
summary: "按类型列出实体"
paramTypes:
  entityType: "string (required) - 实体类型(character/npc/location/item/skill/quest/event)"
since: "1.0"
---

# entity_graph_service.list_entities_by_type

## 功能
获取当前存档中指定类型的所有实体。用于了解世界中有哪些 NPC、地点、物品等。

## 参数详解

### entityType（必填）
- **类型**: string
- **说明**: 要查询的实体类型
- **可选值**: character / npc / location / item / quest / event / faction / skill / goal

## 返回值
```typescript
EntityNode[]

interface EntityNode {
  id: string;          // 节点完整ID
  saveId: string;      // 所属存档ID
  entityType: string;  // 实体类型
  entityId: string;    // 实体ID
  label: string;       // 显示名称
  properties: Record<string, unknown>;  // 自定义属性对象
  createdAt: number;   // 创建时间戳(ms)
  updatedAt: number;   // 更新时间戳(ms)
}
```

## 使用示例
查询所有 NPC：
```json
{ "entityType": "npc" }
```

## 注意事项
- 此方法为只读操作，不会修改图数据
- 返回的节点数量可能较多，建议按需使用
- 如需查询 NPC 完整画像（含关系），请使用 `get_npc_profile` 方法
- 如需查询地点下所有实体，请使用 `list_entities_in_location` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 该类型无节点或 entityType 无效 | 确认 entityType 是否正确，检查是否已创建该类型节点 |
| entityType 无效 | 传入了非枚举值 | 使用 character/npc/location/item/quest/event/faction/skill/goal 之一 |
