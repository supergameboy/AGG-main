---
tool: entity_graph_service
method: get_awareness_batch
description: "批量查询多个认识者对同一目标的认知(消除N+1查询,供信息边界提示词层使用)。"
summary: "批量查询多A对B的认知"
paramTypes:
  observerType: "string (required) - 认识者实体类型"
  observerIds: "array (required) - 认识者实体ID或名称列表"
  targetType: "string (required) - 被认识者实体类型"
  targetId: "string (required) - 被认识者实体ID或名称"
since: "1.0"
---

# entity_graph_service.get_awareness_batch

## 功能
批量查询多个认识者（A1, A2, ...）对同一目标（B）的认识值。专为消除 N+1 查询设计——内部一次查询所有指向 B 的 PERCEIVES 边，再在内存中按 observerIds 过滤。

## 使用场景
- **信息边界提示词层**：构建 NPC 信息边界上下文时，需查询多个 NPC 对玩家/某目标的认识
- **批量审查**：GameMaster 审查多个 NPC 对同一实体的认知一致性
- **避免 N+1**：禁止在循环中调用 `get_awareness`，应使用本方法

## 参数详解

### observerType（必填）
- **类型**: string
- **说明**: 所有认识者共享的实体类型（如都是 npc）
- **可选值**: character / npc / location / item / quest / event / faction / skill / goal

### observerIds（必填）
- **类型**: array of string
- **说明**: 认识者实体 ID 或名称列表
- **兼容**: 13.2 name/id 双兼容，每个元素独立解析

### targetType（必填）
- **类型**: string
- **说明**: 被认识者（B）实体类型

### targetId（必填）
- **类型**: string
- **说明**: 被认识者（B）实体 ID 或名称

## 返回值
```typescript
Array<{
  observerId: string;         // 认识者实体 ID（传入时的原始值）
  awarenessScore: number;     // -10 ~ +10
  awarenessNote?: string;     // 认识备注（如有）
}>
// 未设置 awarenessScore 的 observer 不会出现在结果中
// 节点不存在的 observer 不会出现在结果中
```

## 注意事项
- **只读操作**：不修改任何数据
- **仅返回已设置 awarenessScore 的 observer**：未设置认识值的 observer 不会出现在结果数组中（不是返回 null，而是直接省略）
- **observerIds 顺序不保证**：结果数组顺序与传入 observerIds 顺序无关，消费方应按 observerId 字段匹配
- **目标节点不存在时返回空数组**：B 节点不存在时返回 `[]`，不抛错
- **同名歧义**：如果传入名称且存在多个同名节点，会按 13.2 时间戳兼容策略消歧；仍无法消歧时抛错

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `character 实体引用解析失败: ref='player', ...` | Agent 误以为玩家角色 entity_id 是 'player'，但实际为 `char_{name}_{timestamp}_{counter}` 格式（由 generateReadableId 生成，LLM 无法推断） | character 类型支持 'player' 别名自动匹配玩家角色（直接传 `targetId='player'` 或 `observerIds` 含 'player' 即可）；或使用 `list_entities_by_type(entityType='character')` 查询真实 entityId；或直接使用 label（角色名）作为引用 |
| `PERCEIVES 边 observer 节点不存在` | observerIds 中某元素未匹配到节点（既无 entity_id 匹配也无 label 匹配） | 错误响应含 `data.candidates` 候选列表（最多 10 个，按 created_at DESC 排序），可从中选取正确 entityId 或 label 重试；任一 observer 解析失败即整体返回失败响应 |
| `PERCEIVES 边 target 节点不存在` | targetId 未匹配到节点 | 同上，参考 `data.candidates` 候选列表自修正 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名实体存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 返回空数组 | 节点均已解析但 B 节点不存在 / 所有 A 均未设置 awarenessScore | 先调用 `set_awareness` 设置认识值 |
| 部分 observer 缺失 | 对应 A 节点已解析但未设置 awarenessScore | 检查 observerIds 是否有效，缺失的 observer 会被静默省略 |
