---
tool: entity_graph_service
method: set_relationship
description: "调整元素A对元素B的关系值(delta累加语义,正数提升喜欢,负数降低)。currentScore=clamp(累加delta,-10,+10)。relationship完全手动,不自动化。"
summary: "调整A对B的关系值(delta累加,手动)"
paramTypes:
  observerType: "string (required) - 关系持有者实体类型"
  observerId: "string (required) - 关系持有者实体ID或名称"
  targetType: "string (required) - 关系目标实体类型"
  targetId: "string (required) - 关系目标实体ID或名称"
  scoreDelta: "number (required) - 本次关系变更量(正数提升喜欢,负数降低,如玩家救命+5/玩家撒谎-3)"
  sourceType: "string (required) - 来源类型: direct_observation/informed_by/overheard/rumor/player_stated/inferred"
  relationshipNote: "string (optional) - 关系备注(如\"曾经救过我的命\")"
  informerType: "string (optional) - sourceType=informed_by时必填:信息源实体类型"
  informerId: "string (optional) - sourceType=informed_by时必填:信息源实体ID或名称"
  topicType: "string (optional) - 告知主题类型(可选)"
  topicId: "string (optional) - 告知主题ID或名称(可选)"
  sourceNote: "string (optional) - 来源备注(自由文本补充)"
since: "1.0"
---

# entity_graph_service.set_relationship

## 功能
调整元素 A 对元素 B 的关系值。006 升级后采用 **delta 累加语义**：`scoreDelta` 是本次变更量（非绝对值），系统内部累加并 clamp 到 [-10, +10] 范围。relationship 数据从 PERCEIVES 边 properties 迁移到独立表（events + states 双表）：
- `entity_relationship_events` 表：追加变更事件（全量历史）
- `entity_relationship_states` 表：派生当前状态（current_score = clamp(累加 delta, -10, +10)）

## delta 语义（006 升级关键变更）
- **scoreDelta 是变更量，不是绝对值**：正数提升喜欢，负数降低
- **累加 + clamp**：currentScore = clamp(既有 currentScore + scoreDelta, -10, +10)
- **追加事件而非覆盖**：每次调用追加一条 event 到 events 表
- **完全手动，无自动化基线**：relationship 不订阅 dialogue/combat_end 事件，所有变更必须 GM 显式调用（与 set_awareness 的 auto:dialogue / auto:combat 自动化基线不同）

### 数值示例
- 初次见面 scoreDelta=+1 → currentScore = 0 + 1 = 1
- 玩家救命 scoreDelta=+5 → currentScore = 1 + 5 = 6
- 玩家撒谎 scoreDelta=-3 → currentScore = 6 - 3 = 3
- 已达 +10 后再传 scoreDelta=+5 → currentScore = clamp(10+5, -10, +10) = 10（不溢出）

## 结构化 source（006 升级关键变更）
`sourceType` 必填，并按类型补全结构化字段：

| sourceType | 含义 | 必填附加字段 | 用途 |
|------------|------|-------------|------|
| `direct_observation` | 亲眼所见 | 无 | NPC 亲眼看到玩家行为 |
| `informed_by` | 他人告知 | informerType + informerId | 关系信息传播链追溯 |
| `overheard` | 偶然听到 | 无 | NPC 偶然听到他人对话 |
| `rumor` | 传闻 | 无 | NPC 听到传闻 |
| `player_stated` | 玩家自述 | 无 | 玩家主动告知 NPC |
| `inferred` | 推断 | 无 | NPC 自行推断 |

可选附加字段：
- `topicType` + `topicId`：告知主题（如 quest 类型 + 任务 ID），用于追溯传播链
- `sourceNote`：自由文本补充来源详情
- `relationshipNote`：关系备注（非来源备注，描述关系内容本身，如"曾经救过我的命"）

## 写入时压缩规则（R1-R4）
relationship **永不压缩**（保留 GM 完整手动历史），但保留压缩入口以保持与 set_awareness API 对称：
- **R1**：同 source.type 且都是 `auto:` 开头 → relationship 无 auto:xxx 类型，永不满足
- **R2**：delta 绝对值 < 3 → 永不单独触发
- **R3**：source.type !== 'informed_by' → 永不单独触发
- **R4**：source.type 以 `auto:` 开头 → relationship 无 auto:xxx，永不满足

**实际效果**：relationship 每次调用都追加新事件，merged_count 永远为 1，保留完整关系演变历史。

## 参数详解

### observerType / observerId（必填）
- A（关系持有者）实体的类型与 ID/名称
- 13.2 name/id 双兼容，character 类型支持 'player' 别名

### targetType / targetId（必填）
- B（关系目标）实体的类型与 ID/名称
- 同 observerId 解析规则

### scoreDelta（必填）
- **类型**: number
- **语义**: 本次变更量（正数提升，负数降低）
- **典型值**: 玩家救命 +5，玩家撒谎 -3，完成任务 +2，敌对行为 -5

### sourceType（必填）
- **类型**: string
- **可选值**: direct_observation / informed_by / overheard / rumor / player_stated / inferred
- **informed_by 时必填** informerType + informerId
- **不支持** `auto:dialogue` / `auto:combat`（relationship 完全手动）

### relationshipNote（可选）
- 关系备注，描述关系内容（如"曾经救过我的命"、"杀父之仇"）

### informerType / informerId（sourceType=informed_by 时必填）
- 信息源实体类型与 ID/名称（如 npc 类型 + 村长艾德温）

### topicType / topicId（可选）
- 告知主题类型与 ID（如 quest 类型 + 调查暗影森林）

### sourceNote（可选）
- 自由文本补充来源详情（如"村长在酒馆告知"）

## 返回值
```typescript
{
  event: EntityRelationshipEvent;  // 追加的事件（relationship 永不合并,mergedCount=1）
  state: EntityRelationshipState;  // 更新后的当前状态
}
```

`EntityRelationshipEvent` 结构：
```typescript
{
  id: string;
  saveId: string;
  observerNodeId: string;
  targetNodeId: string;
  scoreDelta: number;          // 本次变更量（relationship 永不合并,故为单次 delta）
  relationshipNote?: string;
  source: RelationshipSource;  // 结构化来源对象
  mergedCount: number;         // relationship 永远为 1
  createdAt: number;
}
```

`EntityRelationshipState` 结构：
```typescript
{
  saveId: string;
  observerNodeId: string;
  targetNodeId: string;
  currentScore: number;        // clamp(累加 delta, -10, +10)
  effectiveNote?: string;
  effectiveSource: RelationshipSource;
  lastEventId: string;
  lastUpdated: number;
}
```

## 注意事项
- **写操作**：经 StagingKnex 代理走 StagingPool（§13.1），ReAct 循环内安全
- **节点必须存在**（§13.3 归属保守处理）：observer/target 节点缺失时**抛错**，禁止 fallback
- **方向性**：A 对 B 的关系与 B 对 A 的关系独立，需分别调用
- **不覆盖认识字段**：调用本方法不影响 awareness 数据（awareness 由 set_awareness 独立维护）
- **完全手动，无自动化**：relationship 不订阅任何事件总线事件，所有变更必须 GM 显式调用
- **永不压缩**：每次调用追加新事件，保留完整关系演变历史供审核反查与剧情回顾
- **关系数据单一数据源**：模块2 已删除旧 `npc_relations` 表及 `NPCService.update_relation` 方法。所有 NPC 关系值统一通过本方法写入独立 relationship 表，无其他写入路径

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `sourceType=informed_by 但未传 informerType/informerId` | informed_by 必填信息源 | 补全 informerType + informerId 参数 |
| `observer 节点不存在` | observerId 未匹配到节点 | 检查 ID/名称是否正确，或先调用 create_npc 创建实体 |
| `target 节点不存在` | targetId 未匹配到节点 | 同上 |
| `误传绝对值作为 scoreDelta` | 如 currentScore=2 想变为 5 时传 scoreDelta=5 | scoreDelta 应传 +3（5-2=3），不是绝对值 5 |
| `误传 sourceType=auto:dialogue` | relationship 不支持 auto:xxx 类型 | 使用 direct_observation/informed_by/overheard/rumor/player_stated/inferred 之一 |

## 与旧版（1.0）的差异
| 维度 | 1.0 | 006 升级 |
|------|-----|---------|
| score 语义 | 绝对值覆盖（relationshipScore） | delta 累加（scoreDelta） |
| source | 字符串（如"亲眼所见"） | 结构化对象（含 type/informerType/informerId/topicType/topicId/note/occurredAt） |
| 存储 | PERCEIVES 边 properties | 独立表（events + states 双表） |
| 历史记录 | 无（仅最新状态） | 完整事件历史（永不压缩） |
| 自动化基线 | 无 | 无（与 awareness 不同,relationship 完全手动） |
