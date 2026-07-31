---
tool: npc_service
method: ensure_skill_initialized
description: "检查NPC技能是否已初始化。返回true表示需要初始化（skill_initialized=0），false表示已初始化。"
summary: "检查NPC技能是否已初始化"
paramTypes:
  npcId: "string (required) - NPC ID"
since: "1.0"
---

# npc_service.ensure_skill_initialized

## 功能
检查指定NPC的技能是否已完成初始化。

## 参数详解
- `npcId` (string, required): NPC的ID

## 返回值
- `needsInit` (boolean): 是否需要初始化，true 表示需要初始化，false 表示已初始化

## 注意事项
- 仅检查不执行初始化，初始化需调用 mark_skill_initialized

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| NPC not found | npcId不存在 | 使用 list_npcs 获取有效ID |
