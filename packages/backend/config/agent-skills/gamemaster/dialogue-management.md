---
name: dialogue-management
description: 管理玩家与NPC的对话流程
targetAgent: [gamemaster]
trigger: [dialogue]
whenToUse: 玩家与NPC交谈、询问信息、进行对话选择时
recommendedTools: [dialogue_service, npc_service, entity_graph_service]
relatedRules: [dialogue-rules]
completionCriteria: 对话消息已记录、对话叙事已生成
version: "2.1"
enabled: true
---

# 对话管理

## 任务是什么
处理玩家与NPC之间的对话交互，获取NPC画像和对话上下文，委派 output Agent 生成对话内容，记录对话消息，处理对话触发的后续效果。

> **模块2 简化**：
> - `DialogueEffect.type` 已删除 `'relation_change'`，对话流程不再产生关系变更效果
> - `npc_service.update_relation` 已删除，NPC 关系数据由 GM 通过 `entity_graph_service.set_relationship` 维护

## 为什么有这个任务
对话是玩家获取信息、推进剧情、触发任务的主要方式。对话内容需要基于NPC的性格和感知关系状态生成，对话结果需要持久化记录。没有统一的对话管理，NPC反应会脱离上下文。

## 完成的标准是什么
1. `dialogue_service.submit_dialogue` 已被调用，本轮全部对话消息（含旁白和NPC回应）均已记录
2. 对话叙事文本已通过 output Agent 生成并返回给玩家
3. 如果对话触发了任务或事件，对应的 quest_service 或 event_service 方法已被调用
4. 若对话显著影响 NPC 对玩家的态度，GM 显式调用 `entity_graph_service.set_relationship` 维护感知关系（非对话流程自动产生）

## 怎么完成任务

### 调用什么子Agent派发什么任务
- 子Agent类型：output
- 派发任务描述：根据NPC画像和对话上下文生成NPC的对话回应
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "output",
    "task": "生成NPC对话回应",
    "action": "generate_dialogue",
    "context": {
      "npcProfile": "<从entity_graph_service.get_npc_profile获取>",
      "dialogueContext": "<从dialogue_service.get_dialogue_context获取>",
      "playerMessage": "<玩家的对话内容>",
      "currentLocation": "<当前位置信息>"
    }
  }
  ```

### 注入哪些条目的信息
1. 从 `entity_graph_service.get_npc_profile` 获取目标NPC完整画像（含基础信息+结构性关系+感知关系），注入给 output Agent 用于生成符合NPC人设的回应
2. 从 `dialogue_service.get_dialogue_context` 获取完整对话上下文（npcId），包含历史消息和当前对话状态，注入给 output Agent 确保对话连贯
3. 从 `map_service.get_current_location` 获取当前位置信息，注入给 output Agent 用于场景相关的对话内容
4. 从 `npc_service.get_npcs_by_location` 获取当前地点的其他NPC，用于可能的多人对话场景

### 注意事项
1. 必须先通过 `npc_service.get_npcs_by_location` 或玩家指定确定对话NPC，获取 npcId
2. 调用 `dialogue_service.get_dialogue_context` 时必须传入 npcId，确保获取正确的对话历史
3. 调用 `dialogue_service.submit_dialogue` 时，messages 数组包含本轮全部消息，旁白用 speaker="旁白" messageType="narrator"，NPC用 speaker=NPC名称 messageType="npc"
4. emotion 参数为可选，用于标记NPC的情绪状态（如 "angry"、"happy"、"sad"）
5. 对话效果类型仅支持：`quest_trigger`、`item_grant`、`topic_switch`、`emotion_change`（`relation_change` 已删除）
6. 如果对话中NPC提到了任务线索，需要调用 `quest_service.create_quest` 或 `quest_service.accept_quest` 处理
7. 如果对话触发了剧情事件，需要调用 `event_service.trigger_event` 处理
8. 使用 output Agent 处理对话叙事（dialogue Agent 已合并到 output Agent）
9. 对话中若 NPC 提及自身委托的任务，且该任务当前 `visible:false`，对话结束后必须调用 `quest_service.update_quest` 将 `visible` 置为 true、`status` 置为 available
10. 任务可见性触发仅对 NPC 发布的任务（giverNpcId 非空）生效，系统引导任务（giverNpcId 为空）始终可见，无需对话触发
11. 若对话内容显著影响 NPC 对玩家的态度（如赠送礼物、救命之恩、严重冒犯），GM 应在对话流程外显式调用 `entity_graph_service.set_relationship` 维护感知关系

### 收到子Agent返回的结果之后执行什么操作
1. **判断 output Agent 任务是否成功**：检查返回结果中是否包含 npcResponse 字段且内容非空
2. **成功后**：
   - 调用 `dialogue_service.submit_dialogue` 批量记录本轮全部对话消息（旁白+NPC回应）
   - 检查是否触发任务或事件，如有则调用对应服务
   - 检查对话 NPC 是否关联 `visible:false` 的任务，若有则调用 `quest_service.update_quest`（questId、`{visible:true, status:"available"}`）触发任务可见性
   - 如对话显著影响 NPC 感知关系，调用 `entity_graph_service.set_relationship`（NPC→玩家方向）
   - 将NPC回应文本返回给玩家
3. **失败后**：如果 output Agent 返回错误，使用NPC基本信息拼接简短回应返回给玩家，确保对话不中断
4. **最终向玩家输出**：NPC的对话回应文本
