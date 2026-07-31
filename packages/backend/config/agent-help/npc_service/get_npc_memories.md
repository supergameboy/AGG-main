---
tool: npc_service
method: get_npc_memories
description: "获取NPC的记忆列表"
summary: "获取NPC的记忆列表"
paramTypes:
  npcId: "string (required) - NPC ID"
  type: "string (optional) - 过滤记忆类型(interaction/quest/trade/combat/event/secret)"
  limit: "number (optional) - 返回数量限制(默认20)"
returnType: "NPCMemory[]"
since: "1.0"
---

# npc_service.get_npc_memories

## 功能
获取指定NPC的记忆列表。支持按类型过滤和数量限制。记忆按时间倒序排列（最新在前），同时间按重要程度降序。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 要查询记忆的NPC ID
- **来源**: 必须使用预加载上下文或 `list_npcs` 返回的真实ID，禁止编造ID

### type（可选）
- **类型**: string
- **说明**: 过滤记忆类型
- **可选值**: interaction、quest、trade、combat、event、secret
- **默认行为**: 不传则返回所有类型的记忆

### limit（可选）
- **类型**: number
- **说明**: 返回数量限制
- **默认值**: 20

## 返回值

```typescript
{
  memories: NPCMemory[];  // 按时间倒序+重要程度降序排列
  hint?: string;          // 当memories为空时的提示信息
}
```

每条 NPCMemory 包含：id、content、type、importance、timestamp、tags。

## 注意事项
- 此方法为只读操作，不会修改任何数据
- npcId 必须来自预加载上下文，禁止编造ID
- 记忆排序规则：先按时间戳降序（最新在前），时间相同时按重要程度降序
- 当结果为空时，返回值中会包含 hint 字段提供排查建议
- 如需添加新记忆，请使用 `add_npc_memory` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| NPC不存在 | npcId 错误 | 使用 `list_npcs` 确认有效的NPC ID |
| 返回空列表 | NPC尚无记忆记录 | 检查 hint 字段，使用 `add_npc_memory` 为NPC添加记忆 |
