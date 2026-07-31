---
tool: entity_graph_service
method: get_entity_awareness
description: "查询元素A对所有其他元素的认识(业务查询)。"
summary: "查询A对所有元素的认识"
paramTypes:
  observerType: "string (required) - 认识者实体类型"
  observerId: "string (required) - 认识者实体ID或名称"
since: "1.0"
---

# entity_graph_service.get_entity_awareness

## 功能
查询元素 A 对所有其他元素的认识。返回 A 作为 observer 的所有 PERCEIVES 边中设置了 `awarenessScore` 的条目。

## 使用场景
- **NPC 自我认知审查**：查询某 NPC 对场景中所有其他实体的认识状态
- **认识完整性检查**：GameMaster 检查 NPC 是否对关键实体（如玩家、地点、任务）有足够的认识
- **上下文构建**：构建 NPC 决策上下文时，提供该 NPC 对周边实体的认知全景

## 参数详解

### observerType（必填）
- **类型**: string
- **说明**: 认识者（A）实体类型
- **可选值**: character / npc / location / item / quest / event / faction / skill / goal

### observerId（必填）
- **类型**: string
- **说明**: 认识者（A）实体 ID 或名称
- **兼容**: 13.2 name/id 双兼容

## 返回值
```typescript
Array<{
  targetId: string;        // 目标实体 ID（节点 ID 的 entityId 部分）
  targetType: string;      // 目标实体类型（从节点 ID 解析）
  awarenessScore: number;  // -10 ~ +10
  awarenessNote?: string;  // 认识备注（如有）
}>
// 仅返回设置了 awarenessScore 的目标
// A 节点不存在时返回空数组
```

## 注意事项
- **只读操作**：不修改任何数据
- **仅返回 awarenessScore 字段**：如需 relationshipScore，请单独调用 `get_relationship` 或扩展接口
- **targetType 从节点 ID 解析**：节点 ID 格式为 `egn_{type}_{saveId}_{entityId}`，targetType 取自第二段
- **节点不存在时返回空数组**：A 节点不存在时返回 `[]`，不抛错
- **性能**：单次查询 A 的所有出向 PERCEIVES 边，无 N+1 问题

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `character 实体引用解析失败: ref='player', ...` | Agent 误以为玩家角色 entity_id 是 'player'，但实际为 `char_{name}_{timestamp}_{counter}` 格式（由 generateReadableId 生成，LLM 无法推断） | character 类型支持 'player' 别名自动匹配玩家角色（直接传 `observerId='player'` 即可）；或使用 `list_entities_by_type(entityType='character')` 查询真实 entityId；或直接使用 label（角色名）作为引用 |
| `observer 实体引用解析失败: ref='xxx', ...` | observerId 未匹配到节点（既无 entity_id 匹配也无 label 匹配） | 错误响应含 `data.candidates` 候选列表（最多 10 个，按 created_at DESC 排序），可从中选取正确 entityId 或 label 重试；或调用 `list_entities_by_type` 查询完整列表 |
| `label 匹配多个节点且未传 timestamp 无法消歧` | 同名实体存在多个 | 错误响应含 `data.candidates` 全部匹配项，选取其中之一重试 |
| 返回空数组 | A 节点已解析但不存在 / A 未对任何实体设置 awarenessScore | 先调用 `set_awareness` 设置认识值 |
| 缺少某目标 | A 对该目标未设置 awarenessScore（或 PERCEIVES 边不存在） | 检查 A 的认识覆盖范围，按需补充 |
