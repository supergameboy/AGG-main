---
tool: dialogue_service
method: get_emotion_trend
description: "分析对话情绪变化趋势（正向/负向/中性比例及累积趋势）"
summary: "分析对话情绪变化趋势"
paramTypes:
  npcId: "string (required) - NPC ID"
since: "1.0"
---

# dialogue_service.get_emotion_trend

## 功能
分析与指定NPC对话的情绪变化趋势，包括正向/负向/中性情绪的比例分布以及情绪的累积变化趋势。适用于判断与NPC的关系走向、评估对话策略效果、以及为后续对话决策提供参考。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 目标NPC的ID
- **要求**: 必须是已存在的有效NPC ID

## 返回值

```typescript
{
  trend: Array<{           // 情绪趋势数据，按时间正序
    timestamp: number;     // 消息时间戳（毫秒）
    emotion: string;       // 该条消息的情绪标签
    cumulativePositive: number;  // 截至该消息的累积正向情绪计数
    cumulativeNegative: number;  // 截至该消息的累积负向情绪计数
  }>;
  overallSentiment: 'positive' | 'negative' | 'neutral';  // 总体情绪倾向
  positiveRatio: number;   // 正向情绪占比（精确到小数点后两位）
  negativeRatio: number;   // 负向情绪占比（精确到小数点后两位）
  neutralRatio: number;    // 中性情绪占比（精确到小数点后两位）
}
```

**情绪分类规则**：
- 正向情绪：happy、excited、friendly、warm、grateful
- 负向情绪：angry、sad、hostile、cold、fearful
- 其他：中性

**总体情绪判定规则**：
- positiveRatio > negativeRatio + 10 → positive
- negativeRatio > positiveRatio + 10 → negative
- 其他 → neutral

**无对话记录时**的返回值：

```typescript
{
  trend: [];
  overallSentiment: 'neutral';
  positiveRatio: 0;
  negativeRatio: 0;
  neutralRatio: 1;
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 分析结果依赖于 `submit_dialogue` 时正确标注的 emotion 参数
- 如果对话记录中 emotion 大多为 neutral，趋势分析的意义有限
- 对话记录过少时（如少于3条），趋势分析结果可能不够准确
- 如仅需静态的情绪分布统计，可使用 `get_dialogue_summary` 方法
- trend 数组中每条记录的 cumulativePositive/cumulativeNegative 是截至该消息的累积值，可用于绘制情绪走势图

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| npcId 缺失 | 未传入必填参数 npcId | 必须传入有效的 NPC ID |
| 分析结果无意义 | 对话记录中 emotion 全为 neutral | 在添加对话时正确标注情绪标签 |
| 数据不足 | 与该NPC的对话记录太少 | 积累更多对话记录后再分析 |
