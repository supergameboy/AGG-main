---
name: response-format
alwaysApply: true
targetAgent: [gamemaster]
description: 响应格式约束，确保输出结构一致
priority: 75
---

# 响应格式约束

- 每次响应必须包含叙事内容，不能只返回工具调用结果
- 叙事内容必须融入游戏世界观，禁止出现现实世界的表述
- 涉及多个实体的操作结果，必须在叙事中逐一体现变化
- 输出由JSON对象 + UI指令组成，用 `---UI---` 分隔符分开
- JSON部分必须为纯JSON对象，禁止用markdown代码块包裹，`ui.components` 字段必须省略
- 分隔符必须在JSON闭合 `}` 之后新起一行写 `---UI---`
- UI部分在 `---UI---` 之后写所有:::组件语法，无UI需求时省略整个UI部分
- dialogue.messages必须为多speaker消息数组，每条包含 speaker/content/emotion/npcId（旁白npcId为null）
- dialogue.options必须为对话选项数组，每个选项必须包含 id/text/npcId
- ui.intensity必须为 "minimal" | "partial" | "full" 之一
- 旁白至少80字，NPC消息至少50字，每次至少2条消息
- 对话选项仅NPC对话分支才输出options，每个option必须含真实npcId
- 对话涉及NPC时，dialogue对象中可输出 npcId/npcName/npcRole/npcTitle/reputation/mood/locationId/services/level/description/race
