---
tool: dialogue_service
method: get_dialogue_summary
description: "获取对话摘要统计（总数、情绪分布、说话者分布、时间范围）"
summary: "获取对话摘要统计"
paramTypes:
  npcId: "string (optional) - NPC ID（可选，不传则统计所有）"
since: "1.0"
---

# dialogue_service.get_dialogue_summary

## 功能
获取对话的摘要统计信息，包括对话总数、情绪分布、说话者分布和时间范围。可针对特定NPC统计，也可统计所有NPC的对话数据。适用于快速了解对话概况、分析对话模式等场景。

## 参数详解

### npcId（可选）
- **类型**: string
- **说明**: 指定NPC的ID，仅统计与该NPC的对话
- **默认行为**: 不传此参数时统计所有NPC的对话数据

## 返回值

```typescript
{
  totalMessages: number;       // 对话消息总条数
  emotionDistribution: Array<{ // 情绪分布，按数量降序
    emotion: string;           // 情绪标签
    count: number;             // 该情绪的消息数量
    percentage: number;        // 占比（精确到小数点后两位，如33.33）
  }>;
  speakerDistribution: Array<{ // 说话者分布，按数量降序
    speaker: string;           // 发言者名称
    count: number;             // 该发言者的消息数量
  }>;
  firstMessageTime: number | null;  // 最早消息的时间戳（毫秒），无消息时为null
  lastMessageTime: number | null;   // 最晚消息的时间戳（毫秒），无消息时为null
  dateRange: string | null;         // 时间范围描述（如"2026/6/1 - 2026/6/3"），无消息时为null
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- speakerDistribution 仅包含 speaker 和 count，不含 percentage 字段
- emotionDistribution 的 percentage 精确到小数点后两位（Math.round 四舍五入）
- 情绪分布依赖于 `submit_dialogue` 时正确标注的 emotion 参数
- 如需分析情绪变化趋势（而非静态分布），请使用 `get_emotion_trend` 方法
- 无对话记录时返回空数组和 null 值

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空统计 | 无对话记录 | 确认是否已有对话数据 |
| 情绪分布全为 neutral | 添加对话时未指定 emotion | 在 submit_dialogue 中正确标注情绪 |
| npcId 无效 | 传入的NPC ID不存在 | 确认 npcId 是否正确 |
