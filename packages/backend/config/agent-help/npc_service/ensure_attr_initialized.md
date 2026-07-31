---
tool: npc_service
method: ensure_attr_initialized
description: "检查NPC属性是否已初始化。返回true表示需要初始化（attr_initialized=0），false表示已初始化。"
summary: "检查NPC属性是否已初始化"
paramTypes:
  npcId: "string (required) - NPC ID"
since: "1.0"
---

# npc_service.ensure_attr_initialized

## 功能
检查指定NPC的属性是否已完成初始化。

## 参数详解
- `npcId` (string, required): NPC的ID，使用预加载上下文中的真实ID

## 返回值
- `needsInit` (boolean): 是否需要初始化，true 表示需要初始化，false 表示已初始化

## 注意事项
- 仅检查不执行初始化，初始化需调用 mark_attr_initialized
- 属性初始化包括基础属性和派生属性的计算

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| NPC not found | npcId不存在 | 使用 list_npcs 获取有效ID |
