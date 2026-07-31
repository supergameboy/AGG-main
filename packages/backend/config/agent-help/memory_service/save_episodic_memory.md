---
tool: memory_service
method: save_episodic_memory
description: "保存一条情景记忆(发生过什么)"
summary: "保存情景记忆"
paramTypes:
  content: "string (required) - 事实描述"
  type: "string (required) - 记忆类型"
  importance: "number (optional) - 重要性1-5"
  related_entities: "array<string> (optional) - 关联实体ID列表"
since: "1.0"
---

# memory_service.save_episodic_memory

<!-- @manual: 本文件 frontmatter 由 generate-agent-help 自动维护，正文由人工维护 -->
<!-- 如需完全手工维护 frontmatter，在正文任意处添加 <!-- @manual-frontmatter --> 标记 -->

## 功能
保存一条情景记忆(发生过什么)

## 参数详解
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | 是 | 事实描述 |
| type | string | 是 | 记忆类型 |
| importance | number | 否 | 重要性1-5 |
| related_entities | array<string> | 否 | 关联实体ID列表 |

## 返回值
（待补充）

## 注意事项
（待补充）
