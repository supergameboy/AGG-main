---
tool: npc_service
method: remove_from_party
description: "将NPC移出队伍"
summary: "将NPC移出队伍"
paramTypes:
  npcId: "string (required) - 要移除的NPC ID"
since: "1.0"
---

# npc_service.remove_from_party

## 功能
将指定NPC从角色队伍中移除。移除后NPC的 inParty 状态和 joinedPartyAt 会被清除。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 要移除的NPC ID
- **来源**: 必须使用预加载上下文或 `get_party` 返回的真实ID，禁止编造ID

## 返回值

```typescript
{ message: string } // 如 { message: "NPC npc_铁匠_xxx removed from party" }
```

## 注意事项
- 此方法为写操作，会修改队伍数据
- 只能移除当前在队伍中的NPC，NPC不在队伍中时会报错
- 移出队伍不会影响与NPC的关系值
- 移出队伍不会改变NPC的位置
- npcId 必须来自预加载上下文，禁止编造ID

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| NPC不在队伍中 | npcId 对应的NPC不在当前队伍 | 使用 `get_party` 确认队伍成员 |
| NPC不存在 | npcId 错误 | 使用 `get_party` 确认有效ID |
