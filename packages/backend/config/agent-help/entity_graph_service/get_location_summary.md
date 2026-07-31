---
tool: entity_graph_service
method: get_location_summary
description: "查询地点概览(含NPC/物品/子地点/连接)"
summary: "查询地点完整概览"
paramTypes:
  locationId: "string (required) - 地点的ID或名称"
  includeDescendants: "boolean (optional) - 是否递归包含所有层级的子地点(默认false,仅直接子地点)"
since: "1.0"
---

# entity_graph_service.get_location_summary

## 功能
查询一个地点的完整概览，包括地点内的 NPC、物品、子地点和连接的其他地点。一次调用获取地点全景。

## 参数详解

### locationId（必填）
- **类型**: string
- **说明**: 地点的 ID 或名称（支持 name/id 双兼容，§13.2）

### includeDescendants（可选）
- **类型**: boolean
- **说明**: 是否递归包含所有层级的子地点
- **默认值**: false（仅直接子地点）

## 返回值
```typescript
{
  location: {
    id: string;
    name: string;
    type: string;  // 固定 "location"
  };
  npcs: Array<{
    id: string;
    name: string;
    role?: string;
  }>;
  items: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  subLocations: Array<{
    id: string;
    name: string;
  }>;
  connections: Array<{
    targetLocationId: string;
    targetName: string;
  }>;
}
```

## 使用示例
查询白杨村的概览：
```json
{ "locationId": "白杨村", "includeDescendants": true }
```

返回：
```json
{
  "location": {
    "id": "uuid-456",
    "name": "白杨村",
    "type": "location"
  },
  "npcs": [
    { "id": "uuid-123", "name": "村长艾德温" }
  ],
  "items": [
    { "id": "uuid-789", "name": "村长家的剑", "type": "item" }
  ],
  "subLocations": [
    { "id": "uuid-012", "name": "村长家" }
  ],
  "connections": [
    { "targetLocationId": "uuid-345", "targetName": "城外道路" }
  ]
}
```

## 注意事项
- 此方法为只读操作，不会修改图数据
- locationId 支持 ID 或名称（§13.2 name/id 双兼容）
- `includeDescendants=false` 时仅返回直接子地点；`true` 时递归返回所有层级子地点
- 子地点列表通过 IMapService.getChildLocationIds 查询（跨领域端口，§7.1）
- 如需查询地点下所有实体（含完整节点信息），使用 `list_entities_in_location` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `location 实体引用解析失败: ref='xxx', ...` | locationId 未匹配到节点（既无 entity_id 匹配也无 label 匹配） | 错误响应含 `data.candidates` 候选列表（最多 10 个，按 created_at DESC 排序），可从中选取正确 entityId 或 label 重试；或调用 `list_entities_by_type(entityType='location')` 查询完整列表 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名地点存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 抛错"requires IMapService injection" | 内部服务未注入跨领域端口 | 该错误通常不会在 LLM 工具路径出现（组合根自动注入） |
| 抛错地点不存在 | 节点已解析但 EntityGraphService.requireNodeExists 抛错（极端情况） | 确认地点 ID 或名称正确 |
| 返回空 npcs/items | 该地点下无 NPC 或物品 | 确认实体已通过 LOCATED_AT 边关联到该地点 |
