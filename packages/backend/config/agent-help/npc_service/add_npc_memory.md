---
tool: npc_service
method: add_npc_memory
description: "为NPC添加记忆"
summary: "为NPC添加记忆记录"
paramTypes:
  npcId: "string (required) - NPC ID或名称（如\"村长艾德温\"，可通过 list_npcs 查看）"
  content: "string (required) - 记忆内容"
  type: "string (required) - 记忆类型(interaction/quest/trade/combat/event/secret)"
  importance: "number (optional) - 重要程度(1-5，5最重要，默认1)"
  tags: "array (optional) - 标签数组"
returnType: "NPCMemory"
since: "1.0"
---

# npc_service.add_npc_memory

## 功能
为指定NPC添加一条记忆记录。记忆用于让NPC记住与角色的交互历史，影响后续对话和行为决策。记忆存储在NPC的 customData.memories 数组中。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 目标NPC ID
- **来源**: 必须使用预加载上下文或 `list_npcs` 返回的真实ID，禁止编造ID

### content（必填）
- **类型**: string
- **说明**: 记忆内容，描述发生了什么
- **示例**: "玩家帮助我找回了丢失的货物"

### type（必填）
- **类型**: string
- **说明**: 记忆类型，用于分类管理
- **可选值**:
  - `interaction` — 一般交互
  - `quest` — 任务相关
  - `trade` — 交易相关
  - `combat` — 战斗相关
  - `event` — 事件相关
  - `secret` — 秘密信息

### importance（可选）
- **类型**: number
- **说明**: 重要程度，范围1-5，5最重要
- **默认值**: 1
- **约束**: 超出1-5范围会被自动裁剪

### tags（可选）
- **类型**: string[]
- **说明**: 标签数组，用于记忆的分类和检索
- **示例**: `["交易", "铁匠", "武器"]`
- **默认值**: 空数组 `[]`

## 返回值

```typescript
NPCMemory // 新增的记忆记录
{
  id: string;        // 记忆ID，格式 mem_{npcId}_{type}
  content: string;   // 记忆内容
  type: string;      // 记忆类型
  importance: number; // 重要程度(1-5)
  timestamp: number;  // 创建时间戳
  tags: string[];     // 标签数组
}
```

## 注意事项
- 此方法为写操作，会向NPC添加新的记忆记录
- npcId 必须来自预加载上下文，禁止编造ID
- 记忆会影响NPC的行为决策和对话选择
- 重要程度高的记忆在决策中权重更高，且在记忆压缩时受保护
- NPC最多保留100条记忆，超出时按 importance 排序淘汰低优先级记忆
- 如需查看NPC的所有记忆，请使用 `get_npc_memories` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| NPC不存在 | npcId 错误 | 使用 `list_npcs` 确认有效的NPC ID |
| 无效的类型 | type 不在枚举值范围内 | 使用 interaction/quest/trade/combat/event/secret 之一 |
| importance 超范围 | 传入0或大于5的值 | 系统自动裁剪到1-5范围，建议直接传入合理值 |
