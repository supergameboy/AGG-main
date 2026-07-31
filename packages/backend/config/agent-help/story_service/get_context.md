---
tool: story_service
method: get_context
description: "获取故事上下文(含agent_contexts、存档信息、压缩摘要)"
summary: "获取故事上下文"
since: "1.0"
---

# story_service.get_context

## 功能
获取当前存档的完整故事上下文，包含 agentContext（story 类型的 Agent 上下文）、存档基本信息和压缩摘要。这是了解当前故事状态的核心只读方法。

## 参数详解

此方法无需任何参数。

## 返回值

```typescript
interface StoryContextWithHint extends StoryContext {
  hint?: string;  // 仅在 agentContext 为空时出现，提示初始化上下文
}

interface StoryContext {
  agentContext: Record<string, unknown> | null;  // story 类型的 Agent 上下文数据
  saveInfo: {
    chapter: string | null;    // 当前章节
    location: string | null;   // 当前位置
    main_quest: string | null; // 主线任务
    level: number | null;      // 当前等级
  } | null;
  compressionSummaries?: string;  // 历史事件压缩摘要，格式为 "[历史事件摘要]\n..."
}
```

## 注意事项
- 此方法为只读操作，不会修改任何故事状态
- 当 agentContext 为空时，返回的 `hint` 字段会提示使用 `update_context` 初始化
- `compressionSummaries` 仅在存在压缩历史时返回
- 如需修改上下文，请使用 `update_context` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空上下文 | 存档尚未初始化故事数据 | 先完成游戏初始化流程，再调用 `update_context` 初始化 |
| 上下文数据膨胀 | 长时间未压缩导致数据量大 | 调用 `compress_context` 压缩上下文 |
