---
name: generate-narrative
description: 根据游戏事件和状态生成沉浸式叙事文本
targetAgent: ["output"]
trigger: [generate_narrative]
whenToUse: 需要生成场景描述、行动结果叙述、环境氛围描写时
recommendedTools: [dialogue_service, character_service, game_time_service, npc_service]
relatedRules: [output-core]
completionCriteria: 叙事内容已生成、融入世界观、氛围与场景匹配、输出格式符合规范
version: "2.0"
enabled: true
---

# 生成叙事

## 任务是什么
根据当前游戏状态（角色、位置、时间、NPC、对话上下文）生成沉浸式叙事描述文本。

## 为什么有这个任务
叙事文本是玩家感知游戏世界的主要载体，需要基于真实的游戏状态数据生成，确保描述与实际一致。output Agent 只读取状态生成文本，不执行写操作。

## 完成的标准是什么
1. 叙事内容已生成，包含场景描述和行动结果
2. 叙事融入游戏世界观，与当前场景氛围匹配
3. 叙事内容基于真实游戏状态数据，无虚构矛盾
4. 输出格式符合结构化规范

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `character_service.get_full_status` — 获取角色完整状态，作为叙事的角色上下文
   - 参数：无必填参数
   - 返回：角色完整状态面板，含属性、HP/MP、装备摘要

2. 调用 `game_time_service.get_current_time` — 获取当前游戏时间，确定时段氛围
   - 参数：无必填参数
   - 返回：当前游戏时间详情，含日期、时段、天气

3. 调用 `dialogue_service.get_dialogue_context` — 获取对话上下文，了解近期交互
   - 参数：`npcId`(string,必填): 相关NPC的ID
   - 返回：完整对话上下文，含历史消息和情绪趋势

4. 调用 `npc_service.get_npc` — 获取场景中NPC的详细信息
   - 参数：`npcs`(array,必填): NPC ID数组
   - 返回：NPC详情列表，含名称、描述、态度、状态

### 注意事项
- 叙事内容必须基于工具返回的真实数据，不得虚构与游戏状态矛盾的内容
- 叙事基调由场景类型和时段决定：战斗紧张、探索神秘、城镇温馨、旅途辽阔
- 时间氛围影响描写风格：黎明希望、正午明朗、黄昏感伤、夜晚神秘
- 叙事文本通过 `dialogue_service.submit_dialogue` 提交，speaker="旁白"，messageType="narrator"
- 生成叙事后调用 `submit_dialogue` 记录，确保叙事持久化

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "叙事生成完成",
  "data": {
    "narrative": "string",
    "sceneType": "string",
    "timePeriod": "string",
    "npcsInvolved": ["string"],
    "basedOnState": true
  }
}
```
