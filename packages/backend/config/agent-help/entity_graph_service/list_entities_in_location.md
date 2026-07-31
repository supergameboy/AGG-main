---
tool: entity_graph_service
method: list_entities_in_location
description: "获取指定地点下的所有实体(通过LOCATED_AT边查询)"
summary: "按地点列出实体"
paramTypes:
  locationId: "string (required) - 地点ID或名称(不含前缀)"
  includeDescendants: "boolean (optional) - 是否递归包含子地点的实体(默认false)"
  nodeTypeFilter: "array (optional) - 只返回这些类型的节点(如[\"npc\",\"item\"])"
since: "1.0"
---

# entity_graph_service.list_entities_in_location

## 功能
获取指定地点下的所有实体（NPC、物品等）。通过 LOCATED_AT 边查询定位到某地点的实体，可选递归查询子地点。

## 参数详解

### locationId（必填）
- **类型**: string
- **说明**: 地点的实体 ID 或名称（支持 name/id 双兼容，§13.2）
- **示例**: `town_market`、`白杨村`

### includeDescendants（可选）
- **类型**: boolean
- **说明**: 是否递归包含子地点下的实体
- **默认值**: false

### nodeTypeFilter（可选）
- **类型**: string[]
- **说明**: 只返回指定类型的节点，用于过滤结果
- **可选值**: `character`、`npc`、`item`、`quest`、`event`、`faction`、`skill`、`goal`
- **示例**: `["npc", "item"]` 只返回 NPC 和物品

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
获取城镇市场的所有 NPC：
```json
{ "locationId": "town_market", "nodeTypeFilter": ["npc"] }
```

获取白杨村及其子区域的所有实体：
```json
{ "locationId": "白杨村", "includeDescendants": true }
```

## 注意事项
- 此方法为只读操作，不会修改图数据
- locationId 支持 ID 或名称（§13.2 name/id 双兼容）
- 如需查询地点完整概览（含子地点、连接），请使用 `get_location_summary` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `location 实体引用解析失败: ref='xxx', ...` | locationId 未匹配到节点（既无 entity_id 匹配也无 label 匹配） | 错误响应含 `data.candidates` 候选列表（最多 10 个，按 created_at DESC 排序），可从中选取正确 entityId 或 label 重试；或调用 `list_entities_by_type(entityType='location')` 查询完整列表 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名地点存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 返回空数组 | 节点已解析但无 LOCATED_AT 边 | 确认地点 ID 或名称正确且已有实体关联到该地点 |
| 数据量过大 | includeDescendants=true 且区域层级深 | 配合 nodeTypeFilter 过滤，或缩小查询范围 |
