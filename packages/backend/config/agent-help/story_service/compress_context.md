---
tool: story_service
method: compress_context
description: "压缩上下文保留关键信息"
summary: "压缩上下文保留关键信息"
since: "1.0"
---

# story_service.compress_context

## 功能
压缩当前存档的故事上下文，委托 ContextService 执行压缩，在保留关键信息的前提下减少上下文体积。压缩后可通过 `get_context` 查看压缩摘要。

## 参数详解

此方法无需任何参数。

## 返回值

```typescript
{ message: "Context compressed successfully" }
```

注意：底层 `StoryService.compressContext` 返回 `void`，Tool 层包装为固定消息对象，不包含压缩统计信息。

## 注意事项
- 此方法为写操作，会修改故事上下文数据
- 压缩是不可逆操作，被移除的细节信息无法恢复
- 建议在上下文数据膨胀时定期调用，避免影响 Agent 性能
- 章节推进不会自动触发压缩，需手动调用

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 压缩失败 | 上下文数据格式异常或 ContextService 内部错误 | 检查 `update_context` 写入的数据格式 |
