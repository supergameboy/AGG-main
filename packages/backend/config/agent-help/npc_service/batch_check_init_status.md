---
tool: npc_service
method: batch_check_init_status
description: "批量查询多个NPC的初始化状态（attr/inv/skill）。一次调用替代多次 ensure_*_initialized，返回每个NPC三类初始化的 needsInit 状态（true=需要初始化）"
paramTypes:
  npcIds: "array<string> (required) - 要查询的 NPC ID 列表"
since: "1.0"
---

# npc_service.batch_check_init_status

<!-- @manual: 本文件 frontmatter 由 generate-agent-help 自动维护，正文由人工维护 -->
<!-- 如需完全手工维护 frontmatter，在正文任意处添加 <!-- @manual-frontmatter --> 标记 -->

## 功能
批量查询多个NPC的初始化状态（attr/inv/skill）。一次调用替代多次 ensure_*_initialized，返回每个NPC三类初始化的 needsInit 状态（true=需要初始化）

## 参数详解
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| npcIds | array<string> | 是 | 要查询的 NPC ID 列表 |

## 返回值
（待补充）

## 注意事项
（待补充）
