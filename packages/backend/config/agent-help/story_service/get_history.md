---
tool: story_service
method: get_history
description: "获取历史故事事件(支持分页)"
summary: "获取历史故事事件"
paramTypes:
  page: "number (optional) - 页码，默认1"
  pageSize: "number (optional) - 每页条数，默认20"
since: "1.0"
---

# story_service.get_history

## 功能
获取当前存档的历史故事事件记录，支持分页查询。返回的事件按时间倒序排列（最新在前），可用于回顾剧情发展、验证故事连贯性或分析叙事节奏。

## 参数详解

### page（可选）
- **类型**: number
- **说明**: 请求的页码，从 1 开始
- **默认值**: 1

### pageSize（可选）
- **类型**: number
- **说明**: 每页返回的事件条数
- **默认值**: 20

## 返回值

```typescript
interface GetHistoryResult {
  events: StoryEvent[];      // 事件列表，按 timestamp 降序排列
  pagination: {
    page: number;            // 当前页码
    pageSize: number;        // 每页条数
    total: number;           // 总条数
    totalPages: number;      // 总页数
  };
  compressionSummaries?: string;  // 历史事件压缩摘要（存在时返回）
  hint?: string;                  // 仅在事件列表为空时出现，提示使用 add_story_event
}

interface StoryEvent {
  id: string;               // 事件ID
  save_id: string;          // 存档ID
  chapter: string;          // 所属章节
  event_type: string;       // 事件类型
  title: string;            // 事件标题
  description: string;      // 事件描述
  importance: 'critical' | 'major' | 'minor';  // 重要程度
  participants: string;     // 参与者（JSON字符串）
  impact: string;           // 影响（JSON字符串）
  timestamp: number;        // 时间戳
}
```

## 注意事项
- 此方法为只读操作，不会修改任何故事状态
- 事件按时间倒序排列（最新事件在前）
- 如需获取所有历史事件，可通过递增 page 参数遍历
- pageSize 不宜设置过大，建议保持在 20-50 之间以避免响应超时
- 当事件列表为空时，`hint` 字段会提示使用 add_story_event 记录事件

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 存档尚无故事事件记录 | 先推进游戏剧情产生事件 |
| 页码超出范围 | page 值大于总页数 | 使用返回的 pagination 信息判断有效页码范围 |
