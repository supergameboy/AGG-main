---
tool: story_service
method: update_context
description: "更新故事上下文(agent_contexts)"
summary: "更新故事上下文"
paramTypes:
  state: "object (optional) - 要合并的state数据"
  messages: "array (optional) - 替换的messages数组"
since: "1.0"
---

# story_service.update_context

## 功能
更新当前存档的故事上下文。支持两种更新模式：通过 state 参数浅合并更新状态数据，通过 messages 参数替换消息数组。此方法用于 Agent 在执行过程中持久化关键上下文信息，确保跨轮次对话的连贯性。

## 参数详解

### state（可选）
- **类型**: object
- **说明**: 要合并到 agent_contexts 中的状态数据
- **行为**: 采用浅合并策略（`{ ...currentState, ...data.state }`），顶层键会被覆盖，新键会被添加，未涉及的顶层键保持不变
- **示例**: `{ "current_plot": "寻找失落的王冠", "npc_met": ["elder_villager"] }`

### messages（可选）
- **类型**: array
- **说明**: 替换整个 messages 数组
- **行为**: 整体替换，不是追加。传入后将完全覆盖现有消息列表
- **注意**: 使用时需谨慎，确保不丢失重要历史消息

## 返回值

```typescript
{ message: "Context updated successfully" }
```

注意：底层 `StoryService.updateContext` 返回 `void`，Tool 层包装为固定消息对象。

## 注意事项
- 此方法为写操作，会修改故事上下文数据
- state 和 messages 参数至少需要提供一个，否则无实际更新效果
- state 采用**浅合并**策略，仅合并顶层键，不会递归合并嵌套对象；如需删除字段，需显式设为 null
- messages 是整体替换，务必在替换前保留必要的消息历史
- 若 agent_contexts 记录不存在，会自动创建新记录

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 上下文未更新 | state 和 messages 都未传入 | 至少提供一个参数 |
| 历史消息丢失 | 使用 messages 替换时遗漏了重要消息 | 替换前先通过 `get_context` 获取现有消息 |
| 嵌套对象被覆盖 | state 浅合并时嵌套对象被整体替换 | 合并前手动展开嵌套结构，或使用扁平键名 |
