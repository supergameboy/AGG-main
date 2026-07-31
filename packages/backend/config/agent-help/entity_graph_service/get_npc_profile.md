---
tool: entity_graph_service
method: get_npc_profile
description: "一次查询返回NPC完整画像(含基本信息+结构性关系+感知关系,消除N+1)"
summary: "查询NPC完整画像"
paramTypes:
  npcId: "string (required) - NPC的ID或名称"
since: "1.0"
---

# entity_graph_service.get_npc_profile

## 功能
一次查询返回 NPC 的完整画像，包括基本信息、结构性关系（位置、知道的人）和感知关系（认识程度、关系倾向）。消除多次调用 get_npc + get_entity_relations 的 N+1 问题。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: NPC 的 ID 或名称（支持 name/id 双兼容，§13.2）

## 返回值
```typescript
{
  npc: {
    id: string;
    name: string;
    type: string;           // 固定 "npc"
    location?: string;      // NPC 当前所在地ID（如有）
  };
  structuralRelations: Array<{
    targetId: string;
    targetType: string;
    relation: RelationType;  // 如 LOCATED_AT/KNOWS/ALLIED_WITH 等
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
查询村长艾德温的完整画像：
```json
{ "npcId": "村长艾德温" }
```

返回：
```json
{
  "npc": {
    "id": "uuid-123",
    "name": "村长艾德温",
    "type": "npc",
    "location": "白杨村"
  },
  "structuralRelations": [
    { "targetId": "白杨村", "targetType": "location", "relation": "LOCATED_AT" }
  ],
  "perceptions": [
    { "targetId": "玩家Hero", "targetType": "character", "relationshipScore": 7, "awarenessScore": 8 }
  ]
}
```

## 注意事项
- 此方法为只读操作，不会修改图数据
- npcId 支持 ID 或名称（§13.2 name/id 双兼容）
- 一次调用聚合 NPC 基础信息 + 关系网络，避免 N+1 查询
- 如需修改感知关系，使用 `set_awareness`/`set_relationship` 方法
- 如需查询非 NPC 实体的关系，使用 `get_entity_relations` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `npc 实体引用解析失败: ref='xxx', ...` | npcId 未匹配到节点（既无 entity_id 匹配也无 label 匹配） | 错误响应含 `data.candidates` 候选列表（最多 10 个，按 created_at DESC 排序），可从中选取正确 entityId 或 label 重试；或调用 `list_entities_by_type(entityType='npc')` 查询完整列表 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名 NPC 存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 抛错"requires INPCService injection" | 内部服务未注入跨领域端口 | 该错误通常不会在 LLM 工具路径出现（组合根自动注入） |
| 抛错"实体不存在" | 节点已解析但 EntityGraphService.requireNodeExists 抛错（极端情况） | 确认 NPC 已创建并已加入实体图 |
| 返回空 perceptions | 该 NPC 未设置任何感知关系 | 使用 `set_awareness`/`set_relationship` 设置感知关系 |
