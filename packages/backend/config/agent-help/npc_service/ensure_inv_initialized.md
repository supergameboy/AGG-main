---
tool: npc_service
method: ensure_inv_initialized
description: "检查NPC物品是否已初始化。返回true表示需要初始化（inv_initialized=0），false表示已初始化。"
summary: "检查NPC物品栏是否已初始化"
paramTypes:
  npcId: "string (required) - NPC ID"
since: "1.0"
---

# npc_service.ensure_inv_initialized

## 功能
检查指定NPC的物品栏是否已完成初始化。

## 参数详解
- `npcId` (string, required): NPC的ID

## 返回值
- `needsInit` (boolean): 是否需要初始化，true 表示需要初始化，false 表示已初始化

## 注意事项
- 仅检查不执行初始化，初始化需调用 mark_inv_initialized

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| NPC not found | npcId不存在 | 使用 list_npcs 获取有效ID |
