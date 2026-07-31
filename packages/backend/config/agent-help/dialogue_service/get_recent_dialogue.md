---
tool: dialogue_service
method: get_recent_dialogue
description: "获取最近N条对话记录。如果指定npcId则获取与该NPC的对话，否则获取所有最近对话"
summary: "获取最近对话记录"
paramTypes:
  npcId: "string (optional) - NPC ID（可选，不传则获取所有最近对话）"
  count: "number (optional) - 获取数量（默认10）"
since: "1.0"
---

# dialogue_service.get_recent_dialogue

## 功能
获取最近的N条对话记录。如果指定 npcId 则获取与该NPC的最近对话，否则获取所有最近对话。适用于快速了解最新对话内容，如准备继续对话时回顾上下文。

## 参数详解

### npcId（可选）
- **类型**: string
- **说明**: 目标NPC的ID，指定后仅返回与该NPC的对话
- **默认行为**: 不传此参数时返回所有NPC的最近对话

### count（可选）
- **类型**: number
- **说明**: 需要获取的对话条数
- **默认值**: 10

## 返回值

```typescript
{
  dialogues: DialogueMessage[];  // 对话消息列表，按时间正序排列
  hint?: string;                 // 无数据时的提示（如"暂无最近对话记录，可视为当前没有可读上下文。"）
}
```

其中 DialogueMessage 结构：

```typescript
{
  id: string;           // 消息ID
  saveId: string;       // 存档ID
  npcId: string | null; // 关联的NPC ID
  speaker: string;      // 发言者名称
  content: string;      // 对话内容
  emotion: string;      // 情绪标签
  messageType: 'player' | 'npc' | 'narrator' | 'system';  // 消息类型
  timestamp: number;    // 时间戳（毫秒）
}
```

## 注意事项
- 此方法为只读操作，不会修改任何对话数据
- npcId 为可选参数，不传时返回所有NPC的最近对话
- 返回结果按时间正序排列（最早的在前）。内部先按时间倒序查询 limit 条再 reverse，保证正序输出
- 如需获取完整对话历史（含分页），请使用 `get_dialogue_history` 方法
- 无对话记录时返回空数组，且 hint 字段包含提示信息

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 指定NPC无对话记录或 npcId 不存在 | 确认 npcId 是否正确，或该NPC是否有过对话 |
| 返回条数少于 count | 对话记录总数不足 | 属正常情况，返回所有可用记录 |
