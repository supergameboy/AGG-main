---
tool: npc_service
method: create_goal
description: "为NPC创建目标(长期/中期)，目标驱动NPC行为决策"
summary: "为NPC创建目标"
paramTypes:
  npcId: "string (required) - NPC ID或名称（如\"村长艾德温\"）"
  type: "string (required) - 目标类型: long_term(长期) 或 mid_term(中期)"
  category: "string (required) - 目标类别: survival/wealth/power/knowledge/relationship/duty/creative/freedom"
  description: "string (required) - 目标描述"
  priority: "number (optional) - 优先级1-10，默认5"
  relatedEntityIds: "array (optional) - 关联的实体ID或名称数组"
since: "1.0"
---

# npc_service.create_goal

## 功能
为NPC创建目标（长期或中期），目标驱动NPC的行为决策。目标系统为NPC提供行为动机，使NPC的行动更有逻辑性和一致性。创建的目标初始状态为 active。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: NPC ID，可使用 UUID、templateNpcId 或 NPC 名称

### type（必填）
- **类型**: string
- **说明**: 目标类型
- **可选值**: `long_term`（长期目标）、`mid_term`（中期目标）
- **示例**: `"long_term"`

### category（必填）
- **类型**: string
- **说明**: 目标类别，决定目标的动机方向
- **可选值**: `survival`（生存）、`wealth`（财富）、`power`（权力）、`knowledge`（知识）、`relationship`（关系）、`duty`（职责）、`creative`（创造）、`freedom`（自由）

### description（必填）
- **类型**: string
- **说明**: 目标描述，清晰描述NPC想要达成什么

### priority（可选）
- **类型**: number
- **说明**: 优先级，范围1-10，默认5。数值越高优先级越高

### relatedEntityIds（可选）
- **类型**: array
- **说明**: 关联的 Entity Graph 节点ID数组，用于建立目标与游戏实体的关联

## 返回值
```typescript
{
  goalId: string;  // 新创建的目标ID，格式如 goal_{npcId}_{timestamp}
}
```

## 注意事项
- 此方法为写操作，会创建新的目标数据
- 创建的目标初始状态为 `active`
- 目标ID由系统自动生成（格式 `goal_{npcId}_{timestamp}`）
- 同一NPC可以有多个目标，按优先级排序
- 目标类别应与NPC的角色和性格匹配，避免不合理的目标设定

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 必填参数缺失 | npcId/type/category/description 未提供 | 确保提供所有必填参数 |
| NPC not found | npcId 不存在 | 使用 `list_npcs` 获取真实NPC ID |
| 无效的 category | category 值不在允许范围内 | 使用 survival/wealth/power/knowledge/relationship/duty/creative/freedom 之一 |
