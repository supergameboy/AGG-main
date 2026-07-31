---
tool: dialogue_service
method: submit_dialogue
description: "提交对话消息数组并持久化。一次提交本轮全部对话消息，支持批量写入和对话选项。NPC对话speaker使用NPC名称，旁白/叙事speaker使用\"旁白\"且messageType为narrator。"
summary: "批量写入本轮对话消息与选项"
paramTypes:
  messages: "array (required) - 对话消息数组。每条消息包含speaker(说话者名称)、content(消息内容)、emotion(可选情绪)、messageType(可选，默认npc，可选player/npc/narrator/system)。旁白/叙事: speaker=\"旁白\", messageType=\"narrator\"；NPC对话: speaker=NPC名称, messageType=\"npc\""
  options: "array (required) - 对话选项数组。每个选项包含text(显示文本)和npcId(对话目标NPC的ID或名称)。始终提供2-4个选项引导玩家下一步行动，无明确对话目标时npcId使用当前场景主要NPC"
since: "1.0"
whenToUse:
  - 本轮叙事和对话已经生成完成，需要一次性落库存档时
  - 需要把 NPC 对话、旁白和选项统一写入对话历史时
returnsSummary: 返回写入后的对话结果与消息条数
---

# dialogue_service.submit_dialogue

## 功能
批量提交对话消息数组并持久化。一次调用提交本轮全部对话消息（旁白、NPC对话等），同时支持对话选项。NPC消息的speaker会自动经过三级兜底解析（ID → template_npc_id → name）关联到正确的NPC记录。

## 参数详解

### messages（必填）
- **类型**: array
- **说明**: 对话消息数组，一次提交本轮全部消息
- **每条消息字段**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| speaker | string | 是 | 说话者名称。旁白用"旁白"，NPC用NPC名称 |
| content | string | 是 | 消息内容 |
| emotion | string | 否 | 情绪标签，默认neutral |
| messageType | string | 否 | 消息类型，默认npc。可选player/npc/narrator/system |

**消息类型说明**：
- `narrator`：旁白/叙事，speaker="旁白"，不关联NPC
- `npc`：NPC对话，speaker=NPC名称，自动解析关联NPC
- `player`：玩家消息，speaker=玩家角色名（此处用于LLM补充的玩家对话描述）
- `system`：系统消息

### options（必填）
- **类型**: array
- **说明**: 对话选项数组，始终提供2-4个选项引导玩家下一步行动
- **每个选项字段**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| text | string | 是 | 选项显示文本 |
| npcId | string | 是 | 对话目标NPC的ID或名称，自动经过三级兜底解析。无明确对话目标时使用当前场景主要NPC |

## 返回值

```typescript
{
  success: true,
  data: {
    dialogue: {
      messages: Array<{ speaker: string; content: string; emotion?: string; messageType?: string }>,
      options?: Array<{ text: string; npcId: string }>
    },
    messageCount: number
  }
}
```

## NPC ID 三级兜底机制
NPC消息的 speaker 和 options 中的 npcId 会自动经过三级解析：
1. 按 `npcs.id` 精确匹配（如 `npc_村长艾德温_abc123`）
2. 按 `npcs.template_npc_id` 精确匹配（如 `template_village_chief`）
3. 按 `npcs.name` 精确匹配（如 `村长艾德温`）

解析失败时 npcId 设为 null，消息仍保存但不关联NPC对话历史。

## 注意事项
- 此方法为写操作，会修改对话历史数据
- 一次提交全部消息，避免多次调用导致消息顺序混乱
- 旁白消息（speaker="旁白"）自动跳过NPC关联
- emotion 参数影响 `get_emotion_trend` 和 `get_dialogue_summary` 的统计结果，应准确标注
- 使用事务保证对话消息插入和NPC历史更新的原子性

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| messages 为空数组 | 未传入消息 | 必须提供至少一条消息 |
| 消息缺少 speaker 或 content | 字段缺失 | 每条消息必须包含 speaker 和 content |
| NPC未关联 | speaker 名称无法匹配任何NPC | 确认NPC名称是否正确，或使用NPC ID |
| 选项缺少 text 或 npcId | 字段缺失 | 每个选项必须包含 text 和 npcId |
| options 为空数组 | 未提供选项 | 始终提供2-4个选项引导玩家 |
