---
tool: dialogue_service
method: get_dialogue_history
description: "获取对话历史(支持分页，可按NPC筛选)"
summary: "获取对话历史"
paramTypes:
  npcId: "string (optional) - NPC ID（可选）"
  limit: "number (optional) - 每页数量（默认50）"
  offset: "number (optional) - 偏移量（默认0）"
since: "1.0"
---

# dialogue_service.get_dialogue_history

## 功能
获取当前存档的对话历史记录，支持分页查询和按NPC筛选。不传 npcId 时返回所有NPC的对话历史；传入 npcId 时仅返回与该NPC的对话记录。适用于回顾对话内容、分析对话脉络等场景。

## 参数详解

### npcId（可选）
- **类型**: string
- **说明**: 指定NPC的ID，仅返回与该NPC的对话记录
- **默认行为**: 不传此参数时返回所有NPC的对话历史

### limit（可选）
- **类型**: number
- **说明**: 每页返回的对话记录数量
- **默认值**: 50

### offset（可选）
- **类型**: number
- **说明**: 分页偏移量，从第几条记录开始返回
- **默认值**: 0
- **用法**: 翻页时设为 `page * limit`，如第2页（limit=20）时 offset=20

## 返回值

```typescript
{
  messages: DialogueMessage[];  // 对话消息列表，按时间正序排列
  total: number;                // 符合条件的消息总数
  hasMore: boolean;             // 是否还有更多消息（offset + limit < total）
  hint?: string;                // 无数据时的提示（如"暂无对话历史，可视为当前尚未建立对话记录。"）
}
```

其中 DialogueMessage 结构：

```typescript
{
  id: string;           // 消息ID（格式：dlg-{npcId}-{随机}）
  saveId: string;       // 存档ID
  npcId: string | null; // 关联的NPC ID，无关联时为null
  speaker: string;      // 发言者名称
  content: string;      // 对话内容
  emotion: string;      // 情绪标签
  messageType: 'player' | 'npc' | 'narrator' | 'system';  // 消息类型
  timestamp: number;    // 时间戳（毫秒）
}
```

## 注意事项
- 此方法为只读操作，不会修改任何对话数据
- 返回结果按时间正序排列（最早的在前）。内部先按时间倒序查询再 reverse，保证正序输出
- 如需获取与某NPC的最近几条对话，推荐使用 `get_recent_dialogue` 方法更便捷
- 分页查询时注意 offset 和 limit 的配合，避免遗漏或重复
- 无对话记录时返回空数组，且 hint 字段包含提示信息

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 该NPC无对话历史或 npcId 不存在 | 确认 npcId 是否正确，或检查是否已有对话记录 |
| 数据量过大 | limit 设置过大 | 使用合理的 limit 值配合 offset 分页获取 |
