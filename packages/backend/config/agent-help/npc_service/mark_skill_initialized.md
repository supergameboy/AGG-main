---
tool: npc_service
method: mark_skill_initialized
description: "标记NPC技能已初始化（设置skill_initialized=1）。在LLM生成技能并学习后调用。"
summary: "标记NPC技能已初始化"
paramTypes:
  npcId: "string (required) - NPC ID"
since: "1.0"
---

# npc_service.mark_skill_initialized

## 功能
标记指定NPC的技能初始化已完成。

## 参数详解
- `npcId` (string, required): NPC的ID

## 返回值
- `message` (string): 操作结果消息，成功时返回 "NPC技能已标记为已初始化"

## 注意事项
- 调用前应先完成技能分配（通过 skill_service）

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| NPC not found | npcId不存在 | 使用 list_npcs 获取有效ID |
