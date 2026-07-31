---
tool: dialogue_service
method: get_dialogue_context
description: "获取完整对话上下文（含NPC信息、关系值、历史消息、可用选项、时间上下文）"
summary: "获取完整对话上下文"
paramTypes:
  npcId: "string (required) - NPC ID，传入\"all\"获取所有NPC的对话上下文摘要"
returnType: "DialogueContext"
since: "1.0"
---

# dialogue_service.get_dialogue_context

## 功能
获取与指定NPC的完整对话上下文，聚合了NPC基本信息、与玩家的关系值、历史对话消息、当前可用的对话选项以及时间上下文。传入 `"all"` 时返回所有NPC的对话上下文摘要。适用于在开始或继续对话前，一次性获取所有需要的上下文信息。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 目标NPC的ID
- **特殊值**: 传入 `"all"` 时返回所有NPC的对话上下文摘要（调用 getDialogueContextForAll）
- **要求**: 传入具体NPC ID时，必须是已存在的有效NPC ID

## 返回值

**传入具体 npcId 时**，返回 DialogueContext：

```typescript
{
  npcName: string;               // NPC名称
  npcRole: string;               // NPC角色
  npcDisposition: string;        // NPC态度（从custom_data.disposition读取，默认neutral）
  playerRelationValue: number;   // 与玩家的关系值（-100~100，无记录时为0）
  recentMessages: DialogueMessage[];  // 最近10条对话消息，按时间正序
  availableOptions: DialogueOption[]; // 当前可用的对话选项列表
  timeContext: {
    currentTime: number;         // 当前时间戳（毫秒）
    lastDialogueTime: number | null;  // 最后一条对话的时间戳
    timeSinceLastDialogue: number | null;  // 距离上次对话的毫秒数
  }
}
```

其中 DialogueOption 结构：

```typescript
{
  id: string;                    // 选项ID（格式：{npcId}:{key}）
  text: string;                  // 选项显示文本
  npcId: string;                 // 关联NPC ID
  requiresRelation?: number;     // 所需关系值（如20、50）
  requiresQuest?: string;        // 所需任务ID
  requiresItem?: string;         // 所需物品ID
  emotion?: string;              // 选项情绪
  nextTopic?: string;            // 下一话题
  effects?: DialogueEffect[];    // 选择后触发的效果列表
  response?: {                   // NPC回复配置
    emotion: string;
    responseTemplate: string;    // 回复模板，{npcName}会被替换为NPC名称
  }
}
```

**传入 `"all"` 时**，返回所有NPC摘要：

```typescript
{
  contexts: DialogueContextSummary[];  // 所有NPC的上下文摘要
  hint?: string;                       // 无NPC时的提示
}
```

其中 DialogueContextSummary 结构：

```typescript
{
  npcId: string;                 // NPC ID
  npcName: string;               // NPC名称
  npcRole: string;               // NPC角色
  playerRelationValue: number;   // 与玩家的关系值
  recentMessageCount: number;    // 与该NPC的对话消息总数
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- npcId 为必填参数，传入 `"all"` 可获取所有NPC的摘要
- 传入具体NPC ID时，如果NPC不存在会抛出错误
- 可用对话选项根据关系值动态生成：关系值≥20解锁"深入交谈"，≥50解锁"请求帮助"
- npcDisposition 从NPC的 custom_data.disposition 字段读取，支持JSON字符串和对象两种格式
- 如仅需对话历史，使用 `get_recent_dialogue` 更轻量
- 如仅需统计信息，使用 `get_dialogue_summary` 更合适

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| npcId 缺失 | 未传入必填参数 npcId | 必须传入有效的 NPC ID 或 "all" |
| NPC 不存在 | 传入的 npcId 无对应NPC | 确认 npcId 是否正确，可通过 npc_service.list_npcs 查询 |
| 返回数据不完整 | NPC 缺少某些配置数据 | 检查NPC是否已正确初始化 |
