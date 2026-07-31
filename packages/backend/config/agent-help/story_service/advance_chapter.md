---
tool: story_service
method: advance_chapter
description: "推进到下一章节"
summary: "推进到下一章节"
since: "1.0"
---

# story_service.advance_chapter

## 功能
将当前存档的故事推进到下一章节。章节编号遵循 `chapter_N` 格式（如 `chapter_1` → `chapter_2`）。若当前章节不符合该格式，则默认推进到 `chapter_2`。

## 参数详解

此方法无需任何参数。

## 返回值

```typescript
interface AdvanceChapterResult {
  previousChapter: string;  // 推进前的章节标识，如 "chapter_1"
  currentChapter: string;   // 推进后的章节标识，如 "chapter_2"
}
```

## 注意事项
- 此方法为写操作，会直接修改 saves 表的 chapter 字段
- 章节推进不会自动触发上下文压缩，如需压缩请手动调用 `compress_context`
- 章节推进是不可逆操作，请谨慎使用
- 若存档不存在，将抛出 "Save not found" 错误

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Save not found | saveId 对应的存档不存在 | 确认 saveId 是否正确，或先完成游戏初始化 |
