---
tool: entity_graph_service
method: get_awareness_history
description: "查询A对B的awareness变更历史(全部事件,按时间正序)。用于审核反查信息传播链、剧情回顾。"
summary: "查询A对B的awareness变更历史"
paramTypes:
  observerType: "string (required) - 认识者实体类型"
  observerId: "string (required) - 认识者实体ID或名称"
  targetType: "string (required) - 被认识者实体类型"
  targetId: "string (required) - 被认识者实体ID或名称"
since: "1.0"
---

# entity_graph_service.get_awareness_history

## 功能
查询元素 A 对元素 B 的 awareness 变更历史（全量事件，按时间正序）。006 升级新增工具，从独立 `entity_awareness_events` 表读取所有变更事件。

## 主要用途
- **审核反查**：DialogueConsistencyChecker 验证 NPC 对话中的信息源声明（如"听村长说..."）是否在 awareness history 中有对应 `sourceType=informed_by` 事件
- **剧情回顾**：回顾 NPC 对玩家认识度的演变过程
- **关系演变追溯**：分析 awareness 变更的来源、时间、累加路径

## 参数详解

### observerType（必填）
- **类型**: string
- **说明**: 认识者（A）实体类型
- **可选值**: character / npc / location / item / quest / event / faction / skill / goal

### observerId（必填）
- **类型**: string
- **说明**: 认识者（A）实体 ID 或名称
- **兼容**: 13.2 name/id 双兼容

### targetType（必填）
- **类型**: string
- **说明**: 被认识者（B）实体类型

### targetId（必填）
- **类型**: string
- **说明**: 被认识者（B）实体 ID 或名称

## 返回值
```typescript
// 节点不存在 / events 表无记录时返回 []（空数组,非 null）
EntityAwarenessEvent[]  // 按 created_at ASC 排序
```

`EntityAwarenessEvent` 结构：
```typescript
{
  id: string;
  saveId: string;
  observerNodeId: string;       // A 节点 ID
  targetNodeId: string;         // B 节点 ID
  scoreDelta: number;           // 本次变更量（合并事件为累加值）
  awarenessNote?: string;       // 认识备注
  source: AwarenessSource;      // 结构化来源对象
  mergedCount: number;          // 合并次数（>=1,awareness 自动化事件可被压缩）
  createdAt: number;            // 事件创建时间戳(ms)
}[]
```

`AwarenessSource` 结构：
```typescript
{
  type: AwarenessSourceType;    // direct_observation/informed_by/overheard/rumor/player_stated/inferred/auto:dialogue/auto:combat
  informerType?: EntityType;    // type=informed_by 时存在
  informerId?: string;          // type=informed_by 时存在
  topicType?: EntityType;       // 可选,告知主题类型
  topicId?: string;             // 可选,告知主题 ID
  note?: string;                // 来源备注
  occurredAt: number;           // 来源发生时间戳(ms)
}
```

## 信息传播链反查示例
**老汤姆场景**：
- NPC 老汤姆说："听村长说玩家在调查暗影森林"
- DialogueConsistencyChecker 反查：
  1. 提取声明：speaker=老汤姆, sourceClaim=村长, topic=调查暗影森林
  2. 调用 `get_awareness_history(observerType=npc, observerId=老汤姆, targetType=character, targetId=player)`
  3. 检查 history 是否存在 `source.type=informed_by && source.informerId=村长艾德温 && source.topicType=quest && source.topicId=调查暗影森林` 的事件
  4. 不存在 → AuditFailure（severity='warning', suggestedFix="先调用 set_awareness 追加 informed_by 事件"）

## 注意事项
- **只读操作**：不修改任何数据，不走 StagingPool
- **节点不存在时返回 []（空数组）**：与 `get_awareness` 的"返回 null"语义不同（history 返回数组,空数组表示无历史）
- **方向性**：A 对 B 的 history 与 B 对 A 的 history 独立，需分别调用
- **排序**：按 `created_at ASC`（时间正序），便于审核反查与剧情回顾
- **压缩事件**：`auto:dialogue` / `auto:combat` 事件可能被压缩合并（mergedCount > 1），GM 手动事件与 `informed_by` 事件永不压缩（mergedCount = 1）
- **当前状态查询**：如只需当前 score（不需历史），请使用 `get_awareness`（O(1) 更快）

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `character 实体引用解析失败: ref='player', ...` | Agent 误以为玩家角色 entity_id 是 'player' | character 类型支持 'player' 别名自动匹配玩家角色；或使用 `list_entities_by_type(entityType='character')` 查询真实 entityId |
| `PERCEIVES 边 observer 节点不存在` | observerId 未匹配到节点 | 错误响应含 `data.candidates` 候选列表，可从中选取正确 entityId 或 label 重试 |
| `PERCEIVES 边 target 节点不存在` | targetId 未匹配到节点 | 同上 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名实体存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 返回 []（空数组） | 节点已解析但 events 表无记录（未调用 set_awareness） | 先调用 `set_awareness` 追加事件；或检查 observerId/targetId 是否正确 |
| 审核反查找不到 informed_by 事件 | NPC 声称"听 X 说..."但 history 无对应 informed_by 事件 | 先调用 `set_awareness(sourceType=informed_by, informerId=X, topicType=..., topicId=...)` 追加信息传播链事件 |

## 与 get_awareness 的区别
| 维度 | get_awareness | get_awareness_history |
|------|--------------|----------------------|
| 数据源 | states 表（当前状态） | events 表（全量历史） |
| 返回类型 | 对象或 null | 数组（空数组或事件数组） |
| 查询性能 | O(1) 单行查询 | O(N) N=事件数 |
| 主要用途 | GM prompt 注入当前 score | 审核反查、剧情回顾、关系演变追溯 |
| 排序 | 无（单行） | created_at ASC（时间正序） |
