---
name: dialogue-rules
alwaysApply: false
hook: [dialogue]
targetAgent: [gamemaster]
description: 对话交互安全检查
priority: 70
---

# 对话交互安全检查

- 对话目标NPC必须存在于当前场景的NPC列表中，禁止编造NPC
- 对话选项必须包含真实的NPC标识，选项中的NPC标识必须对应场景中真实存在的NPC
- 禁止凭空创造当前场景中不存在的NPC进行对话
- 玩家选择对话选项时，必须根据选项内容生成NPC的针对性回复，禁止使用通用回复
- NPC回复必须体现对玩家选择的理解和反应
