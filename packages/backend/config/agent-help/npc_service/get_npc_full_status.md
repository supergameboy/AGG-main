---
tool: npc_service
method: get_npc_full_status
description: "获取NPC完整状态面板(聚合信息/位置/关系/服务)"
summary: "获取NPC完整状态面板"
paramTypes:
  npcId: "string (required) - NPC ID"
returnType: "NPCStatusPanel"
since: "1.0"
---

# npc_service.get_npc_full_status

## 功能
获取指定NPC的完整状态面板，聚合了NPC的基本信息、当前位置和提供的服务等。比 `get_npc` 返回更全面的信息，包括位置名称解析和服务解锁状态。

> **模块2 简化**：关系数据已迁移到 `entity_graph_service.get_npc_profile`（一次调用消除N+1）。本方法不再返回 relations 字段。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 要查询的NPC ID
- **来源**: 必须使用预加载上下文或 `list_npcs` 返回的真实ID，禁止编造ID

## 返回值

```typescript
NPCStatusPanel
{
  basicInfo: {
    name: string;        // NPC名称
    title: string;       // 头衔
    race: string;        // 种族ID
    raceName: string;    // 种族显示名称（从模板解析，解析失败时回退为race ID）
    role: string;        // 角色
    level: number;       // 等级
  };
  location: {
    locationId: string | null;    // 位置ID
    locationName: string | null;  // 位置显示名称
  };
  partyStatus: {
    inParty: boolean;          // 是否在队伍中
    joinedAt: Timestamp | null; // 加入时间
  };
  availableServices: Array<{
    type: string;    // 服务类型
    name: string;    // 服务名称
    unlocked: boolean; // 是否已解锁
  }>;
  attributes: Record<string, number>;       // 基础属性
  derivedAttributes: Record<string, number>; // 派生属性
  currentHp: number | null;    // 当前生命值
  maxHp: number | null;        // 最大生命值
  currentMp: number | null;    // 当前魔法值
  maxMp: number | null;        // 最大魔法值
  attrInitialized: boolean;    // 属性是否已初始化
  invInitialized: boolean;     // 物品是否已初始化
  skillInitialized: boolean;   // 技能是否已初始化
  visibility: NPCVisibility;   // 可见性控制
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- npcId 必须来自预加载上下文或 `list_npcs` 的返回结果，禁止编造ID
- 此方法返回的信息比 `get_npc` 更全面，适合需要了解NPC全貌的场景
- 如只需基本属性，可使用更轻量的 `get_npc` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| NPC不存在 | npcId 错误 | 使用 `list_npcs` 确认有效的NPC ID |
