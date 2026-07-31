---
tool: npc_service
method: get_goals
description: "获取NPC的目标列表"
summary: "获取NPC的目标列表"
paramTypes:
  npcId: "string (required) - NPC ID"
  status: "string (optional) - 筛选状态(可选): active/completed/abandoned/blocked/archived"
returnType: "NPCGoal[]"
since: "1.0"
---

# npc_service.get_goals

## 功能
获取NPC的目标列表，支持按状态筛选。不传 status 时返回该NPC的所有目标。结果按优先级降序排列。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: NPC ID，可使用 UUID、templateNpcId 或 NPC 名称

### status（可选）
- **类型**: string
- **说明**: 按状态筛选目标
- **可选值**: `active`（进行中）、`completed`（已完成）、`abandoned`（已放弃）、`blocked`（被阻塞）、`archived`（已归档）
- **不传则返回所有状态的目标**

## 返回值
```typescript
NPCGoal[] // 目标列表，按优先级降序排列
// 每个 NPCGoal 结构:
{
  id: string;               // 目标ID
  npcId: string;            // 所属NPC ID
  type: string;             // 目标类型: long_term / mid_term
  category: string;         // 目标类别: survival/wealth/power/knowledge/relationship/duty/creative/freedom
  description: string;      // 目标描述
  status: string;           // 状态: active/completed/abandoned/blocked/archived
  priority: number;         // 优先级1-10
  progress?: string;        // 进度描述
  relatedEntityIds?: string[]; // 关联的Entity Graph节点ID
  createdAt: number;        // 创建时间戳
  updatedAt: number;        // 更新时间戳
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 结果按优先级降序排列（优先级高的在前）
- 不传 status 时返回所有状态的目标，包括已完成和已放弃的
- 如需只查看当前活跃目标，传入 `status: "active"`
- NPC无目标时返回空数组

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| npcId 必填 | 未提供 npcId | 提供有效的NPC ID |
| NPC not found | npcId 不存在 | 使用 `list_npcs` 获取真实NPC ID |
| 返回空列表 | NPC尚未创建目标 | 先使用 `create_goal` 为NPC创建目标 |
