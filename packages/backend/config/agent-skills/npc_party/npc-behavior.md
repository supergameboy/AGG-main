---
name: npc-behavior
description: 管理NPC行为、感知关系和目标驱动
targetAgent: ["npc_party"]
trigger: [npc_interact]
whenToUse: 需要维护NPC感知关系、管理NPC驱动力和目标、设置NPC对话目标时
recommendedTools: [npc_service, entity_graph_service]
relatedRules: [npc-core]
completionCriteria: NPC行为/感知关系数据已正确更新、目标已创建或更新
version: "2.1"
enabled: true
---

# NPC行为管理

## 任务是什么
管理NPC的行为驱动系统，包括维护NPC对其他实体的感知关系、创建和管理NPC目标、调整NPC属性以反映行为变化。

> **模块2 简化**：NPC 关系数据已迁移到 `entity_graph_service.set_relationship`（PERCEIVES 边，-10~+10 语义化）。`npc_service.update_relation` 已删除，禁止调用。

## 为什么有这个任务
NPC需要有内在的行为驱动力才能做出合理的行动决策。目标系统为NPC提供长期和中期动机，感知关系（PERCEIVES 边的 relationshipScore）决定NPC对玩家和其他实体的态度，这些数据共同驱动NPC的行为一致性。

## 完成的标准是什么
1. NPC感知关系已通过 `entity_graph_service.set_relationship` 正确更新（observerType=npc，传入 npcId 作为 observerId）
2. NPC目标已通过 `npc_service.create_goal` 创建或 `npc_service.update_goal` 更新
3. NPC属性已通过 `npc_service.update_npc` 同步更新
4. 行为变化与游戏情境一致

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `entity_graph_service.get_npc_profile` — 获取NPC完整画像（含基础信息+结构性关系+感知关系）
2. 调用 `entity_graph_service.set_relationship` — 维护 NPC 对其他实体的感知关系（observerType=npc，observerId=npcId）
3. 调用 `npc_service.create_goal` — 为NPC创建目标
4. 调用 `npc_service.update_goal` — 更新NPC目标状态
5. 调用 `npc_service.update_npc` — 更新NPC属性（心情、customData等）

### 注意事项
- **关系维护的唯一路径**：通过 `entity_graph_service.set_relationship` 写入 PERCEIVES 边的 `relationshipScore`（-10~+10 语义化）
- **关系值语义**：`+10` 极度喜欢、`+5` 喜欢、`0` 中性、`-5` 讨厌、`-10` 极度讨厌
- **方向性**：A 对 B 的关系与 B 对 A 的关系是独立的 PERCEIVES 边，需分别设置
- 目标类别应与NPC角色和性格匹配，商人倾向 wealth，守卫倾向 duty
- 同一NPC可有多个目标，按优先级排序影响行为决策
- 更新 customData 时为整体替换，需先获取原有数据再合并更新

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "NPC行为管理完成",
  "data": {
    "npcId": "string",
    "perceptionUpdated": "boolean",
    "goalCreated": "string|null",
    "attributesUpdated": "boolean"
  }
}
```

### 输出约束
- `npc_interact` 任务可输出 `npcName`/`npcResponse`（NPC行为回应，1-3句话，体现个性和情绪）
- `npcResponse` **禁止包含场景叙事**（如"清晨的阳光...""你站在广场上..."），仅限 NPC 个人的对话/行为回应
- 其他任务类型（`npc_create`/`npc_update`/`party_manage`/`npc_skill_init`/`npc_equipment_init`）禁止输出 `npcName`/`npcResponse`
