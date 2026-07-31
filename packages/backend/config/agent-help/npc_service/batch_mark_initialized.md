---
tool: npc_service
method: batch_mark_initialized
description: "批量标记多个NPC的初始化完成状态。一次调用替代多次 mark_*_initialized，在事务内原子化执行。未提供的字段保持原状态，仅更新显式设为 true 的字段"
paramTypes:
  updates: "array<object{npcId:string,attrInitialized:boolean,invInitialized:boolean,skillInitialized:boolean}> (required) - 要标记的初始化状态列表"
since: "1.0"
---

# npc_service.batch_mark_initialized

<!-- @manual: 本文件 frontmatter 由 generate-agent-help 自动维护，正文由人工维护 -->
<!-- 如需完全手工维护 frontmatter，在正文任意处添加 <!-- @manual-frontmatter --> 标记 -->

## 功能
批量标记多个NPC的初始化完成状态。一次调用替代多次 mark_*_initialized，在事务内原子化执行。未提供的字段保持原状态，仅更新显式设为 true 的字段

## 参数详解
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| updates | array<object{npcId:string,attrInitialized:boolean,invInitialized:boolean,skillInitialized:boolean}> | 是 | 要标记的初始化状态列表 |

## 返回值
（待补充）

## 注意事项
（待补充）
