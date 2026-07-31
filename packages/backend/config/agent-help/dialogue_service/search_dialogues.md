---
tool: dialogue_service
method: search_dialogues
description: "高级搜索对话（支持关键词、情绪、说话者筛选）"
summary: "高级搜索对话"
paramTypes:
  keyword: "string (optional) - 关键词搜索（可选）"
  emotion: "string (optional) - 情绪筛选（可选）"
  speaker: "string (optional) - 说话者筛选（可选）"
returnType: "DialogueMessage[]"
since: "1.0"
---

# dialogue_service.search_dialogues

## 功能
高级搜索对话记录，支持按关键词、情绪标签和说话者进行组合筛选。三个筛选条件可独立使用也可组合使用，实现精确的对话检索。适用于查找特定话题的对话、筛选特定情绪的对话、或查找特定发言者的对话。

## 参数详解

### keyword（可选）
- **类型**: string
- **说明**: 在对话内容中搜索的关键词
- **匹配方式**: 模糊匹配（LIKE），对话内容包含该关键词即匹配
- **特殊处理**: 自动转义 LIKE 通配符（%、_、\），防止注入
- **默认行为**: 不传此参数时不按关键词筛选

### emotion（可选）
- **类型**: string
- **说明**: 按情绪标签筛选对话
- **匹配方式**: 精确匹配
- **常见值**: neutral、happy、excited、friendly、warm、grateful、angry、sad、hostile、cold、fearful
- **默认行为**: 不传此参数时不按情绪筛选

### speaker（可选）
- **类型**: string
- **说明**: 按发言者名称筛选对话
- **匹配方式**: 精确匹配，需与 `submit_dialogue` 中的 speaker 完全一致
- **默认行为**: 不传此参数时不按发言者筛选

## 返回值

```typescript
DialogueMessage[]  // 匹配的对话记录列表，按时间倒序排列（最新的在前）
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
- 此方法为只读操作，不会修改任何数据
- 三个筛选条件为 AND 关系，同时传入时取交集
- 不传任何筛选参数时返回所有对话记录
- keyword 为模糊匹配，注意关键词的准确性
- speaker 为精确匹配，需与 `submit_dialogue` 中的 speaker 完全一致
- 返回结果按时间倒序排列（最新的在前），与 `get_dialogue_history` 的正序不同

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 筛选条件无匹配结果 | 放宽筛选条件或检查参数值是否正确 |
| speaker 筛选无结果 | 发言者名称不匹配 | 确认发言者名称的精确拼写，与添加时一致 |
| keyword 搜索结果过多 | 关键词过于宽泛 | 使用更具体的关键词或组合其他筛选条件 |
