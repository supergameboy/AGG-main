---
name: perception-management
description: 维护 NPC 对其他实体的感知关系数据（认识值与关系值）
targetAgent: ["gamemaster"]
trigger: [perception_update]
whenToUse: 战斗后、对话后、任务完成后、剧情转折点、NPC 交互后需要更新感知关系数据时
recommendedTools: [entity_graph_service]
relatedRules: []
completionCriteria: awarenessScore/relationshipScore 已更新且在 -10 到 +10 范围内
version: "1.0"
enabled: true
---

# 感知关系管理

## 任务是什么
在剧情推进的关键节点维护 NPC 对其他实体（玩家、其他 NPC、任务、事件等）的感知关系数据。感知关系由 PERCEIVES 边承载，包含两个独立维护的字段：
- `awarenessScore`（-10~+10）：NPC 对目标的**认识程度**（-10 完全陌生、0 隐约听说、+10 深刻了解）
- `relationshipScore`（-10~+10）：NPC 对目标的**关系倾向**（-10 极度讨厌、0 中性、+10 极度喜欢）

> **模块2 简化后唯一关系数据源**：`npc_service.update_relation` 已删除，所有 NPC 关系数据通过 PERCEIVES 边维护。本技能是 GM 维护感知关系的唯一引导文档。

## 为什么有这个任务
NPC 的行为决策必须基于其对世界的真实感知。如果感知关系数据不随剧情推进更新，NPC 的行为会脱离上下文——曾与玩家并肩作战的 NPC 表现得像陌生人，被玩家救过命的 NPC 对玩家冷漠。感知关系数据是 NPC 行为一致性的基础。

## 完成的标准是什么
1. 剧情关键节点已识别并触发感知关系更新
2. `entity_graph_service.set_awareness` 和/或 `entity_graph_service.set_relationship` 已被调用
3. `awarenessScore` 和 `relationshipScore` 值在 -10 到 +10 范围内
4. 关系值变化与剧情内容逻辑一致（救命之恩不能降关系，严重冒犯不能升关系）

## 怎么完成任务

### 场景驱动触发时机

| 场景 | 触发工具 | 期望效果 |
|------|---------|---------|
| 战斗后 | set_awareness + set_relationship | NPC 对玩家/敌人的认识与关系更新（并肩作战提升关系，目睹实力提升认识） |
| 对话后 | set_awareness + set_relationship | NPC 对玩家的认识与关系更新（深入交谈提升认识，友好交流提升关系） |
| 任务完成后 | set_awareness + set_relationship | NPC 对任务相关实体的认识与对玩家的关系更新（完成任务提升关系，失败可能降低） |
| 剧情转折点 | set_awareness + set_relationship | NPC 对事件相关实体的认识与对关键角色的关系更新（背叛降低关系，揭秘提升认识） |
| NPC 交互后 | set_awareness + set_relationship | NPC 之间互相的认识与关系更新（结盟提升关系，冲突降低关系） |

### 调用什么工具完成什么操作

1. **查询当前感知关系**（可选，用于判断是否需要更新）：
   - `entity_graph_service.get_relationship(observerType, observerId, targetType, targetId)` — 查询 NPC 对目标的关系值
   - `entity_graph_service.get_npc_profile(saveId, npcId)` — 一次获取 NPC 完整画像（含结构性关系+感知关系）

2. **更新认识值**：
   - `entity_graph_service.set_awareness(observerType, observerId, targetType, targetId, awarenessScore, awarenessNote?)`
   - observerType=npc，observerId=NPC ID，targetType/targetId 为认识目标

3. **更新关系值**：
   - `entity_graph_service.set_relationship(observerType, observerId, targetType, targetId, relationshipScore, relationshipNote?)`
   - observerType=npc，observerId=NPC ID，targetType/targetId 为关系目标

### 认识值（awarenessScore）赋值参考

| 场景 | awarenessScore | 说明 |
|------|---------------|------|
| 首次见面 | 1~2 | 隐约记住 |
| 多次互动 | 3~5 | 熟悉对方 |
| 深入了解 | 6~8 | 知晓对方过往 |
| 彻底洞察 | 9~10 | 完全看透对方 |
| 印象淡忘 | -1~-3 | 记忆模糊 |
| 完全遗忘 | -10 | 忘记对方存在 |

### 关系值（relationshipScore）赋值参考

| 场景 | relationshipScore | 说明 |
|------|-------------------|------|
| 救命之恩/至亲 | +8~+10 | 生死之交 |
| 并肩作战/挚友 | +5~+7 | 深厚友谊 |
| 友好互动 | +2~+4 | 友好关系 |
| 中性初次见面 | 0 | 陌生人 |
| 轻微冒犯 | -2~-4 | 不快 |
| 严重冲突 | -5~-7 | 敌意 |
| 背叛/血仇 | -8~-10 | 死敌 |

### 注意事项

- **方向性**：A 对 B 的感知关系与 B 对 A 的感知关系是独立的 PERCEIVES 边，需分别设置。例如玩家救了 NPC，NPC 对玩家的关系值升高，但玩家对 NPC 的关系值不变（玩家由人类控制，不存 PERCEIVES 边）
- **认识与关系独立**：`set_awareness` 仅更新 `awarenessScore`，`set_relationship` 仅更新 `relationshipScore`，两者共享同一条 PERCEIVES 边但独立维护字段，互不覆盖
- **NPC_PARTY 不写关系**：感知关系维护职责归 GM 故事编排，NPC_PARTY Agent 不调用 set_awareness/set_relationship
- **节点必须存在**：observer/target 节点缺失时会抛错（§13.3 归属保守处理），需先确保实体已创建
- **写操作经 StagingPool**：感知关系写入经 StagingKnex 代理走 StagingPool（§13.1），符合 ReAct 循环数据流转约束
- **避免过度更新**：仅在剧情关键节点更新感知关系，不要每轮对话都调整。关系值变化应体现剧情张力，而非机械累加

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "感知关系已更新",
  "data": {
    "npcId": "string",
    "perceptionUpdates": [
      {
        "targetType": "character",
        "targetId": "string",
        "awarenessScore": 5,
        "relationshipScore": 3,
        "note": "并肩作战后建立的友谊"
      }
    ]
  }
}
```
