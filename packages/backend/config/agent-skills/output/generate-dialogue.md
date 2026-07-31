---
name: generate-dialogue
description: 生成符合NPC性格设定的对话回应并记录
targetAgent: ["output"]
trigger: [generate_dialogue, dialogue]
whenToUse: 需要生成NPC的对话回复、多角色对话场景时
recommendedTools: [dialogue_service, npc_service]
relatedRules: [output-core]
completionCriteria: NPC对话已生成、对话风格与性格一致、对话已记录、态度已更新
version: "2.0"
enabled: true
---

# 生成对话

## 任务是什么
根据NPC性格、对话历史、情绪趋势和当前情境，生成符合角色设定的对话内容，并通过 dialogue_service 记录对话消息。

## 为什么有这个任务
NPC对话需要保持性格一致性和上下文连贯性，必须基于真实的对话历史和NPC属性生成，而非凭空编造。对话生成后需要记录到对话历史中，并可能影响NPC态度。

## 完成的标准是什么
1. NPC对话内容已生成，风格与NPC性格一致
2. 对话内容与历史上下文连贯，无矛盾
3. 对话消息已通过 dialogue_service 记录
4. NPC态度已根据对话内容更新（如需要）
5. 返回对话内容和态度变化

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `npc_service.get_npc` — 获取NPC详细信息（性格、态度、关系值）
   - 参数：`npcs`(array,必填): NPC ID数组
   - 返回：NPC详情列表，含名称、性格描述、态度、关系值

2. 调用 `dialogue_service.get_dialogue_context` — 获取完整对话上下文
   - 参数：`npcId`(string,必填): 目标NPC的ID
   - 返回：完整对话上下文，含历史消息、当前话题、情绪状态

3. 调用 `dialogue_service.get_recent_dialogue` — 获取最近N条对话，确保短期连贯
   - 参数：`npcId`(string,可选): NPC ID
   - 参数：`count`(number,可选): 获取条数
   - 返回：最近对话记录列表

4. 调用 `dialogue_service.get_emotion_trend` — 分析对话情绪变化趋势
   - 参数：`npcId`(string,必填): 目标NPC的ID
   - 返回：情绪趋势数据，含情绪变化方向和强度

5. 调用 `dialogue_service.submit_dialogue` — 提交本轮全部对话消息（批量）
   - 参数：`messages`(array,必填): 对话消息数组，每条包含 speaker、content、emotion(可选)、messageType(可选，默认npc)
   - 参数：`options`(array,必填): 对话选项数组，每条包含 text、npcId。始终提供2-4个选项引导玩家
   - 旁白/叙事：speaker="旁白"，messageType="narrator"
   - NPC对话：speaker=NPC名称，messageType="npc"
   - 返回：消息记录确认

6. 调用 `npc_service.update_disposition` — 根据对话内容更新NPC态度（如需要）
   - 参数：`npcId`(string,必填): 目标NPC的ID
   - 参数：`disposition`(string,必填): 态度值，可选值为 "devoted"、"friendly"、"warm"、"neutral"、"cold"、"hostile"、"hated"
   - 返回：更新后的态度状态

### 注意事项
- 必须先获取NPC信息和对话历史，再生成对话，确保性格和上下文一致
- 对话风格由NPC性格和态度共同决定：devoted/friendly/warm倾向热情、neutral倾向礼貌、cold/hostile/hated倾向冷淡
- 情绪趋势影响对话语气：情绪上升时更积极，下降时更消极
- 生成对话后必须调用 `submit_dialogue` 记录，否则对话历史会断裂
- 态度更新仅在对话内容导致态度变化时执行，普通对话不需要
- output Agent 的写操作仅限于 `submit_dialogue` 和 `update_disposition`，不执行其他写操作

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "对话生成完成",
  "data": {
    "npcId": "string",
    "dialogueContent": "string",
    "emotion": "string",
    "dialogueRecorded": true,
    "dispositionUpdated": "boolean",
    "currentDisposition": "devoted|friendly|warm|neutral|cold|hostile|hated"
  }
}
```
