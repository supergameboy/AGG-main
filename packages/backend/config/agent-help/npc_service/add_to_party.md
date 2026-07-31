---
tool: npc_service
method: add_to_party
description: "将NPC加入队伍(最多4人)"
summary: "将NPC加入队伍"
paramTypes:
  npcId: "string (required) - 要加入的NPC ID"
returnType: "PartyMember"
since: "1.0"
---

# npc_service.add_to_party

## 功能
将指定NPC加入角色队伍。队伍最多容纳4名成员。NPC加入队伍后标记为队伍成员状态。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 要加入队伍的NPC ID
- **来源**: 必须使用预加载上下文或 `list_npcs` 返回的真实ID，禁止编造ID

## 返回值

```typescript
PartyMember // 加入队伍的成员信息
```

PartyMember 结构：

```typescript
{
  npcId: string;          // NPC的ID
  name: string;           // NPC名称
  role: string;           // NPC角色
  level: number;          // NPC等级
  joinedAt: number | null; // 加入队伍的时间戳
}
```

## 注意事项
- 此方法为写操作，会修改队伍数据
- 队伍最多4名成员，超出限制会报错
- NPC已在队伍中时会报错
- **代码不检查NPC是否与角色在同一地点**，但游戏逻辑上应确保NPC在合理条件下加入
- npcId 必须来自预加载上下文，禁止编造ID

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 队伍已满 | 当前队伍已有4名成员 | 先使用 `remove_from_party` 移除不需要的成员 |
| NPC已在队伍中 | 该NPC已经是队伍成员 | 无需重复添加 |
| NPC不存在 | npcId 错误 | 使用 `list_npcs` 确认有效ID |
