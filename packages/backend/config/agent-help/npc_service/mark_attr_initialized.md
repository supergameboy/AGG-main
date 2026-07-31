---
tool: npc_service
method: mark_attr_initialized
description: "标记NPC属性已初始化（设置attr_initialized=1）。在LLM生成属性并写入后调用。"
summary: "标记NPC属性已初始化"
paramTypes:
  npcId: "string (required) - NPC ID"
since: "1.0"
---

# npc_service.mark_attr_initialized

## 功能
标记指定NPC的属性初始化已完成，后续不再重复初始化。

## 参数详解
- `npcId` (string, required): NPC的ID

## 返回值
- `message` (string): 操作结果消息，成功时返回 "NPC属性已标记为已初始化"

## 注意事项
- 调用前应先完成属性计算（通过 numerical_service.calculate_stats）
- 标记后 ensure_attr_initialized 将返回 needsInit=false

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| NPC not found | npcId不存在 | 使用 list_npcs 获取有效ID |
