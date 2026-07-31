---
tool: story_service
method: get_chapter
description: "获取当前章节信息"
summary: "获取当前章节信息"
since: "1.0"
---

# story_service.get_chapter

## 功能
获取当前存档的章节信息，包含章节标识、等级和主线任务。数据来源于 saves 表。

## 参数详解

此方法无需任何参数。

## 返回值

```typescript
interface ChapterInfo {
  chapter: string | null;    // 当前章节标识，如 "chapter_1"
  level: number | null;      // 当前等级
  mainQuest: string | null;  // 当前主线任务
}
```

## 注意事项
- 此方法为只读操作，不会修改任何故事状态
- 如需推进到下一章节，请使用 `advance_chapter` 方法
- 若存档不存在，将抛出 "Save not found" 错误

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Save not found | saveId 对应的存档不存在 | 确认 saveId 是否正确，或先完成游戏初始化 |
