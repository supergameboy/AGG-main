---
tool: npc_service
method: add_experience
description: "为NPC增加经验值，经验达到阈值时自动升级并重算属性"
summary: "为NPC增加经验值"
paramTypes:
  npcId: "string (required) - NPC ID"
  amount: "number (required) - 经验值增量（正整数）"
since: "1.0"
---

# npc_service.add_experience

## 功能
为NPC增加经验值。当累计经验达到阈值（每100经验升1级）时自动升级，并重新计算NPC的属性值。经验值存储在NPC的 customData.experience 中。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: NPC ID，可使用 UUID、templateNpcId 或 NPC 名称

### amount（必填）
- **类型**: number
- **说明**: 经验值增量，必须为正整数
- **示例**: `50`（增加50点经验值）

## 返回值
```typescript
{
  experience: number;   // 增加后的总经验值
  level: number;        // 当前等级（可能已升级）
  leveledUp: boolean;   // 是否触发了升级
}
```

## 注意事项
- 此方法为写操作，会修改NPC的经验和等级数据
- amount 必须为正数，传0或负数会返回错误
- 升级阈值为每100经验升1级，公式: `level = floor(experience / 100) + 1`
- 升级时会自动重算NPC的属性值
- 经验值存储在 NPC 的 customData.experience 中
- 初始NPC的经验值为0，等级为1

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| amount must be a positive number | 传入了0或负数 | 确保amount为正整数 |
| NPC not found | npcId 不存在 | 使用 `list_npcs` 获取真实NPC ID |
| 必填参数缺失 | npcId/amount 未提供 | 确保提供所有必填参数 |
