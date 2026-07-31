---
tool: entity_graph_service
method: get_entity_relations
description: "查询实体的所有关系(含认识程度和关系倾向,区分结构性关系与感知关系)"
summary: "查询实体完整关系网络"
paramTypes:
  entityType: "string (required) - 实体类型(character/npc/location/item/skill/quest/event)"
  entityId: "string (required) - 实体ID或名称"
  relationType: "string (optional) - 可选:只查特定关系类型(如PERCEIVES/KNOWS/LOCATED_AT)"
  direction: "string (optional) - 可选:方向过滤 outgoing(出边)/incoming(入边)/both(双向,默认)"
since: "1.0"
---

# entity_graph_service.get_entity_relations

## 功能
查询一个实体的所有关系，包括结构性关系（如位置、所属、知道）和感知关系（认识程度、关系倾向）。一次调用获取完整关系网络。

## 参数详解

### entityType（必填）
- **类型**: string
- **说明**: 实体类型
- **可选值**: character / npc / location / item / skill / quest / event

### entityId（必填）
- **类型**: string
- **说明**: 实体的 ID 或名称（支持 name/id 双兼容，§13.2）

### relationType（可选）
- **类型**: string
- **说明**: 只查特定关系类型
- **可选值**: `PERCEIVES` / `KNOWS` / `LOCATED_AT` / `OWNS` / `CONNECTED_TO` / `ALLIED_WITH` 等

### direction（可选）
- **类型**: string
- **说明**: 方向过滤
- **可选值**: `outgoing`（出边）/ `incoming`（入边）/ `both`（双向，默认）

## 返回值
```typescript
{
  structuralRelations: Array<{
    targetId: string;
    targetType: string;
    relation: RelationType;  // 如 LOCATED_AT/KNOWS/OWNS 等
  }>;
  perceptions: Array<{
    targetId: string;
    targetType: string;
    relationshipScore?: number;   // -10 讨厌 ~ +10 喜欢, 0 中性
    relationshipNote?: string;
    awarenessScore?: number;      // -10 完全误解 ~ +10 完全正确认识, 0 不了解
    awarenessNote?: string;
  }>;
}
```

## 使用示例
查询村长艾德温的所有关系：
```json
{ "entityType": "npc", "entityId": "村长艾德温" }
```

返回：
```json
{
  "structuralRelations": [
    { "targetId": "白杨村", "targetType": "location", "relation": "LOCATED_AT" }
  ],
  "perceptions": [
    { "targetId": "玩家Hero", "targetType": "character", "relationshipScore": 7, "awarenessScore": 8 }
  ]
}
```

只查询感知关系：
```json
{ "entityType": "npc", "entityId": "村长艾德温", "relationType": "PERCEIVES" }
```

## 注意事项
- 此方法为只读操作，不会修改图数据
- entityId 支持 ID 或名称（§13.2 name/id 双兼容）
- PERCEIVES 感知关系仅返回出边（A 对 B 的感知，B 对 A 的感知需另查 B）
- 如需查询 NPC 完整画像（含基础信息+关系），请使用 `get_npc_profile` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `character 实体引用解析失败: ref='player', ...` | Agent 误以为玩家角色 entity_id 是 'player'，但实际为 `char_{name}_{timestamp}_{counter}` 格式（由 generateReadableId 生成，LLM 无法推断） | character 类型支持 'player' 别名自动匹配玩家角色（直接传 `entityId='player'` 即可）；或使用 `list_entities_by_type(entityType='character')` 查询真实 entityId；或直接使用 label（角色名）作为引用 |
| `entity 实体引用解析失败: ref='xxx', ...` | entityId 未匹配到节点（既无 entity_id 匹配也无 label 匹配） | 错误响应含 `data.candidates` 候选列表（最多 10 个，按 created_at DESC 排序），可从中选取正确 entityId 或 label 重试；或调用 `list_entities_by_type` 查询完整列表 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名实体存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 抛错"实体不存在" | 节点已解析但 EntityGraphService.requireNodeExists 抛错（极端情况） | 确认实体已创建并已加入实体图 |
| 返回空 perceptions | 该实体未设置任何感知关系 | 使用 `set_awareness`/`set_relationship` 设置感知关系 |
