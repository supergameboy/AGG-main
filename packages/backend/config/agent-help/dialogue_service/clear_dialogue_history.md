---
tool: dialogue_service
method: clear_dialogue_history
description: "清除对话历史（可指定NPC或清除所有）"
summary: "清除对话历史"
paramTypes:
  npcId: "string (optional) - NPC ID（可选，不传则清除所有）"
since: "1.0"
---

# dialogue_service.clear_dialogue_history

## 功能
清除对话历史记录。可指定某个NPC清除与该NPC的对话历史，也可不传 npcId 清除所有NPC的对话历史。此操作不可逆，清除后对话记录将无法恢复。适用于重置对话状态、新章节开始等场景。

## 参数详解

### npcId（可选）
- **类型**: string
- **说明**: 指定NPC的ID，仅清除与该NPC的对话历史
- **默认行为**: 不传此参数时清除所有NPC的对话历史

## 返回值

```typescript
{
  deletedCount: number;  // 被删除的对话记录条数
}
```

## 注意事项
- 此方法为写操作，会永久删除对话历史数据，不可逆
- 不传 npcId 时将清除所有对话历史，请谨慎使用
- 清除对话历史会影响 `get_emotion_trend` 和 `get_dialogue_summary` 的统计结果
- 清除后 `get_dialogue_context` 返回的历史消息将为空
- 建议在清除前确认是否需要保留对话数据

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 误删所有对话 | 未传 npcId 导致清除全部 | 明确指定 npcId 仅清除特定NPC的对话 |
| npcId 无效 | 传入的NPC ID不存在 | 确认 npcId 是否正确 |
| 清除后情绪统计异常 | 对话历史被清除导致无数据 | 属正常行为，清除后需重新积累对话数据 |
