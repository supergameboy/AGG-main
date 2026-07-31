---
tool: event_service
method: record_story_event
description: "记录故事事件"
summary: "记录故事事件"
paramTypes:
  chapter: "string (optional) - 章节"
  eventType: "string (required) - 事件类型"
  title: "string (required) - 标题"
  description: "string (optional) - 描述"
  participants: "array (optional) - 参与者列表"
  impact: "object (optional) - 影响数据"
since: "1.0"
---

# event_service.record_story_event

## 功能
直接记录一条故事事件到 story_events 中。与通过 `trigger_event` + `resolve_trigger` 的两阶段流程不同，此方法可直接写入故事事件记录。适用于需要手动记录重要剧情节点、非触发器驱动的剧情事件等场景。

## 参数详解

### chapter（可选）
- **类型**: string
- **说明**: 事件所属的章节
- **示例**: "chapter-1"、"prologue"、"epilogue"
- **默认行为**: 不传时为空字符串

### eventType（必填）
- **类型**: string
- **说明**: 事件的类型分类
- **常见值**: combat、social、exploration、quest、discovery、death、birth、alliance、betrayal 等
- **要求**: 不能为空

### title（必填）
- **类型**: string
- **说明**: 事件的标题，简明扼要地概括事件
- **要求**: 不能为空

### description（可选）
- **类型**: string
- **说明**: 事件的详细描述
- **默认行为**: 不传时为空字符串
- **建议**: 提供足够的细节以便后续回顾

### participants（可选）
- **类型**: array (of string)
- **说明**: 事件涉及的参与者ID列表
- **示例**: `["npc-warrior-001", "npc-mage-002"]`
- **默认行为**: 不传时为空数组

### impact（可选）
- **类型**: object
- **说明**: 事件产生的影响数据
- **示例**: `{ relationChange: { "npc-king-001": -20 }, territoryChange: "lost-northern-pass" }`
- **默认行为**: 不传时为空对象

## 返回值

```typescript
{
  id: string;              // 记录的唯一标识
  saveId: string;          // 存档ID（自动注入）
  chapter: string;         // 所属章节
  eventType: string;       // 事件类型
  title: string;           // 事件标题
  description: string;     // 事件描述
  importance: 'critical' | 'major' | 'minor'; // 事件重要程度（默认为minor）
  participants: string[];  // 参与者ID列表
  impact: Record<string, unknown>; // 影响数据
  timestamp: number;       // 记录时间戳（毫秒）
}
```

## 注意事项
- 此方法为写操作，会直接写入 story_events，无需经过触发器流程
- 与 `resolve_trigger` 的归档不同，此方法是直接写入，适用于手动记录场景
- eventType 和 title 为必填项，确保事件有明确的分类和描述
- importance 默认为 `minor`（因为 Tool 层未暴露 importance 参数，服务层 normalizeStoryEventImportance 默认值为 minor）
- participants 和 impact 有助于后续分析事件的影响范围
- 记录的故事事件可通过 `get_story_events` 查询

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| eventType 或 title 缺失 | 未传入必填参数 | 必须提供事件类型和标题 |
| 参与者ID无效 | participants 中包含不存在的ID | 确认参与者ID是否正确 |

## story_progress事件
record_story_event记录故事事件后，EventBus会自动发布story_progress事件通知StoryKernel更新故事投影。不需要手动通知。
