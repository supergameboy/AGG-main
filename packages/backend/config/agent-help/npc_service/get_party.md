---
tool: npc_service
method: get_party
description: "获取当前队伍成员列表"
summary: "获取当前队伍成员"
returnType: "PartyMember[]"
since: "1.0"
---

# npc_service.get_party

## 功能
获取角色当前队伍的成员列表。返回队伍中所有NPC的基本信息，按加入时间升序排列。

## 参数详解
此方法无需任何参数。

## 返回值

```typescript
PartyMember[] // 按加入时间升序排列
```

每个 PartyMember 结构：

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
- 此方法为只读操作，不会修改任何数据
- 返回结果仅包含当前在队伍中的NPC
- 如需添加或移除队伍成员，请使用 `add_to_party` 或 `remove_from_party` 方法
- 队伍最多4名成员

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 队伍中无成员 | 使用 `add_to_party` 添加NPC到队伍 |
