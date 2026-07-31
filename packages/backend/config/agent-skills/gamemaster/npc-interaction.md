---
name: npc-interaction
description: 处理玩家与NPC的各种交互
targetAgent: [gamemaster]
trigger: [npc_interact]
whenToUse: 玩家与NPC互动、招募队友、查看NPC信息时
recommendedTools: [npc_service, coordinator_service, dialogue_service, dynamic_ui, entity_graph_service]
relatedRules: [dialogue-rules]
completionCriteria: NPC交互结果已生效、NPC状态已更新、交互叙事已生成
version: "2.1"
enabled: true
---

# NPC交互

## 任务是什么
处理玩家与NPC之间的非对话类交互，包括查看NPC信息、招募入队、移出队伍、维护感知关系等操作，确保NPC状态正确更新并向玩家呈现交互结果。

> **模块2 简化**：NPC 关系数据已迁移到 `entity_graph_service.set_relationship`（PERCEIVES 边，-10~+10 语义化）。`npc_service.update_relation` 已删除，禁止调用。

## 为什么有这个任务
NPC是游戏世界的核心组成部分，玩家与NPC的交互（组队、感知关系变化等）直接影响游戏进程和角色能力。需要一个统一的技能来协调NPC状态变更和叙事输出，避免状态与叙事脱节。

## 完成的标准是什么
1. 调用的npc_service方法返回成功状态码
2. NPC属性（队伍状态等）已持久化更新；感知关系已通过 `entity_graph_service.set_relationship` 维护
3. output Agent已生成并返回交互叙事文本
4. 玩家收到包含交互结果和叙事的完整响应

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `npc_service.get_npcs_by_location` — 获取当前地点的所有NPC列表，确定交互目标
2. 调用 `entity_graph_service.get_npc_profile` — 获取目标NPC完整画像（含基础信息+结构性关系+感知关系），判断交互可行性
3. 调用 `npc_service.get_party` — 获取当前队伍成员列表，判断队伍是否已满、NPC是否已在队伍中
4. 执行NPC状态变更操作（如 `npc_service.add_to_party`、`entity_graph_service.set_relationship` 等）
5. 调用 `coordinator_service.spawn_agent` — 派发 output 子Agent生成交互叙事

### 注意事项
- 招募NPC前必须检查：NPC是否已在队伍中、队伍是否已满
- 感知关系变更必须通过 `entity_graph_service.set_relationship`（observerType=npc, observerId=npcId, targetType=character, targetId=玩家ID, relationshipScore -10~+10 语义化）
- 移出队伍时需同步检查该NPC是否关联了待完成的任务目标
- 同一NPC在同一轮交互中不可重复执行互斥操作（如同时招募又移出）
- 查看NPC信息属于只读操作，不调用output Agent生成叙事，直接返回NPC数据
- output Agent返回失败时，仍保留已执行的NPC状态变更，GameMaster自行调用 `dialogue_service.submit_dialogue` 提交默认叙事

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "NPC交互完成",
  "data": {
    "interactionType": "recruit|dismiss|perception_update|view_info",
    "npcId": "string",
    "stateChanged": true,
    "narrativeGenerated": true
  }
}
```
