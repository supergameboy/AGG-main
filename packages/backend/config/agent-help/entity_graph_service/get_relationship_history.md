---
tool: entity_graph_service
method: get_relationship_history
description: "查询A对B的relationship变更历史(全部事件,按时间正序)。用于关系演变回顾、剧情追溯。"
summary: "查询A对B的relationship变更历史"
paramTypes:
  observerType: "string (required) - 关系持有者实体类型"
  observerId: "string (required) - 关系持有者实体ID或名称"
  targetType: "string (required) - 关系目标实体类型"
  targetId: "string (required) - 关系目标实体ID或名称"
since: "1.0"
---

# entity_graph_service.get_relationship_history

## 功能
查询元素 A 对元素 B 的 relationship 变更历史（全量事件，按时间正序）。006 升级新增工具，从独立 `entity_relationship_events` 表读取所有变更事件。

## 主要用途
- **关系演变回顾**：回顾 NPC 对玩家关系值的演变过程（如陌生 → 友好 → 仇敌）
- **剧情追溯**：分析关系变更的来源、时间、累加路径
- **审核反查**：辅助审核 NPC 行为是否符合其关系值（如关系值=-8 的 NPC 不应友好对待玩家）

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
// 节点不存在 / events 表无记录时返回 []（空数组,非 null）
EntityRelationshipEvent[]  // 按 created_at ASC 排序
```

`EntityRelationshipEvent` 结构：
```typescript
{
  id: string;
  saveId: string;
  observerNodeId: string;       // A 节点 ID
  targetNodeId: string;         // B 节点 ID
  scoreDelta: number;           // 本次变更量（relationship 永不合并,故为单次 delta）
  relationshipNote?: string;    // 关系备注
  source: RelationshipSource;   // 结构化来源对象
  mergedCount: number;          // relationship 永远为 1（永不压缩）
  createdAt: number;            // 事件创建时间戳(ms)
}[]
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

## 关系演变回顾示例
**NPC 老汤姆对玩家关系演变**：
- 初次见面：`scoreDelta=+1, source={type:'direct_observation'}, relationshipNote='初次见面'`
- 玩家救命：`scoreDelta=+5, source={type:'direct_observation'}, relationshipNote='救命之恩'`
- 玩家撒谎：`scoreDelta=-3, source={type:'direct_observation'}, relationshipNote='发现撒谎'`
- 累计 currentScore = 0 + 1 + 5 - 3 = 3（关系友好但有裂痕）

调用 `get_relationship_history(observerType=npc, observerId=老汤姆, targetType=character, targetId=player)` 返回 3 条事件，按时间正序排列，可清晰看到关系演变全过程。

## 注意事项
- **只读操作**：不修改任何数据，不走 StagingPool
- **节点不存在时返回 []（空数组）**：与 `get_relationship` 的"返回 null"语义不同（history 返回数组,空数组表示无历史）
- **方向性**：A 对 B 的 history 与 B 对 A 的 history 独立，需分别调用
- **排序**：按 `created_at ASC`（时间正序），便于关系演变回顾
- **永不压缩**：relationship 事件永远不合并（mergedCount 永远为 1），保留完整手动历史
- **当前状态查询**：如只需当前 score（不需历史），请使用 `get_relationship`（O(1) 更快）

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `character 实体引用解析失败: ref='player', ...` | Agent 误以为玩家角色 entity_id 是 'player' | character 类型支持 'player' 别名自动匹配玩家角色；或使用 `list_entities_by_type(entityType='character')` 查询真实 entityId |
| `PERCEIVES 边 observer 节点不存在` | observerId 未匹配到节点 | 错误响应含 `data.candidates` 候选列表，可从中选取正确 entityId 或 label 重试 |
| `PERCEIVES 边 target 节点不存在` | targetId 未匹配到节点 | 同上 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名实体存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 返回 []（空数组） | 节点已解析但 events 表无记录（未调用 set_relationship） | 先调用 `set_relationship` 追加事件；或检查 observerId/targetId 是否正确 |

## 与 get_relationship 的区别
| 维度 | get_relationship | get_relationship_history |
|------|-----------------|------------------------|
| 数据源 | states 表（当前状态） | events 表（全量历史） |
| 返回类型 | 对象或 null | 数组（空数组或事件数组） |
| 查询性能 | O(1) 单行查询 | O(N) N=事件数 |
| 主要用途 | GM prompt 注入当前 score | 关系演变回顾、剧情追溯、审核反查 |
| 排序 | 无（单行） | created_at ASC（时间正序） |
| 压缩 | 无（单行） | relationship 永不压缩（mergedCount 永远为 1） |

## 与 get_awareness_history 的差异
| 维度 | get_awareness_history | get_relationship_history |
|------|----------------------|------------------------|
| 数据源 | entity_awareness_events 表 | entity_relationship_events 表 |
| source.type 支持 | 含 `auto:dialogue` / `auto:combat` | 不含 auto:xxx（relationship 完全手动） |
| 压缩行为 | `auto:` 事件可被压缩（mergedCount > 1） | 永不压缩（mergedCount 永远为 1） |
| 自动化事件 | 包含 AwarenessAutoSubscriber 追加的事件 | 无自动化事件 |
| 主要用途 | 信息传播链反查（DialogueConsistencyChecker） | 关系演变回顾、剧情追溯 |
