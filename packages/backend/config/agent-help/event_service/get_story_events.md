---
tool: event_service
method: get_story_events
description: "获取故事事件记录"
summary: "获取故事事件记录"
paramTypes:
  chapter: "string (optional) - 章节筛选(可选)"
since: "1.0"
---

# event_service.get_story_events

## 功能
获取已归档的故事事件记录。这些事件是通过 `resolve_trigger` 满足严格归档规则后写入的，或通过 `record_story_event` 直接记录的。支持按章节筛选，适用于回顾剧情发展、检查事件记录等场景。

## 参数详解

### chapter（可选）
- **类型**: string
- **说明**: 按章节筛选故事事件
- **格式**: 章节标识，如 "chapter-1"、"prologue" 等
- **默认行为**: 不传此参数时返回所有章节的故事事件

## 返回值

```typescript
// 返回 StoryEventRecord 数组
[
  {
    id: string;              // 记录的唯一标识
    saveId: string;          // 存档ID
    chapter: string;         // 所属章节
    eventType: string;       // 事件类型分类
    title: string;           // 事件标题
    description: string;     // 事件详细描述
    importance?: 'critical' | 'major' | 'minor'; // 事件重要程度
    participants: string[];  // 参与者ID列表
    impact: Record<string, unknown>; // 影响数据
    timestamp: number;       // 事件记录时间戳（毫秒）
  }
]
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 故事事件是已确认并归档的记录，与待处理的触发器不同
- 如需查看待处理的事件，使用 `get_pending_triggers` 方法
- 如需查看事件触发历史（含未归档的），使用 `get_trigger_history` 方法
- 故事事件按时间倒序排列（最新的在前）
- importance 字段可选，通过 `resolve_trigger` 归档的事件固定为 `major`，通过 `record_story_event` 记录的事件默认为 `minor`

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 无故事事件记录或章节无匹配 | 确认是否已有事件被归档，或检查 chapter 参数值 |
| 章节无匹配 | chapter 值与实际章节标识不一致 | 不传 chapter 查看所有事件，从中确认正确的章节标识 |
