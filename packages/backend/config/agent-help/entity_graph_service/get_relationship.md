---
tool: entity_graph_service
method: get_relationship
description: "查询元素A对元素B的当前关系状态。"
summary: "查询A对B的当前关系状态"
paramTypes:
  observerType: "string (required) - 关系持有者实体类型"
  observerId: "string (required) - 关系持有者实体ID或名称"
  targetType: "string (required) - 关系目标实体类型"
  targetId: "string (required) - 关系目标实体ID或名称"
since: "1.0"
---

# entity_graph_service.get_relationship

## 功能
查询元素 A 对元素 B 的当前关系状态。006 升级后从独立 `entity_relationship_states` 表读取（O(1) 单行查询），不再从 PERCEIVES 边 properties 解析。

## 参数详解

### observerType（必填）
- **类型**: string
- **说明**: 关系持有者（A）实体类型
- **可选值**: character / npc / location / item / quest / event / faction / skill / goal

### observerId（必填）
- **类型**: string
- **说明**: 关系持有者（A）实体 ID 或名称
- **兼容**: 13.2 name/id 双兼容

### targetType（必填）
- **类型**: string
- **说明**: 关系目标（B）实体类型

### targetId（必填）
- **类型**: string
- **说明**: 关系目标（B）实体 ID 或名称

## 返回值
```typescript
// 节点不存在 / states 表无记录时返回 null（get 操作不抛错）
{
  currentScore: number;          // clamp(累加 delta, -10, +10),006 升级字段名
  effectiveNote?: string;        // 当前生效的关系备注（最近一次非空 note）
  effectiveSource: RelationshipSource;  // 当前生效的来源对象（最近一次事件的 source）
  lastUpdated: number;           // 最后更新时间戳(ms)
} | null
```

`RelationshipSource` 结构：
```typescript
{
  type: RelationshipSourceType;  // direct_observation/informed_by/overheard/rumor/player_stated/inferred（无 auto:xxx,relationship 完全手动）
  informerType?: EntityType;     // type=informed_by 时存在
  informerId?: string;           // type=informed_by 时存在
  topicType?: EntityType;        // 可选,告知主题类型
  topicId?: string;              // 可选,告知主题 ID
  note?: string;                 // 来源备注
  occurredAt: number;            // 来源发生时间戳(ms)
}
```

## 注意事项
- **只读操作**：不修改任何数据，不走 StagingPool
- **节点不存在时返回 null**：与 `set_relationship` 的"节点缺失抛错"语义不同（get 操作不抛错）
- **方向性**：A 对 B 的关系与 B 对 A 的关系是独立查询，需分别调用
- **未设置关系时返回 null**：states 表无记录即返回 null
- **历史查询**：如需查询完整变更历史（含所有事件），请使用 `get_relationship_history`
- **006 字段名变更**：`relationshipScore` → `currentScore`（与 states 表 current_score 列对齐）
- **关系数据单一数据源**：模块2 已删除旧 `npc_relations` 表及 `NPCService.get_relations` 方法。所有 NPC 关系值统一通过独立 relationship 表维护，本方法为唯一查询入口

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `character 实体引用解析失败: ref='player', ...` | Agent 误以为玩家角色 entity_id 是 'player'，但实际为 `char_{name}_{timestamp}_{counter}` 格式 | character 类型支持 'player' 别名自动匹配玩家角色（直接传 `targetId='player'` 即可）；或使用 `list_entities_by_type(entityType='character')` 查询真实 entityId；或直接使用 label（角色名）作为引用 |
| `PERCEIVES 边 observer 节点不存在` | observerId 未匹配到节点（既无 entity_id 匹配也无 label 匹配） | 错误响应含 `data.candidates` 候选列表，可从中选取正确 entityId 或 label 重试 |
| `PERCEIVES 边 target 节点不存在` | targetId 未匹配到节点 | 同上 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名实体存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 返回 null | 节点已解析但 states 表无记录（未调用 set_relationship） | 先调用 `set_relationship` 设置关系值 |
| 返回 null 但 events 表有记录 | states 表与 events 表不一致（理论不应发生） | 检查 RelationshipRepository.upsertState 是否在 setRelationship 内被调用 |

## 与旧版（1.0）的差异
| 维度 | 1.0 | 006 升级 |
|------|-----|---------|
| 数据源 | PERCEIVES 边 properties.relationshipScore | 独立 states 表 current_score |
| 查询性能 | 需 read-modify-write 边（O(边数)） | O(1) 单行查询 |
| 返回字段名 | `relationshipScore` | `currentScore` |
| source 字段 | 字符串 | 结构化对象（RelationshipSource） |
| 节点缺失 | 抛错 | 返回 null（get 不抛错） |
