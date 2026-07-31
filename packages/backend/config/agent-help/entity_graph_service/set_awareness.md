---
tool: entity_graph_service
method: set_awareness
description: "调整元素A对元素B的认识值(delta累加语义,正数提升认识,负数降低)。currentScore=clamp(累加delta,-10,+10)。source结构化记录变更来源,informed_by用于信息传播链追溯。"
summary: "调整A对B的认识值(delta累加)"
paramTypes:
  observerType: "string (required) - 认识者实体类型(character/npc/location/item/quest/event/faction/skill/goal)"
  observerId: "string (required) - 认识者实体ID或名称"
  targetType: "string (required) - 被认识者实体类型"
  targetId: "string (required) - 被认识者实体ID或名称"
  scoreDelta: "number (required) - 本次认识变更量(正数提升,负数降低,如深入交谈+3/玩家撒谎被发现-5/初次见面+1)"
  sourceType: "string (required) - 来源类型: direct_observation(亲眼所见)/informed_by(他人告知)/overheard(偶然听到)/rumor(传闻)/player_stated(玩家自述)/inferred(推断)"
  awarenessNote: "string (optional) - 认识备注(如\"村长告知此矮人来调查暗影森林\")"
  informerType: "string (optional) - sourceType=informed_by时必填:信息源实体类型(如npc)"
  informerId: "string (optional) - sourceType=informed_by时必填:信息源实体ID或名称(如村长艾德温)"
  topicType: "string (optional) - 告知主题类型(如quest,可选,用于追溯传播链)"
  topicId: "string (optional) - 告知主题ID或名称(如调查暗影森林)"
  sourceNote: "string (optional) - 来源备注(自由文本补充,如\"村长在酒馆告知\")"
since: "1.0"
---

# entity_graph_service.set_awareness

## 功能
调整元素 A 对元素 B 的认识值。006 升级后采用 **delta 累加语义**：`scoreDelta` 是本次变更量（非绝对值），系统内部累加并 clamp 到 [-10, +10] 范围。awareness 数据从 PERCEIVES 边 properties 迁移到独立表（events + states 双表）：
- `entity_awareness_events` 表：追加变更事件（全量历史 + 写入时压缩 R1-R4）
- `entity_awareness_states` 表：派生当前状态（current_score = clamp(累加 delta, -10, +10)）

## delta 语义（006 升级关键变更）
- **scoreDelta 是变更量，不是绝对值**：正数提升认识，负数降低
- **累加 + clamp**：currentScore = clamp(既有 currentScore + scoreDelta, -10, +10)
- **追加事件而非覆盖**：每次调用追加一条 event 到 events 表（除非满足压缩规则）
- **自动化与 GM 共存**：delta 累加天然叠加，无需 GM 覆盖锁

### 数值示例
- 初次见面 scoreDelta=+1 → currentScore = 0 + 1 = 1
- 深入交谈 scoreDelta=+3 → currentScore = 1 + 3 = 4
- 玩家撒谎被发现 scoreDelta=-5 → currentScore = 4 - 5 = -1
- 已达 +10 后再传 scoreDelta=+3 → currentScore = clamp(10+3, -10, +10) = 10（不溢出）

## 结构化 source（006 升级关键变更）
`sourceType` 必填，并按类型补全结构化字段：

| sourceType | 含义 | 必填附加字段 | 用途 |
|------------|------|-------------|------|
| `direct_observation` | 亲眼所见 | 无 | NPC 亲眼看到玩家行为 |
| `informed_by` | 他人告知 | informerType + informerId | **信息传播链追溯**（如村长告知老汤姆） |
| `overheard` | 偶然听到 | 无 | NPC 偶然听到他人对话 |
| `rumor` | 传闻 | 无 | NPC 听到传闻 |
| `player_stated` | 玩家自述 | 无 | 玩家主动告知 NPC |
| `inferred` | 推断 | 无 | NPC 自行推断 |

可选附加字段：
- `topicType` + `topicId`：告知主题（如 quest 类型 + 任务 ID），用于追溯传播链
- `sourceNote`：自由文本补充来源详情
- `awarenessNote`：认识备注（非来源备注，描述认识内容本身）

## 写入时压缩规则（R1-R4）
满足全部条件时与上一条事件合并（merged_count 累加），否则追加新事件：
- **R1**：同 source.type 且都是 `auto:` 开头
- **R2**：delta 绝对值 < 3（非关键转折）
- **R3**：source.type !== 'informed_by'（保留 informed_by 事件）
- **R4**：source.type 以 `auto:` 开头（保留 GM 手动事件）

## 参数详解

### observerType / observerId（必填）
- A（认识者）实体的类型与 ID/名称
- 13.2 name/id 双兼容，character 类型支持 'player' 别名

### targetType / targetId（必填）
- B（被认识者）实体的类型与 ID/名称
- 同 observerId 解析规则

### scoreDelta（必填）
- **类型**: number
- **语义**: 本次变更量（正数提升，负数降低）
- **典型值**: 初次见面 +1，深入交谈 +3，玩家撒谎被发现 -5

### sourceType（必填）
- **类型**: string
- **可选值**: direct_observation / informed_by / overheard / rumor / player_stated / inferred
- **informed_by 时必填** informerType + informerId

### awarenessNote（可选）
- 认识备注，描述认识内容（如"村长告知此矮人来调查暗影森林"）

### informerType / informerId（sourceType=informed_by 时必填）
- 信息源实体类型与 ID/名称（如 npc 类型 + 村长艾德温）

### topicType / topicId（可选）
- 告知主题类型与 ID（如 quest 类型 + 调查暗影森林）

### sourceNote（可选）
- 自由文本补充来源详情（如"村长在酒馆告知"）

## 返回值
```typescript
{
  event: EntityAwarenessEvent;  // 追加或合并后的事件
  state: EntityAwarenessState;  // 更新后的当前状态
}
```

`EntityAwarenessEvent` 结构：
```typescript
{
  id: string;
  saveId: string;
  observerNodeId: string;
  targetNodeId: string;
  scoreDelta: number;          // 本次变更量（合并事件为累加值）
  awarenessNote?: string;
  source: AwarenessSource;     // 结构化来源对象
  mergedCount: number;         // 合并次数（>=1）
  createdAt: number;
}
```

`EntityAwarenessState` 结构：
```typescript
{
  saveId: string;
  observerNodeId: string;
  targetNodeId: string;
  currentScore: number;        // clamp(累加 delta, -10, +10)
  effectiveNote?: string;
  effectiveSource: AwarenessSource;
  lastEventId: string;
  lastUpdated: number;
}
```

## 信息传播链（informed_by 用法）
**老汤姆场景**（设计文档 §3.2）：
- 错误做法：老汤姆凭空说"听村长说玩家干了什么"——但 awareness history 无 informed_by:村长 事件 → DialogueConsistencyChecker 报 warning + suggestedFix
- 正确做法：先调用 `set_awareness(observerType=npc, observerId=老汤姆, targetType=character, targetId=player, scoreDelta=+3, sourceType=informed_by, informerType=npc, informerId=村长艾德温, topicType=quest, topicId=调查暗影森林)` 追加信息传播链事件，再让老汤姆说"听村长说..."

## 注意事项
- **写操作**：经 StagingKnex 代理走 StagingPool（§13.1），ReAct 循环内安全
- **节点必须存在**（§13.3 归属保守处理）：observer/target 节点缺失时**抛错**，禁止 fallback
- **方向性**：A 对 B 的认识与 B 对 A 的认识独立，需分别调用
- **不覆盖关系字段**：调用本方法不影响 relationship 数据（relationship 由 set_relationship 独立维护）
- **自动化基线**：dialogue 事件自动 +1（auto:dialogue），combat_end 事件自动 +3（auto:combat），无需 GM 主动调用

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `sourceType=informed_by 但未传 informerType/informerId` | informed_by 必填信息源 | 补全 informerType + informerId 参数 |
| `observer 节点不存在` | observerId 未匹配到节点 | 检查 ID/名称是否正确，或先调用 create_npc 创建实体 |
| `target 节点不存在` | targetId 未匹配到节点 | 同上 |
| `误传绝对值作为 scoreDelta` | 如 currentScore=2 想变为 5 时传 scoreDelta=5 | scoreDelta 应传 +3（5-2=3），不是绝对值 5 |

## 与旧版（1.0）的差异
| 维度 | 1.0 | 006 升级 |
|------|-----|---------|
| score 语义 | 绝对值覆盖（awarenessScore） | delta 累加（scoreDelta） |
| source | 字符串（如"亲眼所见"） | 结构化对象（含 type/informerType/informerId/topicType/topicId/note/occurredAt） |
| 存储 | PERCEIVES 边 properties | 独立表（events + states 双表） |
| 历史记录 | 无（仅最新状态） | 完整事件历史（可压缩合并） |
| 信息传播链追溯 | 不支持 | 通过 sourceType=informed_by + informerId 追溯 |
